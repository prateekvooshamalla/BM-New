import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import OpenAI from 'openai';
import { z } from 'zod';
import type { AiFeatureTask, AiUsageLog, Subscription } from '@bharat-makaan/shared';
import { adminDb } from '../shared/firebase-admin';
import {
  requireAuth,
  requireOrgPermission,
  type AuthenticatedActor,
} from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';
import { validateOpenAiAccountModels } from './models';
import { getJobStatusTool } from './tools';
import {
  cancelInventoryDraftService,
  commitApprovedInventoryDraftService,
  retryImportJobService,
} from './import-executor';
import { analyzeFloorPlanDocumentsService } from './document-extraction';
import {
  createAiSessionService,
  sendAiAssistantMessageService,
  updateAiInventoryDraftService,
} from './session-service';

const PROMPT_VERSION = 'bm-enterprise-v1.0';

const COMPLEX_TASKS = new Set<AiFeatureTask>([
  'PROPERTY_MATCHING',
  'FLOOR_PLAN_ANALYSIS',
  'MARKET_INTELLIGENCE',
  'NEGOTIATION_ASSISTANCE',
  'SALES_PERFORMANCE_INSIGHTS',
  'ADMIN_NL_REPORT',
]);

const TASK_INSTRUCTIONS: Record<AiFeatureTask, string> = {
  LEAD_QUALIFICATION:
    'Analyze the provided CRM lead record. Output qualification tier (HOT/WARM/COLD), key buyer intent signals, and recommended next sales step.',
  BUYER_REQUIREMENT_EXTRACTION:
    'Extract structured buyer requirements (budget range, BHK, locality, timeline, facing preference) strictly from the provided inquiry text.',
  PROPERTY_MATCHING:
    'Match the buyer criteria strictly against the provided authorized inventory units. Never invent units or prices.',
  WHATSAPP_REPLY_DRAFT:
    'Draft a polite, concise WhatsApp reply for human agent review based strictly on the conversation context.',
  COST_SHEET_EXPLANATION:
    'Summarize the deterministic cost sheet charges, GST components, and milestone payment schedule in clear buyer-friendly language without altering any numbers.',
  FLOOR_PLAN_ANALYSIS:
    'Analyze the provided floor plan metadata and summarize carpet-to-saleable efficiency, facing, and layout highlights.',
  BROCHURE_SUMMARIZATION:
    'Summarize the provided project specifications, RERA details, configurations, and amenities accurately.',
  PRICE_COMPARISON_EXPLANATION:
    'Explain the exact difference between the previous and current price book versions using only the provided revision numbers.',
  MARKET_INTELLIGENCE:
    'Provide grounded micro-market context clearly separating internal project metrics from general market commentary. Never promise future appreciation.',
  NEGOTIATION_ASSISTANCE:
    'Suggest value-based negotiation talking points within the builder’s authorized discount policy.',
  SALES_PERFORMANCE_INSIGHTS:
    'Summarize pipeline velocity, visit-to-booking conversion, and agent follow-up bottlenecks from the provided metrics.',
  FOLLOW_UP_RECOMMENDATIONS:
    'Recommend timing and talking points for the next buyer follow-up based on recent activities.',
  DOCUMENT_INFO_EXTRACTION:
    'Extract key structured fields from the provided document text or metadata.',
  ADMIN_NL_REPORT:
    'Answer the executive natural-language reporting query strictly using the supplied aggregated organization records.',
  CONVERSATIONAL_ORCHESTRATION:
    'Coordinate progressive multi-turn real estate CRM and inventory configuration strictly within authorized context.',
  FLOOR_PLAN_VISION_EXTRACTION:
    'Extract verifiable floor, unit, BHK, area, and facing fields from architectural floor plans without extrapolating unsupported floors.',
  DOCUMENT_ESCALATION_EXTRACTION:
    'Reconcile multi-page architectural tower schedules and layout ambiguities conservatively.',
  INTENT_CLASSIFICATION:
    'Classify the user CRM or inventory intent accurately.',
};

export async function executeAiTaskService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    feature: AiFeatureTask;
    context: Record<string, unknown>;
    entityType?: string;
    entityId?: string;
  },
  customClient?: Pick<OpenAI, 'chat'>
): Promise<{ text: string; log: AiUsageLog }> {
  const startMs = Date.now();
  const nowIso = new Date().toISOString();

  // 1. Check SaaS AI Credit Budget
  const subRef = db.collection('subscriptions').doc(params.orgId);
  const subSnap = await subRef.get();
  if (subSnap.exists) {
    const sub = subSnap.data() as Subscription;
    const totalAllowed =
      sub.entitlements.monthlyAiCredits + (sub.addons?.extraAiCredits ?? 0);
    if (sub.usageThisCycle.aiCreditsUsed >= totalAllowed) {
      const blockedRef = db.collection('ai_usage_logs').doc();
      await blockedRef.set({
        id: blockedRef.id,
        orgId: params.orgId,
        uid: actor.uid,
        feature: params.feature,
        model: 'NONE',
        promptVersion: PROMPT_VERSION,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        creditsConsumed: 0,
        latencyMs: Date.now() - startMs,
        status: 'BUDGET_BLOCKED',
        createdAt: nowIso,
      } satisfies AiUsageLog);

      throw new HttpsError(
        'resource-exhausted',
        `Monthly AI credit limit (${totalAllowed}) reached. Purchase an AI credit pack in Settings -> SaaS Subscription.`
      );
    }
  }

  // 2. Verify OpenAI API Key Configuration (Never simulate fake AI output!)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !customClient) {
    const unconfRef = db.collection('ai_usage_logs').doc();
    await unconfRef.set({
      id: unconfRef.id,
      orgId: params.orgId,
      uid: actor.uid,
      feature: params.feature,
      model: 'UNCONFIGURED',
      promptVersion: PROMPT_VERSION,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      creditsConsumed: 0,
      latencyMs: Date.now() - startMs,
      status: 'UNCONFIGURED',
      createdAt: nowIso,
    } satisfies AiUsageLog);

    throw new HttpsError(
      'failed-precondition',
      'OpenAI integration is not active: set OPENAI_API_KEY in Cloud Functions secret environment.'
    );
  }

  const isComplex = COMPLEX_TASKS.has(params.feature);
  const model = isComplex
    ? process.env.OPENAI_MODEL_PRIMARY || 'gpt-4o'
    : process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini';

  const openai = customClient ?? new OpenAI({ apiKey });

  const systemPrompt = [
    'You are Bharat Makaan Enterprise AI, assisting authorized real estate builders, sales managers, and CRM teams.',
    'STRICT GUARDRAILS:',
    '1. Use ONLY the authorized database records provided in JSON context.',
    '2. NEVER invent prices, unit availability, RERA registration numbers, approvals, or expected appreciation.',
    '3. Keep responses concise, accurate, and executive-ready.',
    `Task instruction: ${TASK_INSTRUCTIONS[params.feature]}`,
  ].join('\n');

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 600,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(params.context) },
    ],
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? '';
  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const creditsConsumed = isComplex ? 5 : 1;
  const estimatedCostUsd = Number(
    ((inputTokens * 0.0000025 + outputTokens * 0.00001)).toFixed(6)
  );

  const logRef = db.collection('ai_usage_logs').doc();
  const log: AiUsageLog = {
    id: logRef.id,
    orgId: params.orgId,
    uid: actor.uid,
    feature: params.feature,
    model,
    promptVersion: PROMPT_VERSION,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    creditsConsumed,
    entityType: params.entityType,
    entityId: params.entityId,
    latencyMs: Date.now() - startMs,
    status: 'SUCCESS',
    createdAt: nowIso,
  };

  await logRef.set(log);

  if (subSnap.exists) {
    const sub = subSnap.data() as Subscription;
    await subRef.update({
      'usageThisCycle.aiCreditsUsed':
        (sub.usageThisCycle?.aiCreditsUsed ?? 0) + creditsConsumed,
      updatedAt: nowIso,
    });
  }

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    action: `AI_${params.feature}`,
    category: 'AI',
    entityType: params.entityType ?? 'ai_task',
    entityId: params.entityId ?? log.id,
    summary: `Executed OpenAI ${params.feature} (${model}, ${inputTokens + outputTokens} tokens).`,
  });

  return { text, log };
}

const aiTaskEnum = z.enum([
  'LEAD_QUALIFICATION',
  'BUYER_REQUIREMENT_EXTRACTION',
  'PROPERTY_MATCHING',
  'WHATSAPP_REPLY_DRAFT',
  'COST_SHEET_EXPLANATION',
  'FLOOR_PLAN_ANALYSIS',
  'BROCHURE_SUMMARIZATION',
  'PRICE_COMPARISON_EXPLANATION',
  'MARKET_INTELLIGENCE',
  'NEGOTIATION_ASSISTANCE',
  'SALES_PERFORMANCE_INSIGHTS',
  'FOLLOW_UP_RECOMMENDATIONS',
  'DOCUMENT_INFO_EXTRACTION',
  'ADMIN_NL_REPORT',
]);

export const runAiAssistant = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    feature: aiTaskEnum,
    context: z.record(z.string(), z.unknown()),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
  });
  const input = schema.parse(request.data);
  const perm = input.feature === 'ADMIN_NL_REPORT' ? 'ai:admin_reports' : 'ai:use';
  const { actor } = await requireOrgPermission(request, input.orgId, perm);

  return executeAiTaskService(adminDb, actor, input);
});

// --- Conversational AI Assistant, Floor-Plan Extraction & Staged Inventory Callables ---

export const createAiAssistantSession = onCall(async (request) => {
  const actor = requireAuth(request);
  return createAiSessionService(adminDb, actor, request.data);
});

export const sendAiAssistantMessage = onCall(async (request) => {
  const actor = requireAuth(request);
  return sendAiAssistantMessageService(adminDb, actor, request.data);
});

export const analyzeAiFloorPlanDocuments = onCall(async (request) => {
  const actor = requireAuth(request);
  return analyzeFloorPlanDocumentsService(adminDb, actor, request.data);
});

export const updateAiInventoryDraft = onCall(async (request) => {
  const actor = requireAuth(request);
  return updateAiInventoryDraftService(adminDb, actor, request.data);
});

export const confirmAndCommitAiDraft = onCall(async (request) => {
  const actor = requireAuth(request);
  return commitApprovedInventoryDraftService(adminDb, actor, request.data);
});

export const cancelAiInventoryDraft = onCall(async (request) => {
  const actor = requireAuth(request);
  return cancelInventoryDraftService(adminDb, actor, request.data);
});

export const retryAiImportJob = onCall(async (request) => {
  const actor = requireAuth(request);
  const schema = z.object({
    orgId: z.string().min(1),
    jobId: z.string().min(1),
  });
  const input = schema.parse(request.data);
  return retryImportJobService({
    db: adminDb,
    actor,
    orgId: input.orgId,
    jobId: input.jobId,
  });
});

export const getAiImportJobStatus = onCall(async (request) => {
  const actor = requireAuth(request);
  const schema = z.object({
    orgId: z.string().min(1),
    jobId: z.string().min(1),
  });
  const input = schema.parse(request.data);
  return getJobStatusTool({
    db: adminDb,
    actor,
    orgId: input.orgId,
    jobId: input.jobId,
  });
});

export const validateAiModelConfiguration = onCall(async (request) => {
  const schema = z.object({ orgId: z.string().min(1) });
  const input = schema.parse(request.data);
  await requireOrgPermission(request, input.orgId, 'settings:view');
  return validateOpenAiAccountModels();
});

export * from './models';
export * from './tools';
export * from './import-executor';
export * from './document-extraction';
export * from './session-service';
