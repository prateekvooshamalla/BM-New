import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import OpenAI from 'openai';
import {
  DEFAULT_OPENAI_MODELS,
  type AiFeatureTask,
  type AiUsageLog,
  type Subscription,
} from '@bharat-makaan/shared';
import type { AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';
import {
  calculateAiUsageCostPaise,
  releaseWalletReservationService,
  reserveWalletBalanceService,
  settleAiWalletUsageService,
} from '../billing';

export const AI_PROMPT_VERSION = 'bm-ai-assistant-v2.0';

export interface ConfiguredAiModels {
  orchestrator: string;
  visionFloorPlan: string;
  complexEscalation: string;
  fastClassifier: string;
}

export function getConfiguredAiModels(): ConfiguredAiModels {
  return {
    orchestrator:
      process.env.OPENAI_MODEL_ORCHESTRATOR ||
      process.env.OPENAI_MODEL_PRIMARY ||
      DEFAULT_OPENAI_MODELS.orchestrator,
    visionFloorPlan:
      process.env.OPENAI_MODEL_VISION_FLOORPLAN || DEFAULT_OPENAI_MODELS.visionFloorPlan,
    complexEscalation:
      process.env.OPENAI_MODEL_ESCALATION || DEFAULT_OPENAI_MODELS.complexEscalation,
    fastClassifier:
      process.env.OPENAI_MODEL_CLASSIFIER ||
      process.env.OPENAI_MODEL_FAST ||
      DEFAULT_OPENAI_MODELS.fastClassifier,
  };
}

export interface MinimalResponsesClient {
  responses: {
    create: (params: Record<string, unknown>) => Promise<{
      id?: string;
      model?: string;
      output_text?: string;
      output?: Array<{
        type?: string;
        name?: string;
        arguments?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    }>;
  };
  models?: {
    list: () => Promise<{ data?: Array<{ id: string }> } | AsyncIterable<{ id: string }>>;
  };
}

/**
 * Validates whether the configured preferred OpenAI models exist in the active OpenAI account.
 * Never fabricates availability when `OPENAI_API_KEY` is unconfigured.
 */
export async function validateOpenAiAccountModels(
  injectedClient?: MinimalResponsesClient
): Promise<{
  configured: ConfiguredAiModels;
  apiKeyPresent: boolean;
  verifiedModels: Record<string, boolean>;
}> {
  const configured = getConfiguredAiModels();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !injectedClient) {
    return {
      configured,
      apiKeyPresent: false,
      verifiedModels: {
        [configured.orchestrator]: false,
        [configured.visionFloorPlan]: false,
        [configured.complexEscalation]: false,
        [configured.fastClassifier]: false,
      },
    };
  }

  const client = (injectedClient ?? new OpenAI({ apiKey })) as MinimalResponsesClient;
  const availableIds = new Set<string>();

  if (client.models?.list) {
    const res = await client.models.list();
    if ('data' in res && Array.isArray(res.data)) {
      for (const m of res.data) availableIds.add(m.id);
    } else if (Symbol.asyncIterator in Object(res)) {
      for await (const m of res as AsyncIterable<{ id: string }>) {
        availableIds.add(m.id);
      }
    }
  }

  return {
    configured,
    apiKeyPresent: true,
    verifiedModels: {
      [configured.orchestrator]: availableIds.has(configured.orchestrator),
      [configured.visionFloorPlan]: availableIds.has(configured.visionFloorPlan),
      [configured.complexEscalation]: availableIds.has(configured.complexEscalation),
      [configured.fastClassifier]: availableIds.has(configured.fastClassifier),
    },
  };
}

/**
 * Defends against prompt-injection embedded inside untrusted PDFs, CAD labels, or image OCR.
 * Strips instruction-override phrases and wraps content in an explicit non-executable envelope.
 */
export function sanitizeUntrustedDocumentText(rawText: string, maxChars = 12000): string {
  const cleaned = rawText
    .replace(/<\/?UNTRUSTED_DOCUMENT_DATA>/gi, '')
    .replace(
      /\b(ignore\s+(all\s+)?(previous|prior|above)\s+instructions|system\s*prompt|you\s+are\s+now|execute\s+tool|delete\s+all|override\s+permissions)\b/gi,
      '[REDACTED_UNTRUSTED_DIRECTIVE]'
    )
    .slice(0, maxChars);

  return `<UNTRUSTED_DOCUMENT_DATA>\n${cleaned}\n</UNTRUSTED_DOCUMENT_DATA>`;
}

/**
 * Enforces per-user/org AI rate limiting inside `_rate_limits` collection.
 */
export async function enforceAiRateLimit(
  db: Firestore,
  orgId: string,
  uid: string,
  maxRequestsPerMinute = 30
): Promise<void> {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `ai_${orgId}_${uid}_${minuteBucket}`;
  const ref = db.collection('_rate_limits').doc(key);
  const snap = await ref.get();
  const current = (snap.data()?.count as number | undefined) ?? 0;
  if (current >= maxRequestsPerMinute) {
    throw new HttpsError(
      'resource-exhausted',
      'AI Assistant rate limit exceeded. Please wait a moment before sending more requests.'
    );
  }
  await ref.set(
    {
      count: current + 1,
      orgId,
      uid,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

/**
 * Checks & deducts SaaS AI credits and invokes the official OpenAI Responses API
 * (`client.responses.create`) with strict JSON Schema Structured Outputs.
 */
export async function invokeStructuredResponsesApi<T>(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  feature: AiFeatureTask;
  model: string;
  instructions: string;
  input: string | Array<Record<string, unknown>>;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  creditsCost?: number;
  requestId?: string;
  entityType?: string;
  entityId?: string;
  customClient?: MinimalResponsesClient;
}): Promise<{ parsed: T; modelUsed: string; log: AiUsageLog; deduplicated?: boolean }> {
  const startMs = Date.now();
  const nowIso = new Date().toISOString();
  const creditsCost = params.creditsCost ?? 2;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !params.customClient) {
    throw new HttpsError(
      'failed-precondition',
      'OpenAI Responses API key (`OPENAI_API_KEY`) is not configured in backend environment.'
    );
  }

  const requestId =
    params.requestId || `ai_resp_${params.orgId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const estimatedPaise = Math.max(50, creditsCost * 25);

  const subRef = params.db.collection('subscriptions').doc(params.orgId);
  const subSnap = await subRef.get();

  try {
    const reservation = await reserveWalletBalanceService(params.db, {
      orgId: params.orgId,
      walletType: 'AI',
      requestId,
      estimatedPaise,
      actorUid: params.actor.uid,
      summary: `Reserve AI Wallet for ${params.feature} (${params.model})`,
    });

    if (reservation.alreadySettled) {
      const existingLogSnap = await params.db
        .collection('ai_usage_logs')
        .where('orgId', '==', params.orgId)
        .where('entityId', '==', requestId)
        .limit(1)
        .get();
      if (!existingLogSnap.empty) {
        const prev = existingLogSnap.docs[0]!.data() as AiUsageLog & { cachedOutput?: T };
        if (prev.cachedOutput !== undefined) {
          return {
            parsed: prev.cachedOutput,
            modelUsed: prev.model,
            log: prev,
            deduplicated: true,
          };
        }
      }
    }
  } catch (err) {
    const blockedRef = params.db.collection('ai_usage_logs').doc();
    await blockedRef.set({
      id: blockedRef.id,
      orgId: params.orgId,
      uid: params.actor.uid,
      feature: params.feature,
      model: params.model,
      promptVersion: AI_PROMPT_VERSION,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      creditsConsumed: 0,
      latencyMs: Date.now() - startMs,
      status: 'BUDGET_BLOCKED',
      createdAt: nowIso,
    } satisfies AiUsageLog);
    throw err;
  }

  const client = (params.customClient ?? new OpenAI({ apiKey })) as MinimalResponsesClient;

  let response: Awaited<ReturnType<MinimalResponsesClient['responses']['create']>>;
  try {
    response = await client.responses.create({
      model: params.model,
      instructions: params.instructions,
      input: params.input,
      text: {
        format: {
          type: 'json_schema',
          name: params.schemaName,
          strict: true,
          schema: params.jsonSchema,
        },
      },
    });
  } catch (err) {
    await releaseWalletReservationService(params.db, {
      orgId: params.orgId,
      walletType: 'AI',
      requestId,
      reason: err instanceof Error ? err.message : 'OpenAI provider error',
    });
    throw err;
  }

  let rawJson = response.output_text ?? '';
  if (!rawJson && Array.isArray(response.output)) {
    for (const item of response.output) {
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.text) rawJson += c.text;
        }
      }
    }
  }

  const parsed = JSON.parse(rawJson) as T;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const resolvedModel = response.model || params.model;
  const cost = calculateAiUsageCostPaise(resolvedModel, inputTokens, outputTokens);

  await settleAiWalletUsageService(params.db, {
    orgId: params.orgId,
    requestId,
    actorUid: params.actor.uid,
    feature: params.feature,
    model: resolvedModel,
    inputTokens,
    outputTokens,
  });

  const logRef = params.db.collection('ai_usage_logs').doc();
  const log: AiUsageLog = {
    id: logRef.id,
    orgId: params.orgId,
    uid: params.actor.uid,
    feature: params.feature,
    model: resolvedModel,
    promptVersion: AI_PROMPT_VERSION,
    inputTokens,
    outputTokens,
    estimatedCostUsd: cost.estimatedCostUsd,
    creditsConsumed: creditsCost,
    entityType: params.entityType ?? 'ai_request',
    entityId: params.requestId ?? params.entityId,
    latencyMs: Date.now() - startMs,
    status: 'SUCCESS',
    createdAt: nowIso,
  };
  await logRef.set({ ...log, cachedOutput: parsed });

  if (subSnap.exists) {
    const sub = subSnap.data() as Subscription;
    await subRef.update({
      'usageThisCycle.aiCreditsUsed':
        (sub.usageThisCycle?.aiCreditsUsed ?? 0) + creditsCost,
      updatedAt: nowIso,
    });
  }

  await writeAuditEvent(params.db, {
    orgId: params.orgId,
    actorUid: params.actor.uid,
    actorEmail: params.actor.email,
    action: `AI_RESPONSES_${params.feature}`,
    category: 'AI',
    entityType: params.entityType ?? 'ai_session',
    entityId: params.entityId ?? log.id,
    summary: `Executed OpenAI Responses API ${params.feature} (${log.model}, ${inputTokens + outputTokens} tokens, ₹${(
      cost.chargePaise / 100
    ).toFixed(2)}).`,
  });

  return { parsed, modelUsed: log.model, log };
}
