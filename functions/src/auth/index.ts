import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  normalizeEmail,
  type CustomerSavedProperty,
  type Lead,
  type OrganizationMember,
  type PartnerMember,
  type Project,
  type SiteVisit,
  type Unit,
} from '@bharat-makaan/shared';
import { toggleCustomerSavedPropertySchema } from '@bharat-makaan/validation';
import { adminAuth, adminDb } from '../shared/firebase-admin';
import {
  requireAuth,
  requireOrgPermission,
  verifySessionNotRevokedOrDisabled,
  type AuthenticatedActor,
} from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

export async function syncMySessionMembershipsService(
  db: Firestore,
  actor: AuthenticatedActor,
  userInfo: {
    email: string | null;
    emailVerified: boolean;
    mfaEnrolledCount: number;
  }
) {
  const emailLower = normalizeEmail(userInfo.email ?? undefined);
  const now = new Date().toISOString();
  let pendingUnverifiedInvitationsCount = 0;

  // Activate INVITED memberships ONLY when `emailVerified === true`!
  if (emailLower) {
    const pendingSnap = await db
      .collection('organization_members')
      .where('email', '==', emailLower)
      .where('status', '==', 'INVITED')
      .get();

    if (!userInfo.emailVerified) {
      pendingUnverifiedInvitationsCount = pendingSnap.size;
    } else {
      for (const docSnap of pendingSnap.docs) {
        const invited = docSnap.data() as OrganizationMember;
        const canonicalId = `${invited.orgId}_${actor.uid}`;
        await db.runTransaction(async (tx) => {
          const canonicalRef = db.collection('organization_members').doc(canonicalId);
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
            db,
            {
              orgId: invited.orgId,
              actorUid: actor.uid,
              actorEmail: emailLower,
              actorRole: invited.role,
              action: 'MEMBER_INVITATION_ACCEPTED',
              category: 'AUTH',
              entityType: 'organization_member',
              entityId: canonicalId,
              summary: `${invited.displayName} (${emailLower}) accepted staff invitation with verified email.`,
            },
            tx
          );
        });
      }
    }
  }

  const [orgMembersSnap, partnerMembersSnap] = await Promise.all([
    db.collection('organization_members').where('uid', '==', actor.uid).get(),
    db.collection('partner_members').where('uid', '==', actor.uid).get(),
  ]);

  const orgMemberships = orgMembersSnap.docs.map((d) => d.data() as OrganizationMember);
  const partnerMemberships = partnerMembersSnap.docs.map((d) => d.data() as PartnerMember);

  return {
    uid: actor.uid,
    email: userInfo.email,
    emailVerified: userInfo.emailVerified,
    isSuperAdmin: actor.isSuperAdmin,
    mfaEnrolledCount: userInfo.mfaEnrolledCount,
    pendingUnverifiedInvitationsCount,
    orgMemberships,
    partnerMemberships,
  };
}

/**
 * Returns all active/invited builder memberships and channel partner memberships
 * for the currently signed-in user, enforcing token revocation and email verification.
 */
export const syncMySessionMemberships = onCall(async (request) => {
  const actor = requireAuth(request);
  const sessionInfo = await verifySessionNotRevokedOrDisabled(actor);
  return syncMySessionMembershipsService(adminDb, actor, {
    email: sessionInfo.email ?? null,
    emailVerified: sessionInfo.emailVerified,
    mfaEnrolledCount: sessionInfo.mfaEnrolledCount,
  });
});

// ============================================================================
// Customer Personal Portal Services (Saved Properties, Enquiries & Site Visits)
// ============================================================================

export async function toggleCustomerSavedPropertyService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<{ saved: boolean; savedRecordId: string }> {
  const input = toggleCustomerSavedPropertySchema.parse(rawInput);
  const unitSnap = await db.collection('units').doc(input.unitId).get();
  if (!unitSnap.exists) {
    throw new HttpsError('not-found', 'Property listing not found.');
  }

  const unit = unitSnap.data() as Unit;
  // Customers may ONLY bookmark publicly published listings — NEVER confidential builder inventory!
  if (!unit.isPublicPublished) {
    throw new HttpsError(
      'permission-denied',
      'Only publicly published property listings can be saved.'
    );
  }

  const savedId = `${actor.uid}_${unit.id}`;
  const savedRef = db.collection('customer_saved_properties').doc(savedId);
  const existing = await savedRef.get();

  if (existing.exists) {
    await savedRef.delete();
    return { saved: false, savedRecordId: savedId };
  }

  const record: CustomerSavedProperty = {
    id: savedId,
    uid: actor.uid,
    unitId: unit.id,
    projectId: unit.projectId,
    orgId: unit.orgId,
    savedAt: new Date().toISOString(),
  };
  await savedRef.set(record);
  return { saved: true, savedRecordId: savedId };
}

export async function getCustomerPortalDataService(
  db: Firestore,
  actor: AuthenticatedActor,
  customerEmail?: string | null
) {
  const savedSnap = await db
    .collection('customer_saved_properties')
    .where('uid', '==', actor.uid)
    .get();
  const savedDocs = savedSnap.docs.map((d) => d.data() as CustomerSavedProperty);

  const unitSnaps = await Promise.all(
    savedDocs.map((s) => db.collection('units').doc(s.unitId).get())
  );
  const savedProperties = unitSnaps
    .filter((s) => s.exists && (s.data() as Unit).isPublicPublished)
    .map((s) => {
      const u = s.data() as Unit;
      return {
        id: u.id,
        projectId: u.projectId,
        unitNumber: u.unitNumber,
        unitType: u.unitType,
        bhk: u.bhk,
        saleableAreaSqft: u.saleableAreaSqft,
        facing: u.facing,
        calculatedTotalPrice: u.calculatedTotalPrice,
        monthlyRentInr: u.monthlyRentInr,
        listingMode: u.listingMode,
        status: u.status,
      };
    });

  const emailLower = normalizeEmail(customerEmail ?? actor.email);
  let myEnquiries: Array<{
    id: string;
    projectId: string | null;
    projectName?: string;
    stage: string;
    createdAt: string;
  }> = [];
  let myVisits: Array<{
    id: string;
    projectId: string;
    projectName?: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    status: string;
  }> = [];

  if (emailLower) {
    const [leadsSnap, visitsSnap] = await Promise.all([
      db.collection('leads').where('normalizedEmail', '==', emailLower).limit(50).get(),
      db.collection('site_visits').where('customerEmail', '==', emailLower).limit(50).get(),
    ]);

    const projectIds = new Set<string>();
    for (const d of leadsSnap.docs) {
      const l = d.data() as Lead;
      if (l.projectId) projectIds.add(l.projectId);
    }
    for (const d of visitsSnap.docs) {
      const v = d.data() as SiteVisit;
      if (v.projectId) projectIds.add(v.projectId);
    }

    const projSnaps = await Promise.all(
      Array.from(projectIds).map((pid) => db.collection('projects').doc(pid).get())
    );
    const projNameById = new Map<string, string>();
    for (const ps of projSnaps) {
      if (ps.exists) {
        const p = ps.data() as Project;
        projNameById.set(p.id, p.name);
      }
    }

    // Strictly sanitize: expose ONLY customer's own enquiry status & project title (never internal notes or commissions)
    myEnquiries = leadsSnap.docs.map((d) => {
      const l = d.data() as Lead;
      return {
        id: l.id,
        projectId: l.projectId ?? null,
        projectName: l.projectId ? projNameById.get(l.projectId) : undefined,
        stage: l.stage,
        createdAt: l.createdAt,
      };
    });

    myVisits = visitsSnap.docs.map((d) => {
      const v = d.data() as SiteVisit;
      return {
        id: v.id,
        projectId: v.projectId,
        projectName: projNameById.get(v.projectId),
        scheduledStartAt: v.scheduledStartAt,
        scheduledEndAt: v.scheduledEndAt,
        status: v.status,
      };
    });
  }

  return {
    savedProperties,
    myEnquiries,
    myVisits,
  };
}

export const toggleCustomerSavedProperty = onCall(async (request) => {
  const actor = requireAuth(request);
  await verifySessionNotRevokedOrDisabled(actor);
  return toggleCustomerSavedPropertyService(adminDb, actor, request.data);
});

export const getCustomerPortalData = onCall(async (request) => {
  const actor = requireAuth(request);
  const session = await verifySessionNotRevokedOrDisabled(actor);
  return getCustomerPortalDataService(adminDb, actor, session.email);
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
    entityId: memberQuery.docs[0]!.id,
    summary: `Password reset link generated for ${input.targetEmail}.`,
  });

  return { resetLink };
});
