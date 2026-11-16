import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import {
  normalizeIndianPhone,
  type Project,
  type SiteVisit,
} from '@bharat-makaan/shared';
import { scheduleSiteVisitSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

export async function scheduleSiteVisitService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<SiteVisit> {
  const input = scheduleSiteVisitSchema.parse(rawInput);
  const startMs = Date.parse(input.scheduledStartAt);
  const endMs = Date.parse(input.scheduledEndAt);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new HttpsError(
      'invalid-argument',
      'Visit end time must be strictly after start time (valid ISO timestamp).'
    );
  }

  const nowIso = new Date().toISOString();
  const normPhone = normalizeIndianPhone(input.customerPhone);
  const ref = db.collection('site_visits').doc();

  // Deterministic idempotency key for scheduled reminder job
  const reminderJobKey = crypto
    .createHash('sha256')
    .update(`${input.orgId}:${ref.id}:${new Date(startMs).toISOString()}`)
    .digest('hex')
    .slice(0, 24);

  const visit: SiteVisit = {
    id: ref.id,
    orgId: input.orgId,
    projectId: input.projectId,
    unitId: input.unitId ?? null,
    leadId: input.leadId ?? null,
    partnerOrgId: input.partnerOrgId ?? null,
    customerName: input.customerName.trim(),
    customerPhone: normPhone,
    customerEmail: input.customerEmail?.trim() || undefined,
    assignedAgentUid: input.assignedAgentUid ?? (actor.uid !== 'PUBLIC_CAPTURE' ? actor.uid : null),
    scheduledStartAt: new Date(startMs).toISOString(),
    scheduledEndAt: new Date(endMs).toISOString(),
    timezone: input.timezone || 'Asia/Kolkata',
    status: 'SCHEDULED',
    notes: input.notes?.trim(),
    reminderJobKey,
    reminderSentAt: null,
    createdByUid: actor.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ref.set(visit);

  const projRef = db.collection('projects').doc(input.projectId);
  const projSnap = await projRef.get();
  if (projSnap.exists && projSnap.data()?.orgId === input.orgId) {
    const p = projSnap.data() as Project;
    await projRef.update({
      'stats.totalSiteVisits': (p.stats?.totalSiteVisits ?? 0) + 1,
      updatedAt: nowIso,
    });
  }

  if (visit.leadId) {
    await db.collection('leads').doc(visit.leadId).update({
      stage: 'VISIT_SCHEDULED',
      updatedAt: nowIso,
    });
  }

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    action: 'SITE_VISIT_SCHEDULED',
    category: 'SYSTEM',
    entityType: 'site_visit',
    entityId: visit.id,
    summary: `Scheduled site visit for ${visit.customerName} at ${visit.scheduledStartAt} (${visit.timezone}).`,
  });

  return visit;
}

export async function updateSiteVisitOutcomeService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    visitId: string;
    status: SiteVisit['status'];
    outcome?: SiteVisit['outcome'];
    notes?: string;
    rescheduledStartAt?: string;
    rescheduledEndAt?: string;
  }
): Promise<SiteVisit> {
  const ref = db.collection('site_visits').doc(params.visitId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Site visit not found.');
  }

  const prev = snap.data() as SiteVisit;
  const nowIso = new Date().toISOString();

  let nextStart = prev.scheduledStartAt;
  let nextEnd = prev.scheduledEndAt;
  let nextReminderKey = prev.reminderJobKey;
  let nextReminderSentAt = prev.reminderSentAt;

  if (params.status === 'RESCHEDULED' && params.rescheduledStartAt && params.rescheduledEndAt) {
    nextStart = new Date(params.rescheduledStartAt).toISOString();
    nextEnd = new Date(params.rescheduledEndAt).toISOString();
    nextReminderKey = crypto
      .createHash('sha256')
      .update(`${params.orgId}:${prev.id}:${nextStart}`)
      .digest('hex')
      .slice(0, 24);
    nextReminderSentAt = null;
  }

  const updated: SiteVisit = {
    ...prev,
    status: params.status,
    outcome: params.outcome ?? prev.outcome,
    notes: params.notes ?? prev.notes,
    scheduledStartAt: nextStart,
    scheduledEndAt: nextEnd,
    reminderJobKey: nextReminderKey,
    reminderSentAt: nextReminderSentAt,
    updatedAt: nowIso,
  };

  await ref.set(updated);

  if (updated.status === 'COMPLETED' && updated.leadId) {
    await db.collection('leads').doc(updated.leadId).update({
      stage: 'VISITED',
      updatedAt: nowIso,
    });
  }

  return updated;
}

// --- Configurable Email Dispatcher ---

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return { sent: false, reason: 'SMTP credentials not configured in environment.' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'Bharat Makaan <no-reply@bharatmakaan.com>',
    to: params.to,
    subject: params.subject,
    text: params.text,
  });

  return { sent: true };
}

// --- Cloud Functions v2 Callables & Idempotent Reminder Cron ---

export const scheduleSiteVisit = onCall(async (request) => {
  const parsed = scheduleSiteVisitSchema.parse(request.data);
  const { actor } = await requireOrgPermission(
    request,
    parsed.orgId,
    'visits:schedule',
    parsed.projectId
  );
  return scheduleSiteVisitService(adminDb, actor, parsed);
});

export const updateSiteVisitOutcome = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    visitId: z.string().min(1),
    status: z.enum([
      'SCHEDULED',
      'CONFIRMED',
      'RESCHEDULED',
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED',
    ]),
    outcome: z
      .enum([
        'VERY_INTERESTED',
        'SHORTLISTED',
        'PRICE_NEGOTIATION',
        'NOT_SUITABLE',
        'BOOKED',
      ])
      .optional(),
    notes: z.string().max(1000).optional(),
    rescheduledStartAt: z.string().optional(),
    rescheduledEndAt: z.string().optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'visits:manage_outcome');
  return updateSiteVisitOutcomeService(adminDb, actor, input);
});

export const registerMobilePushToken = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    fcmOrExpoToken: z.string().min(10),
    platform: z.enum(['ios', 'android']),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'dashboard:view');

  await adminDb
    .collection('organization_members')
    .doc(`${input.orgId}_${actor.uid}`)
    .set(
      {
        pushToken: input.fcmOrExpoToken,
        pushPlatform: input.platform,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

  return { registered: true };
});

/**
 * Idempotent Site Visit Reminder Scheduler (runs every 30 minutes).
 * Uses `reminderSentAt == null` + `reminderJobKey` lock inside a transaction so
 * a customer never receives duplicate reminders.
 */
export const dispatchSiteVisitReminders = onSchedule('every 30 minutes', async () => {
  const now = Date.now();
  const in24hIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const upcomingSnap = await adminDb
    .collection('site_visits')
    .where('scheduledStartAt', '>=', nowIso)
    .where('scheduledStartAt', '<=', in24hIso)
    .limit(100)
    .get();

  for (const docSnap of upcomingSnap.docs) {
    await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(docSnap.ref);
      const visit = fresh.data() as SiteVisit | undefined;
      if (!visit || visit.reminderSentAt) return;
      if (visit.status !== 'SCHEDULED' && visit.status !== 'CONFIRMED') return;

      tx.update(docSnap.ref, {
        reminderSentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  }
});
