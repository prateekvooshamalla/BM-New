import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { ApprovalRequest, PermissionKey } from '@bharat-makaan/shared';
import { decideApprovalSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

export async function createApprovalRequestService(
  db: Firestore,
  params: {
    orgId: string;
    entityType: ApprovalRequest['entityType'];
    entityId: string;
    projectId?: string | null;
    requestedByUid: string;
    requestedByName: string;
    requiredPermission: PermissionKey;
    requestSummary: string;
    payloadSnapshot: Record<string, unknown>;
  }
): Promise<ApprovalRequest> {
  const nowIso = new Date().toISOString();
  const ref = db.collection('approvals').doc();
  const approval: ApprovalRequest = {
    id: ref.id,
    orgId: params.orgId,
    entityType: params.entityType,
    entityId: params.entityId,
    projectId: params.projectId ?? null,
    requestedByUid: params.requestedByUid,
    requestedByName: params.requestedByName,
    requiredPermission: params.requiredPermission,
    status: 'PENDING',
    requestSummary: params.requestSummary,
    payloadSnapshot: params.payloadSnapshot,
    decidedByUid: null,
    decidedAt: null,
    createdAt: nowIso,
  };

  await ref.set(approval);
  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: params.requestedByUid,
    action: 'APPROVAL_REQUESTED',
    category: 'APPROVAL',
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.requestSummary,
  });

  return approval;
}

export async function decideApprovalService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<ApprovalRequest> {
  const input = decideApprovalSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const appRef = db.collection('approvals').doc(input.approvalId);
    const snap = await tx.get(appRef);
    if (!snap.exists || snap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Approval request not found.');
    }

    const current = snap.data() as ApprovalRequest;
    if (current.status !== 'PENDING') {
      throw new HttpsError('failed-precondition', `Approval is already ${current.status}.`);
    }

    const updated: ApprovalRequest = {
      ...current,
      status: input.decision,
      decidedByUid: actor.uid,
      decisionNotes: input.decisionNotes,
      decidedAt: nowIso,
    };
    tx.set(appRef, updated);

    // Apply downstream state update atomically for entity types
    if (current.entityType === 'PRICE_BOOK') {
      const pbRef = db.collection('price_books').doc(current.entityId);
      const pbSnap = await tx.get(pbRef);
      if (pbSnap.exists) {
        tx.update(pbRef, {
          status: input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
          isImmutable: input.decision === 'APPROVED',
          approvedByUid: input.decision === 'APPROVED' ? actor.uid : null,
          approvedAt: input.decision === 'APPROVED' ? nowIso : null,
          updatedAt: nowIso,
        });
      }
    } else if (current.entityType === 'QUOTATION_DISCOUNT') {
      const qtRef = db.collection('quotations').doc(current.entityId);
      const qtSnap = await tx.get(qtRef);
      if (qtSnap.exists) {
        tx.update(qtRef, {
          status: input.decision === 'APPROVED' ? 'ISSUED' : 'DRAFT',
          approvedByUid: input.decision === 'APPROVED' ? actor.uid : null,
          approvedAt: input.decision === 'APPROVED' ? nowIso : null,
          updatedAt: nowIso,
        });
      }
    } else if (current.entityType === 'BOOKING') {
      const bkRef = db.collection('bookings').doc(current.entityId);
      const bkSnap = await tx.get(bkRef);
      if (bkSnap.exists) {
        tx.update(bkRef, {
          status: input.decision === 'APPROVED' ? 'BOOKED' : 'CANCELLED',
          approvedByUid: input.decision === 'APPROVED' ? actor.uid : null,
          bookedAt: input.decision === 'APPROVED' ? nowIso : null,
          updatedAt: nowIso,
        });
      }
    }

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: `APPROVAL_${input.decision}`,
        category: 'APPROVAL',
        entityType: current.entityType,
        entityId: current.entityId,
        summary: `${input.decision} ${current.entityType} (${current.entityId}): ${input.decisionNotes}`,
      },
      tx
    );

    return updated;
  });
}

export const decideApproval = onCall(async (request) => {
  const parsed = decideApprovalSchema.parse(request.data);
  const appSnap = await adminDb.collection('approvals').doc(parsed.approvalId).get();
  if (!appSnap.exists || appSnap.data()?.orgId !== parsed.orgId) {
    throw new HttpsError('not-found', 'Approval request not found.');
  }
  const approval = appSnap.data() as ApprovalRequest;
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    approval.requiredPermission,
    approval.projectId
  );
  return decideApprovalService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});
