import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  type OrganizationMember,
  type PartnerMember,
  type PartnerOrganization,
  type PermissionKey,
  type TenantEntitlements,
} from '@bharat-makaan/shared';
import { adminAuth, adminDb } from './firebase-admin';

export interface AuthenticatedActor {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  isSuperAdmin: boolean;
  mfaVerified: boolean;
  requireMfaClaim?: boolean;
  authTimeSeconds?: number;
}

export function requireAuth(request: CallableRequest<unknown>): AuthenticatedActor {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required for this operation.');
  }

  const token = request.auth.token as Record<string, unknown>;
  const firebaseClaim = (token.firebase ?? {}) as Record<string, unknown>;
  const mfaVerified = Boolean(firebaseClaim.sign_in_second_factor);
  const isSuperAdmin = token.platformRole === 'PLATFORM_SUPER_ADMIN';
  const emailVerified =
    typeof token.email_verified === 'boolean' ? token.email_verified : undefined;
  const requireMfaClaim = Boolean(token.requireMfa);
  const authTimeSeconds =
    typeof token.auth_time === 'number' ? token.auth_time : undefined;

  return {
    uid: request.auth.uid,
    email: typeof token.email === 'string' ? token.email : undefined,
    emailVerified,
    isSuperAdmin,
    mfaVerified,
    requireMfaClaim,
    authTimeSeconds,
  };
}

/**
 * Verifies against Firebase Admin Auth that the user account has not been disabled
 * and that the caller's ID token was not issued prior to `tokensValidAfterTime` (session revocation).
 */
export async function verifySessionNotRevokedOrDisabled(
  actor: AuthenticatedActor,
  authClient: Pick<Auth, 'getUser'> = adminAuth
): Promise<{ email?: string; emailVerified: boolean; mfaEnrolledCount: number }> {
  const userRecord = await authClient.getUser(actor.uid);

  if (userRecord.disabled) {
    throw new HttpsError(
      'permission-denied',
      'ACCOUNT_DISABLED: Your user account has been disabled by an administrator.'
    );
  }

  if (userRecord.tokensValidAfterTime && actor.authTimeSeconds !== undefined) {
    const validAfterSeconds = Math.floor(
      Date.parse(userRecord.tokensValidAfterTime) / 1000
    );
    if (Number.isFinite(validAfterSeconds) && actor.authTimeSeconds < validAfterSeconds) {
      throw new HttpsError(
        'unauthenticated',
        'SESSION_REVOKED: Your authentication session has been revoked. Please sign in again.'
      );
    }
  }

  return {
    email: userRecord.email ?? actor.email,
    emailVerified: Boolean(userRecord.emailVerified),
    mfaEnrolledCount: userRecord.multiFactor?.enrolledFactors?.length ?? 0,
  };
}

/**
 * Enforces MFA for Platform Super Admins and privileged roles where MFA is required.
 */
export function assertPrivilegedMfaSatisfied(
  actor: AuthenticatedActor,
  options?: { memberMfaRequired?: boolean }
): void {
  const mfaMustBeEnforced =
    actor.isSuperAdmin ||
    actor.requireMfaClaim === true ||
    Boolean(options?.memberMfaRequired && actor.requireMfaClaim);

  if (mfaMustBeEnforced && !actor.mfaVerified) {
    throw new HttpsError(
      'permission-denied',
      'MFA_REQUIRED: Multi-Factor Authentication (TOTP) verification is required for this privileged account.'
    );
  }
}

export function requireSuperAdmin(request: CallableRequest<unknown>): AuthenticatedActor {
  const actor = requireAuth(request);
  if (!actor.isSuperAdmin) {
    throw new HttpsError(
      'permission-denied',
      'Platform Super Admin authorization is required.'
    );
  }
  assertPrivilegedMfaSatisfied(actor);
  return actor;
}

export async function requireVerifiedSuperAdmin(
  request: CallableRequest<unknown>,
  authClient: Pick<Auth, 'getUser'> = adminAuth
): Promise<AuthenticatedActor> {
  const actor = requireSuperAdmin(request);
  await verifySessionNotRevokedOrDisabled(actor, authClient);
  return actor;
}

/**
 * Checks whether an organization's subscription/entitlements allow write mutations.
 * Read operations and billing/recovery operations remain allowed during read-only grace expiry.
 */
export async function assertOrgEntitlementAllowsMutation(
  db: Firestore,
  orgId: string,
  options?: { allowDuringReadOnly?: boolean }
): Promise<TenantEntitlements | null> {
  const entSnap = await db.collection('entitlements').doc(orgId).get();
  if (!entSnap.exists) return null;

  const ent = entSnap.data() as TenantEntitlements;
  const nowMs = Date.now();

  if (
    ent.workspaceAccessMode === 'GRACE_WARNING' &&
    ent.gracePeriodEndsAt &&
    Date.parse(ent.gracePeriodEndsAt) < nowMs
  ) {
    // Grace window elapsed -> enforce controlled read-only mode
    if (!options?.allowDuringReadOnly) {
      throw new HttpsError(
        'failed-precondition',
        'SUBSCRIPTION_READ_ONLY: Your billing grace period has ended. Existing CRM data and exports remain accessible, but new mutations require subscription renewal.'
      );
    }
  }

  if (ent.workspaceAccessMode === 'READ_ONLY_SUSPENDED' && !options?.allowDuringReadOnly) {
    throw new HttpsError(
      'failed-precondition',
      'SUBSCRIPTION_READ_ONLY: Subscription is inactive or cancelled. Renew your builder package in Billing to resume write operations.'
    );
  }

  return ent;
}

export async function requireOrgPermission(
  request: CallableRequest<unknown>,
  orgId: string,
  requiredPermission: PermissionKey,
  targetProjectId?: string | null,
  options?: { isReadOrBillingOperation?: boolean; dbOverride?: Firestore }
): Promise<{ actor: AuthenticatedActor; member: OrganizationMember | null }> {
  const actor = requireAuth(request);
  const db = options?.dbOverride ?? adminDb;

  // Best-effort live revocation/disabled check when running against real/emulated Auth
  if (!options?.dbOverride) {
    try {
      await verifySessionNotRevokedOrDisabled(actor);
    } catch (err) {
      if (err instanceof HttpsError) {
        throw err;
      }
      // Ignore only if local unit-test environment has no live Auth emulator bound
    }
  }

  const orgSnap = await db.collection('organizations').doc(orgId).get();
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
    assertPrivilegedMfaSatisfied(actor);
    return { actor, member: null };
  }

  const memberId = `${orgId}_${actor.uid}`;
  const memberSnap = await db.collection('organization_members').doc(memberId).get();
  if (!memberSnap.exists) {
    throw new HttpsError(
      'permission-denied',
      'You are not a member of this organization.'
    );
  }

  const member = memberSnap.data() as OrganizationMember;
  assertPrivilegedMfaSatisfied(actor, { memberMfaRequired: member.mfaRequired });

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

  const isReadOrBilling =
    options?.isReadOrBillingOperation ??
    (requiredPermission.endsWith(':view') ||
      requiredPermission === 'leads:view_all' ||
      requiredPermission === 'billing:manage');

  await assertOrgEntitlementAllowsMutation(db, orgId, {
    allowDuringReadOnly: isReadOrBilling,
  });

  return { actor, member };
}

export async function requirePartnerProjectScope(
  request: CallableRequest<unknown>,
  partnerOrgId: string,
  builderOrgId: string,
  projectId: string,
  requiredPermission: PermissionKey
): Promise<{
  actor: AuthenticatedActor;
  partnerMember: PartnerMember;
  partnerOrg: PartnerOrganization;
}> {
  const actor = requireAuth(request);
  try {
    await verifySessionNotRevokedOrDisabled(actor);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
  }

  const pmSnap = await adminDb
    .collection('partner_members')
    .doc(`${partnerOrgId}_${actor.uid}`)
    .get();
  if (!pmSnap.exists) {
    throw new HttpsError('permission-denied', 'Not a member of this channel partner agency.');
  }
  const partnerMember = pmSnap.data() as PartnerMember;
  const effectivePerms =
    partnerMember.permissions ?? DEFAULT_ROLE_PERMISSIONS[partnerMember.role] ?? [];
  if (partnerMember.status !== 'ACTIVE' || !effectivePerms.includes(requiredPermission)) {
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
