import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { AuditCategory, AuditEvent } from '@bharat-makaan/shared';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, requireSuperAdmin } from '../shared/auth-guard';

export interface WriteAuditParams {
  orgId: string;
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  category: AuditCategory;
  entityType: string;
  entityId: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function writeAuditEvent(
  db: Firestore,
  params: WriteAuditParams,
  tx?: Transaction
): Promise<AuditEvent> {
  const ref = db.collection('audit_events').doc();
  const event: AuditEvent = {
    id: ref.id,
    orgId: params.orgId,
    actorUid: params.actorUid,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    action: params.action,
    category: params.category,
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.summary,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: new Date().toISOString(),
  };

  if (tx) {
    tx.set(ref, event);
  } else {
    await ref.set(event);
  }
  return event;
}

const queryAuditSchema = z.object({
  orgId: z.string().min(1),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursorCreatedAt: z.string().optional(),
});

export const listAuditEvents = onCall(async (request) => {
  const input = queryAuditSchema.parse(request.data);
  if (input.orgId === 'PLATFORM') {
    requireSuperAdmin(request);
  } else {
    await requireOrgPermission(request, input.orgId, 'audit:view');
  }

  let query = adminDb
    .collection('audit_events')
    .where('orgId', '==', input.orgId)
    .orderBy('createdAt', 'desc')
    .limit(input.limit);

  if (input.category) {
    query = adminDb
      .collection('audit_events')
      .where('orgId', '==', input.orgId)
      .where('category', '==', input.category)
      .orderBy('createdAt', 'desc')
      .limit(input.limit);
  }

  if (input.cursorCreatedAt) {
    query = query.startAfter(input.cursorCreatedAt);
  }

  const snap = await query.get();
  return {
    items: snap.docs.map((d) => d.data() as AuditEvent),
    nextCursor: snap.docs.length === input.limit ? snap.docs[snap.docs.length - 1]?.data().createdAt : null,
  };
});
