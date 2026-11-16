import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  hasPermission,
  type OrganizationMember,
  type PartnerMember,
  type PartnerOrganization,
  type PermissionKey,
} from '@bharat-makaan/shared';
import { adminDb } from './firebase-admin';

export interface AuthenticatedActor {
  uid: string;
  email?: string;
  isSuperAdmin: boolean;
  mfaVerified: boolean;
}

export function requireAuth(request: CallableRequest<unknown>): AuthenticatedActor {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required for this operation.');
  }

  const token = request.auth.token as Record<string, unknown>;
  const firebaseClaim = (token.firebase ?? {}) as Record<string, unknown>;
  const mfaVerified = Boolean(firebaseClaim.sign_in_second_factor);
  const isSuperAdmin = token.platformRole === 'PLATFORM_SUPER_ADMIN';

  return {
    uid: request.auth.uid,
    email: typeof token.email === 'string' ? token.email : undefined,
    isSuperAdmin,
    mfaVerified,
  };
}

export function requireSuperAdmin(request: CallableRequest<unknown>): AuthenticatedActor {
  const actor = requireAuth(request);
  if (!actor.isSuperAdmin) {
    throw new HttpsError(
      'permission-denied',
      'Platform Super Admin authorization is required.'
    );
  }
  return actor;
}

export async function requireOrgPermission(
  request: CallableRequest<unknown>,
  orgId: string,
  requiredPermission: PermissionKey,
  targetProjectId?: string | null
): Promise<{ actor: AuthenticatedActor; member: OrganizationMember | null }> {
  const actor = requireAuth(request);

  const orgSnap = await adminDb.collection('organizations').doc(orgId).get();
  if (!orgSnap.exists) {
    throw new HttpsError('not-found', 'Organization not found.');
  }
  const orgData = orgSnap.data() as { status?: string };
  if (orgData.status === 'SUSPENDED' && !actor.isSuperAdmin) {
    throw new HttpsError(
      'permission-denied',
      'This builder organization is currently suspended.'
    );
  }

  if (actor.isSuperAdmin) {
    return { actor, member: null };
  }

  const memberId = `${orgId}_${actor.uid}`;
  const memberSnap = await adminDb.collection('organization_members').doc(memberId).get();
  if (!memberSnap.exists) {
    throw new HttpsError(
      'permission-denied',
      'You are not a member of this organization.'
    );
  }

  const member = memberSnap.data() as OrganizationMember;
  if (
    !hasPermission(
      {
        status: member.status,
        role: member.role,
        permissions: member.permissions,
        assignedProjectIds: member.assignedProjectIds,
      },
      requiredPermission,
      targetProjectId
    )
  ) {
    throw new HttpsError(
      'permission-denied',
      `Missing required permission: ${requiredPermission}`
    );
  }

  return { actor, member };
}

export async function requirePartnerProjectScope(
  request: CallableRequest<unknown>,
  partnerOrgId: string,
  builderOrgId: string,
  projectId: string,
  requiredPermission: PermissionKey
): Promise<{ actor: AuthenticatedActor; partnerMember: PartnerMember; partnerOrg: PartnerOrganization }> {
  const actor = requireAuth(request);
  const pmSnap = await adminDb
    .collection('partner_members')
    .doc(`${partnerOrgId}_${actor.uid}`)
    .get();
  if (!pmSnap.exists) {
    throw new HttpsError('permission-denied', 'Not a member of this channel partner agency.');
  }
  const partnerMember = pmSnap.data() as PartnerMember;
  if (partnerMember.status !== 'ACTIVE' || !partnerMember.permissions.includes(requiredPermission)) {
    throw new HttpsError('permission-denied', `Missing partner permission: ${requiredPermission}`);
  }

  const poSnap = await adminDb.collection('partner_organizations').doc(partnerOrgId).get();
  if (!poSnap.exists) {
    throw new HttpsError('not-found', 'Channel partner organization not found.');
  }
  const partnerOrg = poSnap.data() as PartnerOrganization;
  const scope = partnerOrg.builderScopes?.[builderOrgId];
  if (
    partnerOrg.status !== 'ACTIVE' ||
    !scope ||
    scope.status !== 'AUTHORIZED' ||
    !scope.projectIds.includes(projectId)
  ) {
    throw new HttpsError(
      'permission-denied',
      'Channel partner is not authorized for the selected builder project.'
    );
  }

  return { actor, partnerMember, partnerOrg };
}
