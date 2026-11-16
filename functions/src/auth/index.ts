import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { OrganizationMember, PartnerMember } from '@bharat-makaan/shared';
import { adminAuth, adminDb } from '../shared/firebase-admin';
import { requireAuth, requireOrgPermission } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

/**
 * Returns all active/invited builder memberships and channel partner memberships
 * for the currently signed-in user, activating any pending email invitations.
 */
export const syncMySessionMemberships = onCall(async (request) => {
  const actor = requireAuth(request);
  const userRecord = await adminAuth.getUser(actor.uid);
  const emailLower = userRecord.email?.toLowerCase();
  const now = new Date().toISOString();

  // Activate any INVITED memberships matching verified email
  if (emailLower) {
    const pendingSnap = await adminDb
      .collection('organization_members')
      .where('email', '==', emailLower)
      .where('status', '==', 'INVITED')
      .get();

    for (const docSnap of pendingSnap.docs) {
      const invited = docSnap.data() as OrganizationMember;
      const canonicalId = `${invited.orgId}_${actor.uid}`;
      await adminDb.runTransaction(async (tx) => {
        const canonicalRef = adminDb.collection('organization_members').doc(canonicalId);
        const activated: OrganizationMember = {
          ...invited,
          id: canonicalId,
          uid: actor.uid,
          status: 'ACTIVE',
          lastActiveAt: now,
          updatedAt: now,
        };
        tx.set(canonicalRef, activated);
        if (docSnap.id !== canonicalId) {
          tx.delete(docSnap.ref);
        }
        await writeAuditEvent(
          adminDb,
          {
            orgId: invited.orgId,
            actorUid: actor.uid,
            actorEmail: emailLower,
            actorRole: invited.role,
            action: 'MEMBER_INVITATION_ACCEPTED',
            category: 'AUTH',
            entityType: 'organization_member',
            entityId: canonicalId,
            summary: `${invited.displayName} (${emailLower}) accepted staff invitation.`,
          },
          tx
        );
      });
    }
  }

  const [orgMembersSnap, partnerMembersSnap] = await Promise.all([
    adminDb.collection('organization_members').where('uid', '==', actor.uid).get(),
    adminDb.collection('partner_members').where('uid', '==', actor.uid).get(),
  ]);

  const orgMemberships = orgMembersSnap.docs.map((d) => d.data() as OrganizationMember);
  const partnerMemberships = partnerMembersSnap.docs.map((d) => d.data() as PartnerMember);

  return {
    uid: actor.uid,
    email: userRecord.email ?? null,
    isSuperAdmin: actor.isSuperAdmin,
    mfaEnrolledCount: userRecord.multiFactor?.enrolledFactors?.length ?? 0,
    orgMemberships,
    partnerMemberships,
  };
});

const resetPasswordSchema = z.object({
  orgId: z.string().min(1),
  targetEmail: z.string().email(),
});

export const generateEmployeePasswordReset = onCall(async (request) => {
  const input = resetPasswordSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'staff:manage_permissions'
  );

  const memberQuery = await adminDb
    .collection('organization_members')
    .where('orgId', '==', input.orgId)
    .where('email', '==', input.targetEmail.toLowerCase())
    .limit(1)
    .get();

  if (memberQuery.empty) {
    throw new HttpsError('not-found', 'No employee with that email belongs to this organization.');
  }

  const resetLink = await adminAuth.generatePasswordResetLink(input.targetEmail.toLowerCase());

  await writeAuditEvent(adminDb, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: member?.role ?? 'PLATFORM_SUPER_ADMIN',
    action: 'EMPLOYEE_PASSWORD_RESET_GENERATED',
    category: 'AUTH',
    entityType: 'organization_member',
    entityId: memberQuery.docs[0].id,
    summary: `Password reset link generated for ${input.targetEmail}.`,
  });

  return { resetLink };
});
