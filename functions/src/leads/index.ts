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
import {
  createLeadSchema,
  convertLeadToCustomerSchema,
} from '@bharat-makaan/validation';
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
    isCustomer: Boolean(input.isCustomer),
    customerConvertedAt: input.isCustomer ? nowIso : null,
    convertedByUid: input.isCustomer ? actor.uid : null,
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
    expectedStage?: LeadStage;
    lostReason?: string;
    qualificationStatus?: Lead['qualificationStatus'];
  }
): Promise<Lead> {
  const ref = db.collection('leads').doc(params.leadId);
  const reason = params.lostReason?.trim();
  const requiresReason = params.stage === 'LOST' || params.stage === 'UNQUALIFIED';
  if (requiresReason && (!reason || reason.length < 2)) {
    throw new HttpsError('invalid-argument', 'Reason is required when marking a lead Lost or Unqualified.');
  }

  return db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as Lead | undefined;
    if (!prev || prev.orgId !== params.orgId) {
      throw new HttpsError('not-found', 'Lead not found.');
    }
    if (params.expectedStage && prev.stage !== params.expectedStage) {
      throw new HttpsError('failed-precondition', 'This lead changed stage elsewhere. Check its current stage and try again.');
    }
    if (prev.stage === params.stage && !params.qualificationStatus) return prev;

    const qualificationStatus = params.qualificationStatus ?? prev.qualificationStatus;
    const now = new Date().toISOString();
    const changes = {
      stage: params.stage,
      lostReason: requiresReason ? (reason ?? '') : '',
      ...(qualificationStatus ? { qualificationStatus } : {}),
      leadScore: computeDeterministicLeadScore({ ...prev, stage: params.stage, qualificationStatus }),
      updatedAt: now,
    };
    tx.update(ref, changes);
    if (prev.stage !== params.stage) {
      const activity = db.collection('lead_activities').doc();
      tx.set(activity, {
        id: activity.id,
        orgId: params.orgId,
        leadId: prev.id,
        type: 'STAGE_CHANGE',
        title: 'Moved from ' + prev.stage + ' to ' + params.stage,
        ...(requiresReason && reason ? { body: reason } : {}),
        performedByUid: actor.uid,
        createdAt: now,
      } satisfies LeadActivity);
    }
    return { ...prev, ...changes };
  });
}

export async function convertLeadToCustomerService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    leadId: string;
    unitId?: string;
    notes?: string;
  }
): Promise<Lead> {
  const ref = db.collection('leads').doc(params.leadId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Lead not found.');
  }

  const prev = snap.data() as Lead;
  const nowIso = new Date().toISOString();

  let unitNumberNotice = '';
  if (params.unitId) {
    const uSnap = await db.collection('units').doc(params.unitId).get();
    if (uSnap.exists && uSnap.data()?.orgId === params.orgId) {
      unitNumberNotice = ` for Flat ${uSnap.data()?.unitNumber}`;
    }
  }

  const updated: Lead = {
    ...prev,
    isCustomer: true,
    customerConvertedAt: prev.customerConvertedAt || nowIso,
    convertedByUid: actor.uid,
    updatedAt: nowIso,
  };

  await ref.set(updated);

  const actRef = db.collection('lead_activities').doc();
  await actRef.set({
    id: actRef.id,
    orgId: params.orgId,
    leadId: updated.id,
    type: 'STAGE_CHANGE',
    title: `Converted from Prospect to Customer${unitNumberNotice}`,
    body: params.notes
      ? `${params.notes}${unitNumberNotice ? ` (${unitNumberNotice.trim()})` : ''}`
      : `Prospect ${prev.customerName} successfully converted to verified buyer customer${unitNumberNotice}.`,
    performedByUid: actor.uid,
    createdAt: nowIso,
  } satisfies LeadActivity);

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'LEAD_CONVERTED_TO_CUSTOMER',
    category: 'SYSTEM',
    entityType: 'lead',
    entityId: updated.id,
    summary: `Prospect ${updated.customerName} converted to Customer.`,
  });

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

export const convertLeadToCustomer = onCall(async (request) => {
  const input = convertLeadToCustomerSchema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'leads:edit');
  return convertLeadToCustomerService(adminDb, actor, input);
});

const leadStageSchema = z.enum([
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
]);

export const updateLeadStage = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    leadId: z.string().min(1),
    stage: leadStageSchema,
    expectedStage: leadStageSchema.optional(),
    lostReason: z.string().trim().max(500).optional(),
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
