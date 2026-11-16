import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DEFAULT_SAAS_PLANS } from '@bharat-makaan/config';
import {
  DEFAULT_ROLE_PERMISSIONS,
  isPrivilegedMfaRole,
  normalizeEmail,
  type Organization,
  type OrganizationMember,
  type Subscription,
} from '@bharat-makaan/shared';
import {
  createOrganizationSchema,
  inviteStaffMemberSchema,
  transferLeadsSchema,
  updateMemberAccessSchema,
} from '@bharat-makaan/validation';
import { adminAuth, adminDb } from '../shared/firebase-admin';
import {
  requireAuth,
  requireOrgPermission,
  type AuthenticatedActor,
} from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export async function createOrganizationService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown,
  creatorDisplayName?: string
): Promise<{ organization: Organization; membership: OrganizationMember; subscription: Subscription }> {
  const input = createOrganizationSchema.parse(rawInput);
  const now = new Date();
  const nowIso = now.toISOString();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const orgRef = db.collection('organizations').doc();
  const orgId = orgRef.id;
  const starterPlan = DEFAULT_SAAS_PLANS.STARTER;

  const organization: Organization = {
    id: orgId,
    name: input.name.trim(),
    slug: `${slugify(input.name)}-${orgId.slice(0, 6).toLowerCase()}`,
    legalName: input.legalName.trim(),
    gstin: input.gstin || undefined,
    pan: input.pan || undefined,
    reraNumber: input.reraNumber || undefined,
    headquartersCity: input.headquartersCity.trim(),
    address: input.address?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: normalizeEmail(input.email),
    status: 'ACTIVE',
    subscriptionPlanId: 'STARTER',
    leadProtectionDays: input.leadProtectionDays,
    whatsappAutoSendAi: false,
    createdBy: actor.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const memberId = `${orgId}_${actor.uid}`;
  const membership: OrganizationMember = {
    id: memberId,
    orgId,
    uid: actor.uid,
    email: normalizeEmail(actor.email) ?? normalizeEmail(input.email) ?? `${actor.uid}@user.local`,
    displayName: creatorDisplayName ?? input.name.trim(),
    phone: input.phone || undefined,
    role: 'BUILDER_ADMIN',
    permissions: [...DEFAULT_ROLE_PERMISSIONS.BUILDER_ADMIN],
    assignedProjectIds: [],
    department: 'Executive Leadership',
    status: 'ACTIVE',
    mfaRequired: true,
    invitedBy: actor.uid,
    invitedAt: nowIso,
    lastActiveAt: nowIso,
    updatedAt: nowIso,
  };

  const subscription: Subscription = {
    id: orgId,
    orgId,
    planCode: 'STARTER',
    billingCycle: 'MONTHLY',
    basePriceInr: starterPlan.monthlyPriceInr ?? 2999,
    onboardingFeePaid: false,
    status: 'TRIAL',
    entitlements: {
      maxProjects: starterPlan.entitlements.maxProjects,
      maxUsers: starterPlan.entitlements.maxUsers,
      monthlyAiCredits: starterPlan.entitlements.monthlyAiCredits,
      monthlyWhatsappQuota: starterPlan.entitlements.monthlyWhatsappQuota,
    },
    usageThisCycle: {
      projectsCount: 0,
      activeUsersCount: 1,
      aiCreditsUsed: 0,
      whatsappMessagesSent: 0,
    },
    addons: {
      extraUsers: 0,
      extraProjects: 0,
      extraAiCredits: 0,
      extraWhatsappQuota: 0,
    },
    currentPeriodStart: nowIso,
    currentPeriodEnd: periodEnd,
    updatedAt: nowIso,
  };

  await db.runTransaction(async (tx) => {
    tx.set(orgRef, organization);
    tx.set(db.collection('organization_members').doc(memberId), membership);
    tx.set(db.collection('subscriptions').doc(orgId), subscription);
    await writeAuditEvent(
      db,
      {
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: 'BUILDER_ADMIN',
        action: 'ORGANIZATION_CREATED',
        category: 'PERMISSION',
        entityType: 'organization',
        entityId: orgId,
        summary: `Created builder organization "${organization.name}" (${organization.headquartersCity}).`,
        after: { name: organization.name, plan: subscription.planCode },
      },
      tx
    );
  });

  return { organization, membership, subscription };
}

export async function inviteStaffMemberService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown,
  existingUidForEmail?: string | null
): Promise<OrganizationMember> {
  const input = inviteStaffMemberSchema.parse(rawInput);
  const emailLower = input.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const subRef = db.collection('subscriptions').doc(input.orgId);
    const subSnap = await tx.get(subRef);
    if (subSnap.exists) {
      const sub = subSnap.data() as Subscription;
      const maxAllowed =
        sub.entitlements.maxProjects === -1 || sub.entitlements.maxUsers === -1
          ? Infinity
          : sub.entitlements.maxUsers + sub.addons.extraUsers;
      if (sub.usageThisCycle.activeUsersCount >= maxAllowed) {
        throw new HttpsError(
          'resource-exhausted',
          `User limit reached (${maxAllowed}). Upgrade subscription or add extra user seats.`
        );
      }
    }

    const dupSnap = await tx.get(
      db
        .collection('organization_members')
        .where('orgId', '==', input.orgId)
        .where('email', '==', emailLower)
        .limit(1)
    );
    if (!dupSnap.empty) {
      throw new HttpsError(
        'already-exists',
        `Employee ${emailLower} is already registered in this organization.`
      );
    }

    const resolvedUid = existingUidForEmail ?? `pending_${emailLower.replace(/[^a-z0-9]/g, '_')}`;
    const memberId = `${input.orgId}_${resolvedUid}`;
    const member: OrganizationMember = {
      id: memberId,
      orgId: input.orgId,
      uid: resolvedUid,
      email: emailLower,
      displayName: input.displayName.trim(),
      phone: input.phone || undefined,
      role: input.role,
      permissions: input.permissions,
      assignedProjectIds: input.assignedProjectIds,
      department: input.department?.trim() || undefined,
      managerUid: input.managerUid || undefined,
      status: existingUidForEmail ? 'ACTIVE' : 'INVITED',
      mfaRequired: isPrivilegedMfaRole(input.role),
      invitedBy: actor.uid,
      invitedAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(db.collection('organization_members').doc(memberId), member);

    if (subSnap.exists) {
      const sub = subSnap.data() as Subscription;
      tx.update(subRef, {
        'usageThisCycle.activeUsersCount': sub.usageThisCycle.activeUsersCount + 1,
        updatedAt: nowIso,
      });
    }

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'STAFF_MEMBER_INVITED',
        category: 'PERMISSION',
        entityType: 'organization_member',
        entityId: memberId,
        summary: `Invited ${member.displayName} (${emailLower}) as ${member.role}.`,
        after: {
          email: emailLower,
          role: member.role,
          permissionsCount: member.permissions.length,
          assignedProjectIds: member.assignedProjectIds,
        },
      },
      tx
    );

    return member;
  });
}

export async function updateMemberAccessService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<OrganizationMember> {
  const input = updateMemberAccessSchema.parse(rawInput);
  const memberId = `${input.orgId}_${input.targetUid}`;
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const memberRef = db.collection('organization_members').doc(memberId);
    const snap = await tx.get(memberRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Organization member not found.');
    }

    const before = snap.data() as OrganizationMember;
    const updatedRole = input.role ?? before.role;
    const updated: OrganizationMember = {
      ...before,
      role: updatedRole,
      permissions: input.permissions ?? before.permissions,
      assignedProjectIds: input.assignedProjectIds ?? before.assignedProjectIds,
      department: input.department !== undefined ? input.department : before.department,
      managerUid:
        input.managerUid === null
          ? undefined
          : input.managerUid !== undefined
            ? input.managerUid
            : before.managerUid,
      status: input.status ?? before.status,
      mfaRequired: isPrivilegedMfaRole(updatedRole) || before.mfaRequired,
      updatedAt: nowIso,
    };

    tx.set(memberRef, updated);

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'MEMBER_ACCESS_UPDATED',
        category: 'PERMISSION',
        entityType: 'organization_member',
        entityId: memberId,
        summary: `Updated access for ${before.displayName} (${before.email}) -> status=${updated.status}, role=${updated.role}.`,
        before: {
          role: before.role,
          status: before.status,
          permissions: before.permissions,
          assignedProjectIds: before.assignedProjectIds,
        },
        after: {
          role: updated.role,
          status: updated.status,
          permissions: updated.permissions,
          assignedProjectIds: updated.assignedProjectIds,
        },
      },
      tx
    );

    return updated;
  });
}

export async function transferEmployeeLeadsService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<{ transferredCount: number }> {
  const input = transferLeadsSchema.parse(rawInput);
  if (input.fromAgentUid === input.toAgentUid) {
    throw new HttpsError('invalid-argument', 'Source and destination employee must be different.');
  }

  const targetMemberSnap = await db
    .collection('organization_members')
    .doc(`${input.orgId}_${input.toAgentUid}`)
    .get();
  if (!targetMemberSnap.exists || targetMemberSnap.data()?.status !== 'ACTIVE') {
    throw new HttpsError(
      'failed-precondition',
      'Target employee must be an ACTIVE member of this organization.'
    );
  }

  let query = db
    .collection('leads')
    .where('orgId', '==', input.orgId)
    .where('assignedAgentUid', '==', input.fromAgentUid);

  if (input.projectId) {
    query = query.where('preferredProjectIds', 'array-contains', input.projectId);
  }

  const leadsSnap = await query.limit(400).get();
  const nowIso = new Date().toISOString();
  const batch = db.batch();

  for (const leadDoc of leadsSnap.docs) {
    batch.update(leadDoc.ref, {
      assignedAgentUid: input.toAgentUid,
      updatedAt: nowIso,
    });
    const actRef = db.collection('lead_activities').doc();
    batch.set(actRef, {
      id: actRef.id,
      orgId: input.orgId,
      leadId: leadDoc.id,
      type: 'ASSIGNMENT',
      title: 'Lead Reassigned',
      body: `Transferred from ${input.fromAgentUid} to ${input.toAgentUid}. Reason: ${input.reason}`,
      performedByUid: actor.uid,
      createdAt: nowIso,
    });
  }

  await batch.commit();

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'LEADS_BULK_TRANSFERRED',
    category: 'PERMISSION',
    entityType: 'lead_transfer',
    entityId: `${input.fromAgentUid}_to_${input.toAgentUid}`,
    summary: `Transferred ${leadsSnap.size} leads from ${input.fromAgentUid} to ${input.toAgentUid}.`,
    after: {
      transferredCount: leadsSnap.size,
      reason: input.reason,
      projectId: input.projectId ?? null,
    },
  });

  return { transferredCount: leadsSnap.size };
}

// --- Cloud Functions v2 Callable Wrappers ---

export const createOrganization = onCall(async (request) => {
  const actor = requireAuth(request);
  const userRecord = await adminAuth.getUser(actor.uid);
  return createOrganizationService(
    adminDb,
    actor,
    request.data,
    userRecord.displayName ?? undefined
  );
});

export const inviteStaffMember = onCall(async (request) => {
  const parsed = inviteStaffMemberSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(request, parsed.orgId, 'staff:invite');

  let existingUid: string | null = null;
  try {
    const existingAuthUser = await adminAuth.getUserByEmail(parsed.email.trim().toLowerCase());
    existingUid = existingAuthUser.uid;
  } catch {
    existingUid = null;
  }

  return inviteStaffMemberService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed,
    existingUid
  );
});

export const updateMemberAccess = onCall(async (request) => {
  const parsed = updateMemberAccessSchema.parse(request.data);
  const requiredPerm = parsed.status ? 'staff:suspend' : 'staff:manage_permissions';
  const { actor, member } = await requireOrgPermission(request, parsed.orgId, requiredPerm);
  return updateMemberAccessService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );
});

export const transferEmployeeLeads = onCall(async (request) => {
  const parsed = transferLeadsSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'staff:transfer_leads'
  );
  return transferEmployeeLeadsService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );
});

export * from './super-admin';
