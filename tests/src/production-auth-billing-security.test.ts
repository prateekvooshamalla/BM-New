import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  calculateBuilderSubscriptionMonthlyInr,
  DEFAULT_SAAS_PLANS,
  MOBILE_BOTTOM_TABS,
  OPTIONAL_ONBOARDING_SERVICES,
  PRIMARY_WEB_NAVIGATION,
} from '@bharat-makaan/config';
import {
  DEFAULT_ROLE_PERMISSIONS,
  evaluatePersonaRouteAccess,
  hasPermission,
  resolveDefaultPostLoginRoute,
} from '@bharat-makaan/shared';
import {
  getCustomerPortalDataService,
  syncMySessionMembershipsService,
  toggleCustomerSavedPropertyService,
} from '../../functions/src/auth';
import {
  assertOrgEntitlementAllowsMutation,
  assertPrivilegedMfaSatisfied,
  requireOrgPermission,
  requireSuperAdmin,
  verifySessionNotRevokedOrDisabled,
} from '../../functions/src/shared/auth-guard';
import {
  createOrganizationService,
  inviteStaffMemberService,
  superAdminUpdateTenantService,
  updateMemberAccessService,
} from '../../functions/src/organizations';
import {
  createProjectService,
  setProjectLifecycleStatusService,
} from '../../functions/src/projects';
import { createUnitService, transitionUnitStatusService } from '../../functions/src/inventory';
import { ingestLeadService } from '../../functions/src/leads';
import {
  authorizePartnerForBuilderScopeService,
  listPartnerAuthorizedInventoryService,
  listPartnerAuthorizedWorkspacesService,
  onboardPartnerOrganizationService,
} from '../../functions/src/channel-partners';
import {
  cancelSubscriptionService,
  changeSubscriptionCapacityService,
  chargeWhatsappMessageWalletService,
  getOrInitializeEntitlements,
  initiateSubscriptionCheckoutService,
  initiateWalletTopupService,
  previewSubscriptionPricingService,
  processRazorpayWebhookService,
  refundFailedWhatsappChargeService,
  settleAiWalletUsageService,
  superAdminAdjustWalletService,
  verifyRazorpayCheckoutSignatureService,
  type MinimalRazorpayProvider,
} from '../../functions/src/billing';
import { executeAiTaskService } from '../../functions/src/ai';
import { filterAuthorizedMobileMoreFeatures } from '../../apps/mobile/src/state/useMobileStore';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const SUPER_ADMIN = {
  uid: 'uid-super-admin-prateek',
  email: 'prateek.parts@gmail.com',
  emailVerified: true,
  isSuperAdmin: true,
  mfaVerified: true,
};

const BUILDER_A_ADMIN = {
  uid: 'uid-builder-a-founder',
  email: 'founder@buildera.in',
  emailVerified: true,
  isSuperAdmin: false,
  mfaVerified: true,
};

const BUILDER_B_ADMIN = {
  uid: 'uid-builder-b-founder',
  email: 'founder@builderb.in',
  emailVerified: true,
  isSuperAdmin: false,
  mfaVerified: true,
};

const CUSTOMER_ACTOR = {
  uid: 'uid-customer-rohit',
  email: 'rohit.buyer@gmail.com',
  emailVerified: true,
  isSuperAdmin: false,
  mfaVerified: false,
};

function signWebhookBody(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function signCheckoutHmac(params: {
  secret: string;
  paymentId: string;
  orderId?: string;
  subscriptionId?: string;
}): string {
  const msg = params.subscriptionId
    ? `${params.paymentId}|${params.subscriptionId}`
    : `${params.orderId ?? ''}|${params.paymentId}`;
  return crypto.createHmac('sha256', params.secret).update(msg).digest('hex');
}

function createMockRazorpayProvider(): MinimalRazorpayProvider {
  let seq = 1000;
  return {
    plans: {
      create: async () => ({ id: `plan_test_${++seq}` }),
    },
    subscriptions: {
      create: async () => ({
        id: `sub_test_${++seq}`,
        status: 'created',
        short_url: 'https://rzp.io/i/test_sub',
      }),
      update: async (subId, p) => ({
        id: subId,
        status: 'active',
        quantity: Number(p.quantity ?? 1),
      }),
      cancel: async (subId) => ({ id: subId, status: 'cancelled' }),
    },
    orders: {
      create: async (p) => ({
        id: `order_test_${++seq}`,
        amount: Number(p.amount ?? 0),
        currency: 'INR',
      }),
    },
  };
}

describe('Production Authentication, Four Persona Access Control, Razorpay Billing & Prepaid Wallets (22 Scenarios)', () => {
  it('Scenario 1 — Customer cannot open builder/admin functionality or save unpublished internal units', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Crestline Developers',
      legalName: 'Crestline Developers Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Crestline Developers',
      name: 'Crestline Towers',
      code: 'CLT',
      city: 'Bengaluru',
      locality: 'Whitefield',
      address: 'Whitefield, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'KA-RERA-CLT-1',
      configurations: ['3 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    const internalUnit = await createUnitService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      unitNumber: 'A-101',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1650,
      carpetAreaSqft: 1180,
      facing: 'EAST',
      baseRatePerSqft: 8500,
      isPublicPublished: false,
    });

    // Persona route guard blocks customer from Builder, Partner, and Super Admin routes
    expect(
      evaluatePersonaRouteAccess({
        uid: CUSTOMER_ACTOR.uid,
        isSuperAdmin: false,
        mfaEnrolledCount: 0,
        hasActiveBuilderMembership: false,
        hasActivePartnerMembership: false,
        targetPersona: 'BUILDER',
      }).allowed
    ).toBe(false);

    expect(
      evaluatePersonaRouteAccess({
        uid: CUSTOMER_ACTOR.uid,
        isSuperAdmin: false,
        mfaEnrolledCount: 0,
        hasActiveBuilderMembership: false,
        hasActivePartnerMembership: false,
        targetPersona: 'SUPER_ADMIN',
      }).allowed
    ).toBe(false);

    // Default post-login route sends customer to `/saved`, NEVER `/builder/dashboard`
    expect(
      resolveDefaultPostLoginRoute({
        isSuperAdmin: false,
        hasActiveBuilderMembership: false,
        hasActivePartnerMembership: false,
      })
    ).toBe('/saved');

    // Backend rejects customer attempting to save an unpublished builder unit
    await expect(
      toggleCustomerSavedPropertyService(db, CUSTOMER_ACTOR, {
        unitId: internalUnit.id,
        projectId: project.id,
        orgId: organization.id,
      })
    ).rejects.toThrow(/publicly published/i);
  });

  it('Scenario 2 — Builder A cannot access or mutate Builder B private data', async () => {
    const db = createTransactionalTestFirestore();
    const { organization: orgA } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Builder A Corp',
      legalName: 'Builder A Corp Pvt Ltd',
      headquartersCity: 'Mumbai',
    });
    const { organization: orgB } = await createOrganizationService(db, BUILDER_B_ADMIN, {
      name: 'Builder B Corp',
      legalName: 'Builder B Corp Pvt Ltd',
      headquartersCity: 'Pune',
    });

    const projB = await createProjectService(db, BUILDER_B_ADMIN, 'BUILDER_ADMIN', {
      orgId: orgB.id,
      builderName: 'Builder B Corp',
      name: 'Confidential B Project',
      code: 'CBP',
      city: 'Pune',
      locality: 'Koregaon Park',
      address: 'KP, Pune',
      projectType: 'APARTMENT',
      reraNumber: 'MH-RERA-B1',
      configurations: ['4 BHK'],
      constructionStatus: 'PRE_LAUNCH',
    });

    // Builder A attempting to pass `orgId: orgB.id` in backend authorization guard is rejected
    await expect(
      requireOrgPermission(
        {
          auth: {
            uid: BUILDER_A_ADMIN.uid,
            token: { email: BUILDER_A_ADMIN.email, firebase: { sign_in_second_factor: 'totp' } },
          },
          data: {},
        } as any,
        orgB.id,
        'projects:view',
        projB.id,
        { dbOverride: db } as any
      )
    ).rejects.toThrow();

    // Cross-org mismatch on project lifecycle update is rejected
    await expect(
      setProjectLifecycleStatusService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
        orgId: orgA.id,
        projectId: projB.id,
        lifecycleStatus: 'ARCHIVED_READ_ONLY',
        reason: 'Attempt cross-org archive',
      })
    ).rejects.toThrow(/Project not found in organization/);
  });

  it('Scenario 3 & 4 — Unapproved (PENDING) channel partner cannot access builder projects; approved (AUTHORIZED) partner only accesses authorized projects', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Sovereign Realty',
      legalName: 'Sovereign Realty LLP',
      headquartersCity: 'Hyderabad',
    });
    await superAdminUpdateTenantService(db, SUPER_ADMIN, {
      orgId: organization.id,
      planCode: 'MULTI_PROJECT',
      subscribedProjectCapacity: 2,
      reason: 'Enable 2 projects for partner scoping test',
    });

    const projAuthorized = await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Sovereign Realty',
      name: 'Sovereign Heights',
      code: 'SVH',
      city: 'Hyderabad',
      locality: 'Gachibowli',
      address: 'Gachibowli, Hyderabad',
      projectType: 'APARTMENT',
      reraNumber: 'TS-RERA-SVH',
      configurations: ['3 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    const projSecret = await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Sovereign Realty',
      name: 'Sovereign Private Villas',
      code: 'SPV',
      city: 'Hyderabad',
      locality: 'Jubilee Hills',
      address: 'Jubilee Hills, Hyderabad',
      projectType: 'VILLA',
      reraNumber: 'TS-RERA-SPV',
      configurations: ['5 BHK'],
      constructionStatus: 'PRE_LAUNCH',
    });

    await createUnitService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: projAuthorized.id,
      unitNumber: 'SVH-101',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1850,
      carpetAreaSqft: 1300,
      facing: 'NORTH',
      baseRatePerSqft: 9200,
    });

    const partnerUid = 'uid-partner-pending-1';
    const pendingPartner = await onboardPartnerOrganizationService(db, BUILDER_A_ADMIN, {
      orgId: organization.id,
      companyName: 'Pending Realty Agency',
      contactName: 'Kiran Rao',
      email: 'kiran@pendingagency.in',
      phone: '+919849012345',
      officeCity: 'Hyderabad',
      projectIds: [projAuthorized.id],
      commissionPct: 2.0,
      commissionTerms: 'On Agreement',
      partnerAdminUid: partnerUid,
      initialScopeStatus: 'PENDING',
    });

    // Scenario 3: Unapproved (PENDING) partner sees 0 workspaces and is denied inventory!
    expect(pendingPartner.authorizedOrgIds).toEqual([]);
    const beforeApproval = await listPartnerAuthorizedWorkspacesService(db, partnerUid);
    expect(beforeApproval.workspaces).toHaveLength(0);

    await expect(
      listPartnerAuthorizedInventoryService(db, {
        partnerOrgId: pendingPartner.id,
        orgId: organization.id,
        projectId: projAuthorized.id,
      })
    ).rejects.toThrow(/not authorized/i);

    // Builder Admin explicitly approves partner ONLY for `projAuthorized`
    await authorizePartnerForBuilderScopeService(db, BUILDER_A_ADMIN, {
      orgId: organization.id,
      partnerOrgId: pendingPartner.id,
      projectIds: [projAuthorized.id],
      commissionPct: 2.5,
      commissionTerms: 'On Agreement',
      status: 'AUTHORIZED',
    });

    // Scenario 4: Approved partner accesses `projAuthorized` (1 unit), still blocked from `projSecret`!
    const afterApproval = await listPartnerAuthorizedInventoryService(db, {
      partnerOrgId: pendingPartner.id,
      orgId: organization.id,
      projectId: projAuthorized.id,
    });
    expect(afterApproval.units).toHaveLength(1);

    await expect(
      listPartnerAuthorizedInventoryService(db, {
        partnerOrgId: pendingPartner.id,
        orgId: organization.id,
        projectId: projSecret.id,
      })
    ).rejects.toThrow(/not authorized/i);
  });

  it('Scenario 5 — Builder employee permissions, project scopes, self-role modification block & sole-admin protection', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Vanguard Homes',
      legalName: 'Vanguard Homes Pvt Ltd',
      headquartersCity: 'Chennai',
    });

    const exec = await inviteStaffMemberService(
      db,
      BUILDER_A_ADMIN,
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        email: 'exec@vanguard.in',
        displayName: 'Ananya Exec',
        role: 'SALES_EXECUTIVE',
        permissions: DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE,
        assignedProjectIds: ['proj-1'],
      },
      'uid-ananya-exec'
    );

    expect(hasPermission(exec, 'leads:view', 'proj-1')).toBe(true);
    expect(hasPermission(exec, 'leads:view', 'proj-2')).toBe(false);
    expect(hasPermission(exec, 'billing:manage', 'proj-1')).toBe(false);

    // Self-role/permission modification is strictly forbidden!
    await expect(
      updateMemberAccessService(
        db,
        { uid: exec.uid, email: exec.email, isSuperAdmin: false, mfaVerified: false },
        'BUILDER_ADMIN',
        {
          orgId: organization.id,
          targetUid: exec.uid,
          role: 'BUILDER_ADMIN',
        }
      )
    ).rejects.toThrow(/SELF_MODIFICATION_FORBIDDEN/);

    // Sole BUILDER_ADMIN cannot be suspended or demoted (prevents tenant lockout)!
    await expect(
      updateMemberAccessService(db, SUPER_ADMIN, 'PLATFORM_SUPER_ADMIN', {
        orgId: organization.id,
        targetUid: BUILDER_A_ADMIN.uid,
        status: 'SUSPENDED',
      })
    ).rejects.toThrow(/SOLE_ADMIN_PROTECTED|SELF_MODIFICATION_FORBIDDEN/);
  });

  it('Scenario 6, 7 & 8 — Super-admin rejects ordinary users, MFA enforced for privileged accounts, session revocation/disabled account & unverified email invitation guard', async () => {
    // Scenario 6: Ordinary user rejected by `requireSuperAdmin`
    expect(() =>
      requireSuperAdmin({
        auth: {
          uid: BUILDER_A_ADMIN.uid,
          token: { email: BUILDER_A_ADMIN.email, firebase: { sign_in_second_factor: 'totp' } },
        },
        data: {},
      } as any)
    ).toThrow(/Platform Super Admin/);

    // Scenario 7: Super Admin or privileged `requireMfaClaim` without MFA second factor is rejected!
    expect(() =>
      assertPrivilegedMfaSatisfied({
        uid: SUPER_ADMIN.uid,
        email: SUPER_ADMIN.email,
        isSuperAdmin: true,
        mfaVerified: false,
      })
    ).toThrow(/MFA_REQUIRED/);

    expect(() =>
      assertPrivilegedMfaSatisfied({
        uid: 'uid-fin-mgr',
        email: 'fin@builder.in',
        isSuperAdmin: false,
        requireMfaClaim: true,
        mfaVerified: false,
      })
    ).toThrow(/MFA_REQUIRED/);

    // Scenario 8a: Disabled account & revoked session (`tokensValidAfterTime > authTimeSeconds`) rejected!
    await expect(
      verifySessionNotRevokedOrDisabled(
        { uid: 'uid-disabled', isSuperAdmin: false, mfaVerified: false },
        {
          getUser: async () =>
            ({
              uid: 'uid-disabled',
              disabled: true,
              emailVerified: true,
            }) as any,
        }
      )
    ).rejects.toThrow(/ACCOUNT_DISABLED/);

    await expect(
      verifySessionNotRevokedOrDisabled(
        {
          uid: 'uid-revoked',
          isSuperAdmin: false,
          mfaVerified: false,
          authTimeSeconds: 1700000000,
        },
        {
          getUser: async () =>
            ({
              uid: 'uid-revoked',
              disabled: false,
              emailVerified: true,
              tokensValidAfterTime: new Date(1700000500 * 1000).toUTCString(),
            }) as any,
        }
      )
    ).rejects.toThrow(/SESSION_REVOKED/);

    // Scenario 8b: Unverified email CANNOT claim `INVITED` organization membership until `emailVerified === true`!
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Secure Invite Org',
      legalName: 'Secure Invite Org Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    await inviteStaffMemberService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      email: 'newstaff@secure.in',
      displayName: 'New Staff',
      role: 'SALES_MANAGER',
      permissions: DEFAULT_ROLE_PERMISSIONS.SALES_MANAGER,
      assignedProjectIds: [],
    });

    const unverifiedSync = await syncMySessionMembershipsService(
      db,
      { uid: 'uid-new-staff', email: 'newstaff@secure.in', isSuperAdmin: false, mfaVerified: false },
      { email: 'newstaff@secure.in', emailVerified: false, mfaEnrolledCount: 0 }
    );
    expect(unverifiedSync.orgMemberships).toHaveLength(0);
    expect(unverifiedSync.pendingUnverifiedInvitationsCount).toBe(1);

    const verifiedSync = await syncMySessionMembershipsService(
      db,
      { uid: 'uid-new-staff', email: 'newstaff@secure.in', isSuperAdmin: false, mfaVerified: false },
      { email: 'newstaff@secure.in', emailVerified: true, mfaEnrolledCount: 0 }
    );
    expect(verifiedSync.orgMemberships).toHaveLength(1);
    expect(verifiedSync.orgMemberships[0]?.status).toBe('ACTIVE');
  });

  it('Scenario 9, 10 & 11 — Single Project (INR 5,999/mo) allows 1 project, rejects 2nd project; Multi-Project charges min 2 slots (INR 9,998/mo) + optional assisted onboarding', async () => {
    // Strictly two paid builder packages
    expect(Object.keys(DEFAULT_SAAS_PLANS)).toEqual(['SINGLE_PROJECT', 'MULTI_PROJECT']);

    // Formula checks
    expect(
      calculateBuilderSubscriptionMonthlyInr('SINGLE_PROJECT', 1, 18).monthlySubtotalInr
    ).toBe(5999);
    expect(
      calculateBuilderSubscriptionMonthlyInr('MULTI_PROJECT', 1, 18).monthlySubtotalInr
    ).toBe(9998);
    expect(
      calculateBuilderSubscriptionMonthlyInr('MULTI_PROJECT', 2, 18).monthlySubtotalInr
    ).toBe(9998);
    expect(
      calculateBuilderSubscriptionMonthlyInr('MULTI_PROJECT', 3, 18).monthlySubtotalInr
    ).toBe(14997);
    expect(
      calculateBuilderSubscriptionMonthlyInr('MULTI_PROJECT', 5, 18).monthlySubtotalInr
    ).toBe(24995);
    expect(
      calculateBuilderSubscriptionMonthlyInr('MULTI_PROJECT', 10, 18).monthlySubtotalInr
    ).toBe(49990);

    // Optional onboarding never auto-charges when SELF_SERVICE
    expect(OPTIONAL_ONBOARDING_SERVICES.SELF_SERVICE.oneTimeFeeInr).toBe(0);
    expect(OPTIONAL_ONBOARDING_SERVICES.ASSISTED_SINGLE_PROJECT.oneTimeFeeInr).toBe(9999);
    expect(OPTIONAL_ONBOARDING_SERVICES.ASSISTED_TWO_PROJECTS.oneTimeFeeInr).toBe(19999);

    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Single Slot Builder',
      legalName: 'Single Slot Builder LLP',
      headquartersCity: 'Bengaluru',
    });

    const previewSelf = await previewSubscriptionPricingService(db, {
      orgId: organization.id,
      packageCode: 'MULTI_PROJECT',
      requestedProjectCapacity: 2,
      onboardingServiceCode: 'SELF_SERVICE',
    });
    expect(previewSelf.recurring.monthlySubtotalInr).toBe(9998);
    expect(previewSelf.onboarding.oneTimeSubtotalInr).toBe(0);

    // Scenario 9: 1st active project succeeds on SINGLE_PROJECT
    await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Single Slot Builder',
      name: 'First Tower',
      code: 'FT1',
      city: 'Bengaluru',
      locality: 'Hebbal',
      address: 'Hebbal, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'RERA-FT1',
      configurations: ['2 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    // Scenario 10: 2nd active project is strictly rejected on SINGLE_PROJECT
    await expect(
      createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
        orgId: organization.id,
        builderName: 'Single Slot Builder',
        name: 'Second Tower Blocked',
        code: 'FT2',
        city: 'Bengaluru',
        locality: 'Yelahanka',
        address: 'Yelahanka, Bengaluru',
        projectType: 'APARTMENT',
        reraNumber: 'RERA-FT2',
        configurations: ['3 BHK'],
        constructionStatus: 'NEW_LAUNCH',
      })
    ).rejects.toThrow(/Project limit reached/);
  });

  it('Scenario 12, 13 & 14 — Multi-Project slot increases require verified Razorpay payment; payment failure grants zero slots; duplicate webhooks are idempotent', async () => {
    const db = createTransactionalTestFirestore();
    const webhookSecret = 'whsec_prod_test_998877';
    const keySecret = 'rzp_secret_prod_test_112233';
    const mockRzp = createMockRazorpayProvider();

    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Razorpay Verified Builder',
      legalName: 'Razorpay Verified Builder Pvt Ltd',
      headquartersCity: 'Mumbai',
    });

    // Initiate Multi-Project (3 slots = ₹14,997 + GST) checkout
    const checkout = await initiateSubscriptionCheckoutService(
      db,
      BUILDER_A_ADMIN,
      {
        orgId: organization.id,
        packageCode: 'MULTI_PROJECT',
        requestedProjectCapacity: 3,
        onboardingServiceCode: 'ASSISTED_SINGLE_PROJECT',
        clientPlatform: 'WEB',
        idempotencyKey: 'idem_sub_multi_3slots',
      },
      mockRzp
    );
    expect(checkout.pricingSummary.recurring.monthlySubtotalInr).toBe(14997);
    expect(checkout.onboardingOrder.subtotalInr).toBe(9999);

    // Scenario 12: Before payment verification, capacity MUST remain 1 (pending checkout never unlocks slots!)
    const entBefore = await getOrInitializeEntitlements(db, organization.id);
    expect(entBefore.subscribedProjectCapacity).toBe(1);

    // Scenario 13: Webhook `payment.failed` does NOT grant Multi-Project slots!
    const failedBody = JSON.stringify({
      event: 'payment.failed',
      created_at: 1710000100,
      payload: {
        payment: {
          entity: {
            id: 'pay_failed_001',
            amount: checkout.pricingSummary.recurring.monthlyTotalInr * 100,
            error_description: 'Insufficient funds on card',
            notes: {
              orgId: organization.id,
              checkoutKind: 'SUBSCRIPTION',
            },
          },
        },
      },
    });
    await processRazorpayWebhookService({
      db,
      rawBody: failedBody,
      signatureHeader: signWebhookBody(failedBody, webhookSecret),
      eventIdHeader: 'evt_rzp_failed_001',
      webhookSecret,
    });

    const entAfterFail = await getOrInitializeEntitlements(db, organization.id);
    expect(entAfterFail.subscribedProjectCapacity).toBe(1);

    // Forged signature on client checkout verification is rejected!
    await expect(
      verifyRazorpayCheckoutSignatureService(
        db,
        BUILDER_A_ADMIN,
        {
          orgId: organization.id,
          checkoutKind: 'SUBSCRIPTION',
          referenceId: checkout.invoice.id,
          razorpayPaymentId: 'pay_live_ok_99',
          razorpaySubscriptionId: checkout.razorpaySubscriptionId!,
          razorpaySignature: 'deadbeef0000',
        },
        keySecret
      )
    ).rejects.toThrow(/INVALID_RAZORPAY_SIGNATURE/);

    // Valid HMAC webhook `subscription.activated` unlocks 3 active project slots!
    const activatedBody = JSON.stringify({
      event: 'subscription.activated',
      created_at: 1710000200,
      payload: {
        subscription: {
          entity: {
            id: checkout.razorpaySubscriptionId,
            quantity: 3,
            notes: {
              orgId: organization.id,
              packageCode: 'MULTI_PROJECT',
              subscribedProjectCapacity: '3',
            },
          },
        },
        payment: {
          entity: {
            id: 'pay_captured_sub_001',
          },
        },
      },
    });

    const firstDelivery = await processRazorpayWebhookService({
      db,
      rawBody: activatedBody,
      signatureHeader: signWebhookBody(activatedBody, webhookSecret),
      eventIdHeader: 'evt_rzp_sub_activated_001',
      webhookSecret,
    });
    expect(firstDelivery.deduplicated).toBe(false);

    const entUnlocked = await getOrInitializeEntitlements(db, organization.id);
    expect(entUnlocked.packageCode).toBe('MULTI_PROJECT');
    expect(entUnlocked.subscribedProjectCapacity).toBe(3);

    // Scenario 14: Duplicate Razorpay webhook redelivery is idempotently ignored!
    const duplicateDelivery = await processRazorpayWebhookService({
      db,
      rawBody: activatedBody,
      signatureHeader: signWebhookBody(activatedBody, webhookSecret),
      eventIdHeader: 'evt_rzp_sub_activated_001',
      webhookSecret,
    });
    expect(duplicateDelivery.deduplicated).toBe(true);
  });

  it('Scenario 15, 16, 17 & 18 — Failed top-ups add zero credits; AI requestId & WhatsApp waMessageId are idempotent; failed WA delivery auto-refunds; zero wallet blocks ONLY chargeable AI/WA while CRM continues', async () => {
    const db = createTransactionalTestFirestore();
    const webhookSecret = 'whsec_wallet_test_777';
    const keySecret = 'rzp_key_secret_wallet_777';
    const mockRzp = createMockRazorpayProvider();

    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Prepaid Ledger Realty',
      legalName: 'Prepaid Ledger Realty Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Prepaid Ledger Realty',
      name: 'Ledger Heights',
      code: 'LDH',
      city: 'Bengaluru',
      locality: 'Sarjapur',
      address: 'Sarjapur Road, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'KA-RERA-LDH',
      configurations: ['3 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    // Scenario 18 (Part A): With 0 Paise in AI & WhatsApp wallets, chargeable AI & WhatsApp actions are blocked...
    const mockOpenAi = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'Lead summary' } }],
            usage: { prompt_tokens: 200, completion_tokens: 50 },
          }),
        },
      },
    } as any;

    await expect(
      executeAiTaskService(
        db,
        BUILDER_A_ADMIN,
        {
          orgId: organization.id,
          feature: 'LEAD_QUALIFICATION',
          requestId: 'req_zero_wallet_block',
          context: { budget: '2Cr' },
        },
        mockOpenAi
      )
    ).rejects.toThrow(/INSUFFICIENT_AI_CREDITS/);

    await expect(
      chargeWhatsappMessageWalletService(db, {
        orgId: organization.id,
        wabaOrPhoneNumberId: 'waba_phone_1',
        waMessageId: 'wamid.blocked_zero',
        recipientMarket: 'IN',
        messageCategory: 'MARKETING',
        deliveryEvidence: 'OUTBOUND_API_ACCEPTED',
      })
    ).rejects.toThrow(/INSUFFICIENT_WHATSAPP_CREDITS/);

    // ...while non-AI / non-WhatsApp CRM operations (lead ingestion, unit creation, holds) continue working uninterrupted!
    const crmLead = await ingestLeadService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      customerName: 'Uninterrupted Buyer',
      phone: '+919886011122',
      source: 'MANUAL',
      preferredProjectIds: [project.id],
    });
    expect(crmLead.lead.id).toBeTruthy();

    // Scenario 15: Failed wallet top-up does NOT increase AI wallet balance!
    const aiTopup = await initiateWalletTopupService(
      db,
      BUILDER_A_ADMIN,
      {
        orgId: organization.id,
        walletType: 'AI',
        amountInr: 500,
        clientPlatform: 'WEB',
        idempotencyKey: 'idem_ai_topup_500',
      },
      mockRzp
    );

    const failedTopupBody = JSON.stringify({
      event: 'payment.failed',
      created_at: 1710000900,
      payload: {
        payment: {
          entity: {
            id: 'pay_topup_fail_1',
            amount: aiTopup.topupOrder.totalPayablePaise,
            notes: {
              orgId: organization.id,
              checkoutKind: 'WALLET_TOPUP',
              topupOrderId: aiTopup.topupOrder.id,
              walletType: 'AI',
            },
          },
        },
      },
    });
    await processRazorpayWebhookService({
      db,
      rawBody: failedTopupBody,
      signatureHeader: signWebhookBody(failedTopupBody, webhookSecret),
      eventIdHeader: 'evt_topup_fail_1',
      webhookSecret,
    });
    expect((await getOrInitializeEntitlements(db, organization.id)).aiBalancePaise).toBe(0);

    // Now verify genuine Razorpay payment for AI Top-Up (₹500 = 50,000 Paise) & WA Top-Up (₹500 = 50,000 Paise)
    const validSig = signCheckoutHmac({
      secret: keySecret,
      paymentId: 'pay_topup_ok_ai',
      orderId: aiTopup.topupOrder.razorpayOrderId!,
    });
    await verifyRazorpayCheckoutSignatureService(
      db,
      BUILDER_A_ADMIN,
      {
        orgId: organization.id,
        checkoutKind: 'WALLET_TOPUP',
        referenceId: aiTopup.topupOrder.id,
        razorpayPaymentId: 'pay_topup_ok_ai',
        razorpayOrderId: aiTopup.topupOrder.razorpayOrderId!,
        razorpaySignature: validSig,
      },
      keySecret
    );
    expect((await getOrInitializeEntitlements(db, organization.id)).aiBalancePaise).toBe(50000);

    await superAdminAdjustWalletService(db, SUPER_ADMIN, {
      orgId: organization.id,
      walletType: 'WHATSAPP',
      creditDeltaPaise: 50000,
      requestId: 'req_seed_wa_500',
      reason: 'Seed WhatsApp wallet for idempotency & refund verification',
    });

    // Scenario 16: Duplicate AI settlements with the same `requestId` MUST NOT charge twice!
    const aiSettle1 = await settleAiWalletUsageService(db, {
      orgId: organization.id,
      requestId: 'req_ai_idem_001',
      actorUid: BUILDER_A_ADMIN.uid,
      feature: 'LEAD_QUALIFICATION',
      model: 'gpt-4.1',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(aiSettle1.deduplicated).toBe(false);
    const balAfterFirstAi = (await getOrInitializeEntitlements(db, organization.id)).aiBalancePaise;

    const aiSettle2 = await settleAiWalletUsageService(db, {
      orgId: organization.id,
      requestId: 'req_ai_idem_001',
      actorUid: BUILDER_A_ADMIN.uid,
      feature: 'LEAD_QUALIFICATION',
      model: 'gpt-4.1',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(aiSettle2.deduplicated).toBe(true);
    expect((await getOrInitializeEntitlements(db, organization.id)).aiBalancePaise).toBe(
      balAfterFirstAi
    );

    // Scenario 17: WhatsApp billing is idempotent by `waMessageId`, and failed delivery auto-refunds!
    const waCharge1 = await chargeWhatsappMessageWalletService(db, {
      orgId: organization.id,
      wabaOrPhoneNumberId: 'waba_phone_1',
      waMessageId: 'wamid.idem_msg_77',
      recipientMarket: 'IN',
      messageCategory: 'MARKETING', // 88 Paise in IN
      deliveryEvidence: 'OUTBOUND_TEMPLATE_SENT',
    });
    expect(waCharge1.deduplicated).toBe(false);
    expect(waCharge1.chargePaise).toBe(88);
    expect((await getOrInitializeEntitlements(db, organization.id)).whatsappBalancePaise).toBe(
      50000 - 88
    );

    // Redelivered Meta webhook for same `wamid.idem_msg_77` does NOT charge again!
    const waChargeDup = await chargeWhatsappMessageWalletService(db, {
      orgId: organization.id,
      wabaOrPhoneNumberId: 'waba_phone_1',
      waMessageId: 'wamid.idem_msg_77',
      recipientMarket: 'IN',
      messageCategory: 'MARKETING',
      deliveryEvidence: 'META_WEBHOOK_SENT_PRICING',
    });
    expect(waChargeDup.deduplicated).toBe(true);
    expect((await getOrInitializeEntitlements(db, organization.id)).whatsappBalancePaise).toBe(
      50000 - 88
    );

    // Failed delivery webhook refunds the exact 88 Paise back to the wallet (idempotently)!
    const refund1 = await refundFailedWhatsappChargeService(db, {
      orgId: organization.id,
      waMessageId: 'wamid.idem_msg_77',
      reason: 'Meta delivery failed (131026)',
    });
    expect(refund1.refunded).toBe(true);
    expect((await getOrInitializeEntitlements(db, organization.id)).whatsappBalancePaise).toBe(
      50000
    );
  });

  it('Scenario 19 — Safe subscription downgrade archives excess projects without deleting data; cancellation enters read-only preservation mode', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Lifecycle Preservation Group',
      legalName: 'Lifecycle Preservation Group Pvt Ltd',
      headquartersCity: 'Hyderabad',
    });

    await superAdminUpdateTenantService(db, SUPER_ADMIN, {
      orgId: organization.id,
      planCode: 'MULTI_PROJECT',
      subscribedProjectCapacity: 3,
      reason: 'Provision 3 active project slots',
    });

    const p1 = await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Lifecycle Group',
      name: 'Project One Retained',
      code: 'P1R',
      city: 'Hyderabad',
      locality: 'Kondapur',
      address: 'Kondapur, Hyderabad',
      projectType: 'APARTMENT',
      reraNumber: 'RERA-P1',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const p2 = await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Lifecycle Group',
      name: 'Project Two Archived',
      code: 'P2A',
      city: 'Hyderabad',
      locality: 'Kokapet',
      address: 'Kokapet, Hyderabad',
      projectType: 'APARTMENT',
      reraNumber: 'RERA-P2',
      configurations: ['4 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    const unitInP2 = await createUnitService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: p2.id,
      unitNumber: 'P2-401',
      unitType: 'APARTMENT',
      bhk: '4 BHK',
      saleableAreaSqft: 2800,
      carpetAreaSqft: 1980,
      facing: 'EAST',
      baseRatePerSqft: 10500,
    });

    // Attempting to downgrade from 2 active projects to SINGLE_PROJECT (1 slot) WITHOUT selecting retained project is rejected!
    await expect(
      changeSubscriptionCapacityService(db, BUILDER_A_ADMIN, {
        orgId: organization.id,
        targetPackageCode: 'SINGLE_PROJECT',
        targetProjectCapacity: 1,
        clientPlatform: 'WEB',
        idempotencyKey: 'idem_downgrade_missing_selection',
      })
    ).rejects.toThrow(/DOWNGRADE_PROJECT_SELECTION_REQUIRED/);

    // Selecting `p1.id` safely archives `p2.id` to `ARCHIVED_READ_ONLY` WITHOUT deleting `unitInP2`!
    const downgraded = await changeSubscriptionCapacityService(db, BUILDER_A_ADMIN, {
      orgId: organization.id,
      targetPackageCode: 'SINGLE_PROJECT',
      targetProjectCapacity: 1,
      retainedActiveProjectIds: [p1.id],
      clientPlatform: 'WEB',
      idempotencyKey: 'idem_downgrade_keep_p1',
    });
    expect(downgraded).toMatchObject({
      downgraded: true,
      packageCode: 'SINGLE_PROJECT',
      subscribedProjectCapacity: 1,
      archivedProjectIds: [p2.id],
    });

    const p2Snap = await db.collection('projects').doc(p2.id).get();
    expect(p2Snap.data()?.lifecycleStatus).toBe('ARCHIVED_READ_ONLY');
    const preservedUnitSnap = await db.collection('units').doc(unitInP2.id).get();
    expect(preservedUnitSnap.exists).toBe(true);

    // Reactivating `p2` while still on 1-slot SINGLE_PROJECT is blocked!
    await expect(
      setProjectLifecycleStatusService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
        orgId: organization.id,
        projectId: p2.id,
        lifecycleStatus: 'ACTIVE',
        reason: 'Attempt reactivation without slot',
      })
    ).rejects.toThrow(/Project limit reached/);

    // Immediate cancellation puts workspace into `READ_ONLY_SUSPENDED` (blocks mutations, allows reads & billing recovery, preserves all units)
    const cancelled = await cancelSubscriptionService(db, BUILDER_A_ADMIN, {
      orgId: organization.id,
      cancelImmediately: true,
      reason: 'End of test cycle',
    });
    expect(cancelled.workspaceAccessMode).toBe('READ_ONLY_SUSPENDED');
    expect(cancelled.dataPreserved).toBe(true);

    await expect(
      assertOrgEntitlementAllowsMutation(db, organization.id, { allowDuringReadOnly: false })
    ).rejects.toThrow(/SUBSCRIPTION_READ_ONLY/);
    // Read / Billing recovery operations remain permitted!
    await expect(
      assertOrgEntitlementAllowsMutation(db, organization.id, { allowDuringReadOnly: true })
    ).resolves.toBeTruthy();
  });

  it('Scenario 20, 21 & 22 — Web & Mobile share identical backend entitlements/RBAC; public portal exposes only published inventory; zero dummy data', async () => {
    const db = createTransactionalTestFirestore();

    // Scenario 20: Web navigation (12 items under `/builder/*`) and Mobile tabs/More features share identical permission matrix
    expect(PRIMARY_WEB_NAVIGATION).toHaveLength(12);
    expect(PRIMARY_WEB_NAVIGATION.every((item) => item.path.startsWith('/builder/'))).toBe(true);
    expect(MOBILE_BOTTOM_TABS).toHaveLength(5);

    const { organization } = await createOrganizationService(db, BUILDER_A_ADMIN, {
      name: 'Unified Cloud Developers',
      legalName: 'Unified Cloud Developers Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });
    const salesMember = await inviteStaffMemberService(
      db,
      BUILDER_A_ADMIN,
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        email: 'mobile.sales@unified.in',
        displayName: 'Mobile Sales Exec',
        role: 'SALES_EXECUTIVE',
        permissions: DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE,
        assignedProjectIds: [],
      },
      'uid-mobile-sales'
    );
    const mobileFeatures = filterAuthorizedMobileMoreFeatures(salesMember, false);
    expect(mobileFeatures.some((f) => f.key === 'PricingQuotations')).toBe(true);

    // Scenario 21 & 22: Public & Customer portals expose ONLY `isPublicPublished === true` units and persisted customer data (zero dummy data)
    const proj = await createProjectService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Unified Cloud Developers',
      name: 'Unified Residency',
      code: 'UFR',
      city: 'Bengaluru',
      locality: 'Indiranagar',
      address: 'Indiranagar, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'KA-RERA-UFR',
      configurations: ['3 BHK'],
      constructionStatus: 'READY_TO_MOVE',
      isPublicPublished: true,
    });

    const pubUnit = await createUnitService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: proj.id,
      unitNumber: 'UFR-301',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 2100,
      carpetAreaSqft: 1500,
      facing: 'EAST',
      baseRatePerSqft: 14000,
      isPublicPublished: true,
    });

    await createUnitService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: proj.id,
      unitNumber: 'UFR-SECRET-302',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 2100,
      carpetAreaSqft: 1500,
      facing: 'WEST',
      baseRatePerSqft: 14000,
      isPublicPublished: false,
    });

    // Empty customer portal before saving anything (zero fabricated properties/enquiries!)
    const emptyPortal = await getCustomerPortalDataService(
      db,
      CUSTOMER_ACTOR,
      CUSTOMER_ACTOR.email
    );
    expect(emptyPortal.savedProperties).toHaveLength(0);
    expect(emptyPortal.myEnquiries).toHaveLength(0);
    expect(emptyPortal.myVisits).toHaveLength(0);

    // Customer saves published `pubUnit` and retrieves real persisted record
    const savedToggle = await toggleCustomerSavedPropertyService(db, CUSTOMER_ACTOR, {
      unitId: pubUnit.id,
      projectId: proj.id,
      orgId: organization.id,
    });
    expect(savedToggle.saved).toBe(true);

    const populatedPortal = await getCustomerPortalDataService(
      db,
      CUSTOMER_ACTOR,
      CUSTOMER_ACTOR.email
    );
    expect(populatedPortal.savedProperties).toHaveLength(1);
    expect(populatedPortal.savedProperties[0]?.unitNumber).toBe('UFR-301');

    // Verify transitionUnitStatusService works cleanly on real unit
    const held = await transitionUnitStatusService(db, BUILDER_A_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      unitId: pubUnit.id,
      targetStatus: 'ON_HOLD',
      action: 'HOLD',
      reason: 'Customer hold verification',
    });
    expect(held.status).toBe('ON_HOLD');

    // Verify returning builder immediately resolves their existing company (never sent back to onboarding)
    const returningSync = await syncMySessionMembershipsService(db, BUILDER_A_ADMIN, {
      email: BUILDER_A_ADMIN.email,
      emailVerified: true,
      mfaEnrolledCount: 1,
    });
    expect(returningSync.organizations).toHaveLength(1);
    expect(returningSync.organizations[0]?.id).toBe(organization.id);
    expect(
      resolveDefaultPostLoginRoute({
        isSuperAdmin: false,
        hasActiveBuilderMembership: returningSync.orgMemberships.some(
          (m) => m.status === 'ACTIVE'
        ),
        hasActivePartnerMembership: false,
        requestedPersona: 'builder',
      })
    ).toBe('/builder/dashboard');
  });
});
