import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  calculateBuilderSubscriptionMonthlyInr,
  type Organization,
  type Project,
  type SaasPlanCode,
  type Subscription,
  type TenantEntitlements,
} from '@bharat-makaan/shared';
import { superAdminInspectOrganizationSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import {
  assertPrivilegedMfaSatisfied,
  requireSuperAdmin,
  type AuthenticatedActor,
} from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

export async function superAdminUpdateTenantService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    status?: 'ACTIVE' | 'SUSPENDED';
    planCode?: SaasPlanCode;
    subscribedProjectCapacity?: number;
    customMaxProjects?: number;
    customMaxUsers?: number;
    aiBalanceCreditPaise?: number;
    whatsappBalanceCreditPaise?: number;
    reason: string;
  }
): Promise<{
  organization: Organization;
  subscription: Subscription | null;
  entitlements: TenantEntitlements | null;
}> {
  if (!actor.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Platform Super Admin authorization is required.');
  }
  assertPrivilegedMfaSatisfied(actor);

  const nowIso = new Date().toISOString();
  const orgRef = db.collection('organizations').doc(params.orgId);
  const subRef = db.collection('subscriptions').doc(params.orgId);
  const entRef = db.collection('entitlements').doc(params.orgId);

  const [orgSnap, subSnap, entSnap] = await Promise.all([
    orgRef.get(),
    subRef.get(),
    entRef.get(),
  ]);
  if (!orgSnap.exists) {
    throw new HttpsError('not-found', 'Organization not found.');
  }

  const prevOrg = orgSnap.data() as Organization;
  const resolvedPlanCode: SaasPlanCode =
    params.planCode ??
    (params.customMaxProjects !== undefined &&
    (params.customMaxProjects === -1 || params.customMaxProjects >= 2)
      ? 'MULTI_PROJECT'
      : prevOrg.subscriptionPlanId);

  const updatedOrg: Organization = {
    ...prevOrg,
    status: params.status ?? prevOrg.status,
    subscriptionPlanId: resolvedPlanCode,
    updatedAt: nowIso,
  };
  await orgRef.set(updatedOrg);

  const rawCap =
    params.subscribedProjectCapacity ??
    (params.customMaxProjects === -1
      ? 500
      : params.customMaxProjects ??
        (subSnap.exists ? (subSnap.data() as Subscription).subscribedProjectCapacity : 1));
  const targetCapacity =
    resolvedPlanCode === 'SINGLE_PROJECT' ? 1 : Math.max(2, rawCap);
  const calc = calculateBuilderSubscriptionMonthlyInr(resolvedPlanCode, targetCapacity, 18);

  let updatedSub: Subscription | null = null;
  if (subSnap.exists) {
    const prevSub = subSnap.data() as Subscription;
    updatedSub = {
      ...prevSub,
      planCode: resolvedPlanCode,
      subscribedProjectCapacity: targetCapacity,
      basePriceInr: calc.monthlySubtotalInr,
      monthlyTotalInr: calc.monthlyTotalInr,
      status: params.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      entitlements: {
        maxProjects: params.customMaxProjects ?? targetCapacity,
        maxUsers: params.customMaxUsers ?? prevSub.entitlements.maxUsers,
        monthlyAiCredits: prevSub.entitlements.monthlyAiCredits,
        monthlyWhatsappQuota: prevSub.entitlements.monthlyWhatsappQuota,
      },
      updatedAt: nowIso,
    };
    await subRef.set(updatedSub);
  }

  let updatedEnt: TenantEntitlements | null = null;
  const prevEnt = entSnap.exists ? (entSnap.data() as TenantEntitlements) : null;
  updatedEnt = {
    id: params.orgId,
    orgId: params.orgId,
    packageCode: resolvedPlanCode,
    workspaceAccessMode:
      params.status === 'SUSPENDED' ? 'READ_ONLY_SUSPENDED' : 'FULL_ACCESS',
    subscribedProjectCapacity:
      params.customMaxProjects === -1 ? 500 : targetCapacity,
    activeProjectsCount: prevEnt?.activeProjectsCount ?? 0,
    aiBalancePaise:
      (prevEnt?.aiBalancePaise ?? 0) + (params.aiBalanceCreditPaise ?? 0),
    aiReservedPaise: prevEnt?.aiReservedPaise ?? 0,
    whatsappBalancePaise:
      (prevEnt?.whatsappBalancePaise ?? 0) + (params.whatsappBalanceCreditPaise ?? 0),
    whatsappReservedPaise: prevEnt?.whatsappReservedPaise ?? 0,
    aiOverdraftLimitPaise: prevEnt?.aiOverdraftLimitPaise ?? 0,
    whatsappOverdraftLimitPaise: prevEnt?.whatsappOverdraftLimitPaise ?? 0,
    lowBalanceThresholdPaise: prevEnt?.lowBalanceThresholdPaise ?? 25000,
    gracePeriodEndsAt: null,
    updatedAt: nowIso,
  };
  await entRef.set(updatedEnt);

  await writeAuditEvent(db, {
    orgId: 'PLATFORM',
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: 'SUPER_ADMIN_TENANT_UPDATED',
    category: 'BILLING',
    entityType: 'organization',
    entityId: params.orgId,
    summary: `Super Admin updated tenant "${updatedOrg.name}": status=${updatedOrg.status}, package=${updatedOrg.subscriptionPlanId}, projectCapacity=${updatedEnt.subscribedProjectCapacity}. Reason: ${params.reason}`,
    before: { status: prevOrg.status, plan: prevOrg.subscriptionPlanId },
    after: {
      status: updatedOrg.status,
      plan: updatedOrg.subscriptionPlanId,
      subscribedProjectCapacity: updatedEnt.subscribedProjectCapacity,
    },
  });

  return {
    organization: updatedOrg,
    subscription: updatedSub,
    entitlements: updatedEnt,
  };
}

export async function superAdminInspectOrganizationDataService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
) {
  if (!actor.isSuperAdmin) {
    throw new HttpsError(
      'permission-denied',
      'Platform Super Admin authorization is required.'
    );
  }
  assertPrivilegedMfaSatisfied(actor);

  const input = superAdminInspectOrganizationSchema.parse(rawInput);
  const orgSnap = await db.collection('organizations').doc(input.orgId).get();
  if (!orgSnap.exists) {
    throw new HttpsError('not-found', 'Organization not found.');
  }
  const org = orgSnap.data() as Organization;

  const [projectsSnap, membersSnap, approvalsSnap, bookingsSnap, leadsSnap] = await Promise.all([
    db.collection('projects').where('orgId', '==', input.orgId).limit(50).get(),
    db.collection('organization_members').where('orgId', '==', input.orgId).limit(50).get(),
    db.collection('approvals').where('orgId', '==', input.orgId).limit(20).get(),
    db.collection('bookings').where('orgId', '==', input.orgId).limit(25).get(),
    db.collection('leads').where('orgId', '==', input.orgId).limit(25).get(),
  ]);

  await writeAuditEvent(db, {
    orgId: 'PLATFORM',
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: 'SUPER_ADMIN_SENSITIVE_DATA_ACCESS',
    category: 'PERMISSION',
    entityType: 'organization',
    entityId: input.orgId,
    summary: `Platform Super Admin inspected sensitive tenant workspace "${org.name}". Justification: ${input.reason}`,
    after: {
      reason: input.reason,
      projectsInspected: projectsSnap.size,
      bookingsSampled: bookingsSnap.size,
      leadsSampled: leadsSnap.size,
    },
  });

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: 'SUPER_ADMIN_SENSITIVE_DATA_ACCESS',
    category: 'PERMISSION',
    entityType: 'organization',
    entityId: input.orgId,
    summary: `Platform Support / Super Admin accessed diagnostic workspace summary. Justification: ${input.reason}`,
    after: { reason: input.reason },
  });

  return {
    organization: org,
    projects: projectsSnap.docs.map((d) => d.data() as Project),
    activeMembersCount: membersSnap.size,
    membersCount: membersSnap.size,
    recentApprovals: approvalsSnap.docs.map((d) => d.data()),
    operationalCounts: {
      unitsCount: projectsSnap.docs.reduce((a, d) => a + ((d.data() as Project).totalUnits ?? 0), 0),
      leadsCount: leadsSnap.size,
      bookingsCount: bookingsSnap.size,
    },
    bookingsSummaryCount: bookingsSnap.size,
    leadsSummaryCount: leadsSnap.size,
    auditJustificationRecorded: input.reason,
  };
}

export const superAdminGetPlatformOverview = onCall(async (request) => {
  requireSuperAdmin(request);

  const [
    orgsSnap,
    subsSnap,
    entsSnap,
    paymentsSnap,
    membersSnap,
    projectsSnap,
    integrationsSnap,
    aiLogsSnap,
    ticketsSnap,
    auditsSnap,
  ] = await Promise.all([
    adminDb.collection('organizations').limit(200).get(),
    adminDb.collection('subscriptions').limit(200).get(),
    adminDb.collection('entitlements').limit(200).get(),
    adminDb.collection('payments').orderBy('createdAt', 'desc').limit(100).get(),
    adminDb.collection('organization_members').limit(300).get(),
    adminDb.collection('projects').limit(500).get(),
    adminDb.collection('integrations').limit(200).get(),
    adminDb.collection('ai_usage_logs').limit(200).get(),
    adminDb.collection('support_requests').limit(100).get(),
    adminDb.collection('audit_events').orderBy('createdAt', 'desc').limit(100).get(),
  ]);

  const totalAiTokens = aiLogsSnap.docs.reduce(
    (acc, d) => acc + ((d.data().inputTokens ?? 0) + (d.data().outputTokens ?? 0)),
    0
  );

  const projectCountsByOrg: Record<string, number> = {};
  let totalInventoryUnits = 0;
  let publishedProjectsCount = 0;
  const projectsSummary = projectsSnap.docs.map((d) => {
    const p = d.data() as Project;
    if ((p.lifecycleStatus ?? 'ACTIVE') === 'ACTIVE') {
      projectCountsByOrg[p.orgId] = (projectCountsByOrg[p.orgId] ?? 0) + 1;
    }
    totalInventoryUnits += p.totalUnits ?? 0;
    if (p.isPublicPublished) publishedProjectsCount++;
    return {
      id: p.id,
      orgId: p.orgId,
      builderName: p.builderName,
      name: p.name,
      code: p.code,
      lifecycleStatus: p.lifecycleStatus ?? 'ACTIVE',
      countryCode: p.countryCode ?? 'IN',
      city: p.city,
      projectType: p.projectType,
      currencyCode: p.currencyCode ?? 'INR',
      totalUnits: p.totalUnits ?? 0,
      isPublicPublished: p.isPublicPublished,
      createdAt: p.createdAt,
    };
  });

  const orgs = orgsSnap.docs.map((d) => d.data() as Organization);
  const agenciesCount = orgs.filter((o) => o.organizationType === 'REAL_ESTATE_AGENCY').length;
  const buildersCount = orgs.length - agenciesCount;

  return {
    organizations: orgs,
    subscriptions: subsSnap.docs.map((d) => d.data()),
    entitlements: entsSnap.docs.map((d) => d.data()),
    payments: paymentsSnap.docs.map((d) => d.data()),
    members: membersSnap.docs.map((d) => d.data()),
    integrations: integrationsSnap.docs.map((d) => d.data()),
    projectsSummary,
    projectCountsByOrg,
    supportTickets: ticketsSnap.docs.map((d) => d.data()),
    recentAudits: auditsSnap.docs.map((d) => d.data()),
    systemHealth: {
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      totalOrganizations: orgsSnap.size,
      buildersCount,
      agenciesCount,
      totalRegisteredProjects: projectsSnap.size,
      publishedProjectsCount,
      totalInventoryUnits,
      verifiedIntegrationsCount: integrationsSnap.docs.filter(
        (d) => d.data().status === 'VERIFIED_ACTIVE'
      ).length,
      totalAiTokensSampled: totalAiTokens,
      openSupportTickets: ticketsSnap.docs.filter((d) => d.data().status === 'OPEN').length,
    },
  };
});

export const superAdminInspectOrganizationData = onCall(async (request) => {
  const actor = requireSuperAdmin(request);
  return superAdminInspectOrganizationDataService(adminDb, actor, request.data);
});

export const superAdminUpdateTenant = onCall(async (request) => {
  const actor = requireSuperAdmin(request);
  const schema = z.object({
    orgId: z.string().min(1),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    planCode: z.enum(['SINGLE_PROJECT', 'MULTI_PROJECT']).optional(),
    subscribedProjectCapacity: z.number().int().positive().optional(),
    customMaxProjects: z.number().int().optional(),
    customMaxUsers: z.number().int().optional(),
    aiBalanceCreditPaise: z.number().int().optional(),
    whatsappBalanceCreditPaise: z.number().int().optional(),
    reason: z.string().min(3).max(300),
  });
  const input = schema.parse(request.data);
  return superAdminUpdateTenantService(adminDb, actor, input);
});
