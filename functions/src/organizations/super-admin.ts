import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { Organization, Subscription } from '@bharat-makaan/shared';
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

export const superAdminGetPlatformOverview = onCall(async (request) => {
  requireSuperAdmin(request);

  const [orgsSnap, subsSnap, aiLogsSnap, ticketsSnap, auditsSnap] = await Promise.all([
    adminDb.collection('organizations').limit(100).get(),
    adminDb.collection('subscriptions').limit(100).get(),
    adminDb.collection('ai_usage_logs').limit(200).get(),
    adminDb.collection('support_requests').limit(100).get(),
    adminDb.collection('audit_events').orderBy('createdAt', 'desc').limit(100).get(),
  ]);

  const totalAiTokens = aiLogsSnap.docs.reduce(
    (acc, d) => acc + ((d.data().inputTokens ?? 0) + (d.data().outputTokens ?? 0)),
    0
  );

  return {
    organizations: orgsSnap.docs.map((d) => d.data()),
    subscriptions: subsSnap.docs.map((d) => d.data()),
    supportTickets: ticketsSnap.docs.map((d) => d.data()),
    recentAudits: auditsSnap.docs.map((d) => d.data()),
    systemHealth: {
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      totalOrganizations: orgsSnap.size,
      totalAiTokensSampled: totalAiTokens,
      openSupportTickets: ticketsSnap.docs.filter((d) => d.data().status === 'OPEN').length,
    },
  };
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
