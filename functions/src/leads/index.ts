import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  GLOBAL_COUNTRIES,
  computeDeterministicLeadScore,
  normalizeEmail,
  normalizeGlobalPhone,
  type Lead,
  type LeadActivity,
  type LeadStage,
  type Organization,
  type Project,
} from '@bharat-makaan/shared';
import { createLeadSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { parseCallableInput } from '../shared/validation';
import { writeAuditEvent } from '../audit';

/**
 * Universal Lead Ingestion Service:
 * Capture -> Validate -> Normalize -> Deduplicate -> Attribute -> Assign -> Qualify -> Follow Up
 */
export async function ingestLeadService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<{ lead: Lead; deduplicated: boolean }> {
  const input = parseCallableInput(createLeadSchema, rawInput);
  const nowIso = new Date().toISOString();
  const orgSnap = await db.collection('organizations').doc(input.orgId).get();
  const org = orgSnap.exists ? (orgSnap.data() as Organization) : null;
  const callingCode =
    GLOBAL_COUNTRIES[(org?.countryCode ?? 'IN').toUpperCase()]?.callingCode ?? '+91';
  const normalizedPhone = normalizeGlobalPhone(input.phone, callingCode);
  const normalizedEmail = normalizeEmail(input.email);
  const primaryProjectId = input.projectId ?? input.preferredProjectIds[0] ?? null;
  const preferredProjectIds = Array.from(
    new Set([
      ...(primaryProjectId ? [primaryProjectId] : []),
      ...input.preferredProjectIds,
    ])
  );

  // Deduplication check within the same builder organization
  const existingSnap = await db
    .collection('leads')
    .where('orgId', '==', input.orgId)
    .where('normalizedPhone', '==', normalizedPhone)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const existingLead = existingSnap.docs[0]!.data() as Lead;
    const mergedProjects = Array.from(
      new Set([...existingLead.preferredProjectIds, ...preferredProjectIds])
    );

    await existingSnap.docs[0]!.ref.update({
      projectId: existingLead.projectId ?? primaryProjectId,
      preferredProjectIds: mergedProjects,
      updatedAt: nowIso,
    });

    const actRef = db.collection('lead_activities').doc();
    const activity: LeadActivity = {
      id: actRef.id,
      orgId: input.orgId,
      leadId: existingLead.id,
      type: 'NOTE',
      title: `Duplicate Enquiry Merged (${input.source})`,
      body: input.notes || `Repeat enquiry captured from ${input.source}. Existing ownership preserved.`,
      performedByUid: actor.uid,
      createdAt: nowIso,
    };
    await actRef.set(activity);

    return {
      lead: {
        ...existingLead,
        projectId: existingLead.projectId ?? primaryProjectId,
        preferredProjectIds: mergedProjects,
        updatedAt: nowIso,
      },
      deduplicated: true,
    };
  }

  const score = computeDeterministicLeadScore({
    budgetMaxInr: input.budgetMaxInr,
    buyingTimeline: input.buyingTimeline,
    preferredProjectIds,
    email: normalizedEmail,
    stage: 'NEW',
    qualificationStatus: 'UNREVIEWED',
  });

  const leadRef = db.collection('leads').doc();
  const lead: Lead = {
    id: leadRef.id,
    orgId: input.orgId,
    projectId: primaryProjectId,
    currencyCode: input.currencyCode ?? org?.defaultCurrency ?? 'INR',
    customerName: input.customerName.trim(),
    phone: input.phone.trim(),
    normalizedPhone,
    email: input.email?.trim() || undefined,
    normalizedEmail,
    source: input.source,
    campaign: input.campaign?.trim() || undefined,
    budgetMinInr: input.budgetMinInr,
    budgetMaxInr: input.budgetMaxInr,
    preferredLocation: input.preferredLocation?.trim() || undefined,
    preferredProjectIds,
    bhkPreference: input.bhkPreference,
    propertyType: input.propertyType,
    buyingTimeline: input.buyingTimeline,
    assignedAgentUid: input.assignedAgentUid ?? (actor.uid !== 'PUBLIC_CAPTURE' ? actor.uid : null),
    partnerOrgId: input.partnerOrgId ?? null,
    partnerAgentUid: null,
    protectionExpiresAt: null,
    stage: 'NEW',
    qualificationStatus: score >= 65 ? 'HOT' : score >= 45 ? 'WARM' : 'UNREVIEWED',
    leadScore: score,
    duplicateOfLeadId: null,
    notesSummary: input.notes?.trim() || undefined,
    nextFollowUpAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    linkedQuotationIds: [],
    linkedBookingIds: [],
    whatsappOptIn: input.whatsappOptIn,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await leadRef.set(lead);

  // Increment project lead stats
  for (const pid of lead.preferredProjectIds) {
    const pRef = db.collection('projects').doc(pid);
    const pSnap = await pRef.get();
    if (pSnap.exists && pSnap.data()?.orgId === input.orgId) {
      const p = pSnap.data() as Project;
      await pRef.update({
        'stats.totalLeads': (p.stats?.totalLeads ?? 0) + 1,
        'stats.pendingTasksCount': (p.stats?.pendingTasksCount ?? 0) + 1,
        updatedAt: nowIso,
      });
    }
  }

  const actRef = db.collection('lead_activities').doc();
  await actRef.set({
    id: actRef.id,
    orgId: input.orgId,
    leadId: lead.id,
    type: 'FOLLOW_UP',
    title: 'Initial Lead Follow-Up Scheduled',
    body: input.notes || `Lead captured via ${lead.source} (Score: ${score}/100).`,
    dueAt: lead.nextFollowUpAt ?? undefined,
    completedAt: null,
    performedByUid: actor.uid,
    createdAt: nowIso,
  } satisfies LeadActivity);

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'LEAD_INGESTED',
    category: 'SYSTEM',
    entityType: 'lead',
    entityId: lead.id,
    summary: `Captured lead ${lead.customerName} (${lead.normalizedPhone}) via ${lead.source}.`,
  });

  return { lead, deduplicated: false };
}

export async function updateLeadStageService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    leadId: string;
    stage: LeadStage;
    lostReason?: string;
    qualificationStatus?: Lead['qualificationStatus'];
  }
): Promise<Lead> {
  const ref = db.collection('leads').doc(params.leadId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Lead not found.');
  }

  if (
    (params.stage === 'LOST' || params.stage === 'UNQUALIFIED') &&
    (!params.lostReason || params.lostReason.trim().length < 2)
  ) {
    throw new HttpsError('invalid-argument', 'Reason is required when marking a lead Lost or Unqualified.');
  }

  const prev = snap.data() as Lead;
  const nowIso = new Date().toISOString();
  const nextScore = computeDeterministicLeadScore({
    ...prev,
    stage: params.stage,
    qualificationStatus: params.qualificationStatus ?? prev.qualificationStatus,
  });

  const updated: Lead = {
    ...prev,
    stage: params.stage,
    lostReason: params.lostReason ?? prev.lostReason,
    qualificationStatus: params.qualificationStatus ?? prev.qualificationStatus,
    leadScore: nextScore,
    updatedAt: nowIso,
  };

  await ref.set(updated);

  const actRef = db.collection('lead_activities').doc();
  await actRef.set({
    id: actRef.id,
    orgId: params.orgId,
    leadId: updated.id,
    type: 'STAGE_CHANGE',
    title: `Pipeline Stage: ${prev.stage} -> ${updated.stage}`,
    body: params.lostReason,
    performedByUid: actor.uid,
    createdAt: nowIso,
  } satisfies LeadActivity);

  return updated;
}

// --- Cloud Functions v2 Callables ---

export const createLead = onCall(async (request) => {
  const parsed = parseCallableInput(createLeadSchema, request.data);
  const targetProjectId = parsed.projectId ?? parsed.preferredProjectIds[0] ?? null;
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'leads:create',
    targetProjectId
  );
  return ingestLeadService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const updateLeadStage = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    leadId: z.string().min(1),
    stage: z.enum([
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'INTERESTED',
      'VISIT_SCHEDULED',
      'VISITED',
      'NEGOTIATION',
      'BOOKED',
      'CLOSED',
      'LOST',
      'UNQUALIFIED',
    ]),
    lostReason: z.string().optional(),
    qualificationStatus: z
      .enum(['UNREVIEWED', 'HOT', 'WARM', 'COLD', 'DISQUALIFIED'])
      .optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'leads:edit');
  return updateLeadStageService(adminDb, actor, input);
});

export const addLeadActivity = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    leadId: z.string().min(1),
    type: z.enum(['NOTE', 'CALL', 'TASK', 'FOLLOW_UP']),
    title: z.string().min(2).max(140),
    body: z.string().max(1500).optional(),
    dueAt: z.string().optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'leads:edit');

  const nowIso = new Date().toISOString();
  const ref = adminDb.collection('lead_activities').doc();
  const activity: LeadActivity = {
    id: ref.id,
    orgId: input.orgId,
    leadId: input.leadId,
    type: input.type,
    title: input.title.trim(),
    body: input.body?.trim(),
    dueAt: input.dueAt,
    completedAt: null,
    performedByUid: actor.uid,
    createdAt: nowIso,
  };
  await ref.set(activity);

  if (input.dueAt) {
    await adminDb.collection('leads').doc(input.leadId).update({
      nextFollowUpAt: input.dueAt,
      updatedAt: nowIso,
    });
  }

  return activity;
});

export const bulkAssignLeads = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    leadIds: z.array(z.string()).min(1).max(200),
    targetAgentUid: z.string().min(1),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'leads:assign');

  const nowIso = new Date().toISOString();
  const batch = adminDb.batch();
  for (const lid of input.leadIds) {
    batch.update(adminDb.collection('leads').doc(lid), {
      assignedAgentUid: input.targetAgentUid,
      updatedAt: nowIso,
    });
  }
  await batch.commit();

  await writeAuditEvent(adminDb, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'LEADS_BULK_ASSIGNED',
    category: 'SYSTEM',
    entityType: 'lead',
    entityId: input.targetAgentUid,
    summary: `Assigned ${input.leadIds.length} lead(s) to agent ${input.targetAgentUid}.`,
  });

  return { assignedCount: input.leadIds.length };
});

export * from './public-portal';
