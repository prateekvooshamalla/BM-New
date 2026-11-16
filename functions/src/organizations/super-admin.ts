import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { Organization, Project, Subscription } from '@bharat-makaan/shared';
import { superAdminInspectOrganizationSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireSuperAdmin, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

export async function superAdminUpdateTenantService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    status?: 'ACTIVE' | 'SUSPENDED';
    planCode?: 'STARTER' | 'GROWTH' | 'BUILDER_PRO' | 'ENTERPRISE';
    customMaxProjects?: number;
    customMaxUsers?: number;
    customAiCredits?: number;
    customWhatsappQuota?: number;
    reason: string;
  }
): Promise<{ organization: Organization; subscription: Subscription | null }> {
  const nowIso = new Date().toISOString();
  const orgRef = db.collection('organizations').doc(params.orgId);
  const subRef = db.collection('subscriptions').doc(params.orgId);

  const [orgSnap, subSnap] = await Promise.all([orgRef.get(), subRef.get()]);
  if (!orgSnap.exists) {
    throw new HttpsError('not-found', 'Organization not found.');
  }

  const prevOrg = orgSnap.data() as Organization;
  const updatedOrg: Organization = {
    ...prevOrg,
    status: params.status ?? prevOrg.status,
    subscriptionPlanId: params.planCode ?? prevOrg.subscriptionPlanId,
    updatedAt: nowIso,
  };
  await orgRef.set(updatedOrg);

  let updatedSub: Subscription | null = null;
  if (subSnap.exists) {
    const prevSub = subSnap.data() as Subscription;
    updatedSub = {
      ...prevSub,
      planCode: params.planCode ?? prevSub.planCode,
      status: params.status === 'SUSPENDED' ? 'PAST_DUE' : 'ACTIVE',
      entitlements: {
        maxProjects: params.customMaxProjects ?? prevSub.entitlements.maxProjects,
        maxUsers: params.customMaxUsers ?? prevSub.entitlements.maxUsers,
        monthlyAiCredits: params.customAiCredits ?? prevSub.entitlements.monthlyAiCredits,
        monthlyWhatsappQuota:
          params.customWhatsappQuota ?? prevSub.entitlements.monthlyWhatsappQuota,
      },
      updatedAt: nowIso,
    };
    await subRef.set(updatedSub);
  }

  await writeAuditEvent(db, {
    orgId: 'PLATFORM',
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: 'SUPER_ADMIN_TENANT_UPDATED',
    category: 'BILLING',
    entityType: 'organization',
    entityId: params.orgId,
    summary: `Super Admin updated tenant "${updatedOrg.name}": status=${updatedOrg.status}, plan=${updatedOrg.subscriptionPlanId}. Reason: ${params.reason}`,
    before: { status: prevOrg.status, plan: prevOrg.subscriptionPlanId },
    after: { status: updatedOrg.status, plan: updatedOrg.subscriptionPlanId },
  });

  return { organization: updatedOrg, subscription: updatedSub };
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

  // Write immutable audit trail to BOTH Platform AND Tenant audit logs
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
    membersCount: membersSnap.size,
    recentApprovals: approvalsSnap.docs.map((d) => d.data()),
    bookingsSummaryCount: bookingsSnap.size,
    leadsSummaryCount: leadsSnap.size,
    auditJustificationRecorded: input.reason,
  };
}

export const superAdminGetPlatformOverview = onCall(async (request) => {
  requireSuperAdmin(request);

  const [orgsSnap, subsSnap, projectsSnap, integrationsSnap, aiLogsSnap, ticketsSnap, auditsSnap] =
    await Promise.all([
      adminDb.collection('organizations').limit(200).get(),
      adminDb.collection('subscriptions').limit(200).get(),
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
    projectCountsByOrg[p.orgId] = (projectCountsByOrg[p.orgId] ?? 0) + 1;
    totalInventoryUnits += p.totalUnits ?? 0;
    if (p.isPublicPublished) publishedProjectsCount++;
    return {
      id: p.id,
      orgId: p.orgId,
      builderName: p.builderName,
      name: p.name,
      code: p.code,
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
    planCode: z.enum(['STARTER', 'GROWTH', 'BUILDER_PRO', 'ENTERPRISE']).optional(),
    customMaxProjects: z.number().int().optional(),
    customMaxUsers: z.number().int().optional(),
    customAiCredits: z.number().int().nonnegative().optional(),
    customWhatsappQuota: z.number().int().nonnegative().optional(),
    reason: z.string().min(3).max(300),
  });
  const input = schema.parse(request.data);
  return superAdminUpdateTenantService(adminDb, actor, input);
});
