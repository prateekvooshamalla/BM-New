import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import Razorpay from 'razorpay';
import { z } from 'zod';
import {
  AI_BILLING_RATE_CARD_V1,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  OPTIONAL_ONBOARDING_SERVICES,
  WHATSAPP_BILLING_RATE_CARD_V1,
  calculateBuilderSubscriptionMonthlyInr,
  type AiFeatureTask,
  type CreditTopupOrder,
  type OnboardingOrder,
  type OnboardingServiceCode,
  type PrepaidWalletType,
  type Project,
  type SaasInvoice,
  type SaasPayment,
  type SaasPlanCode,
  type Subscription,
  type SubscriptionEvent,
  type TenantEntitlements,
  type UsageLedgerEntry,
} from '@bharat-makaan/shared';
import {
  cancelSubscriptionSchema,
  changeSubscriptionCapacitySchema,
  initiateSubscriptionCheckoutSchema,
  initiateWalletTopupSchema,
  previewSubscriptionPricingSchema,
  verifyRazorpayCheckoutSignatureSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import {
  requireOrgPermission,
  requireSuperAdmin,
  type AuthenticatedActor,
} from '../shared/auth-guard';
import { verifyRazorpayHmacSignature } from '../collections';
import { writeAuditEvent } from '../audit';

export interface MinimalRazorpayProvider {
  plans: {
    create: (params: Record<string, unknown>) => Promise<{ id: string }>;
  };
  subscriptions: {
    create: (params: Record<string, unknown>) => Promise<{
      id: string;
      status?: string;
      short_url?: string;
    }>;
    update?: (
      subId: string,
      params: Record<string, unknown>
    ) => Promise<{ id: string; status?: string; quantity?: number }>;
    cancel?: (
      subId: string,
      cancelAtCycleEnd?: boolean
    ) => Promise<{ id: string; status?: string }>;
  };
  orders: {
    create: (params: Record<string, unknown>) => Promise<{
      id: string;
      amount: number;
      currency: string;
    }>;
  };
}

function getRazorpayProvider(injected?: MinimalRazorpayProvider): MinimalRazorpayProvider | null {
  if (injected) return injected;
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    }) as unknown as MinimalRazorpayProvider;
  }
  return null;
}

export function verifyRazorpayCheckoutHmac(params: {
  secret: string;
  paymentId: string;
  orderId?: string;
  subscriptionId?: string;
  signature: string;
}): boolean {
  if (!params.secret || !params.signature || !params.paymentId) return false;
  // Razorpay standard signature message:
  // - Subscription checkout: `${razorpay_payment_id}|${razorpay_subscription_id}`
  // - Order checkout: `${razorpay_order_id}|${razorpay_payment_id}`
  const message = params.subscriptionId
    ? `${params.paymentId}|${params.subscriptionId}`
    : `${params.orderId ?? ''}|${params.paymentId}`;

  const expectedHex = crypto
    .createHmac('sha256', params.secret)
    .update(message)
    .digest('hex');

  const a = Buffer.from(params.signature, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getConfigurableTaxRatePct(): number {
  const parsed = Number(process.env.SAAS_GST_RATE_PCT ?? '18');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 50 ? parsed : 18;
}

/**
 * Ensures `entitlements/{orgId}` exists for an organization, initializing from
 * `subscriptions/{orgId}` if needed.
 */
export async function getOrInitializeEntitlements(
  db: Firestore,
  orgId: string
): Promise<TenantEntitlements> {
  const entRef = db.collection('entitlements').doc(orgId);
  const entSnap = await entRef.get();
  if (entSnap.exists) {
    return entSnap.data() as TenantEntitlements;
  }

  const subSnap = await db.collection('subscriptions').doc(orgId).get();
  const sub = subSnap.exists ? (subSnap.data() as Subscription) : null;
  const nowIso = new Date().toISOString();

  const initialized: TenantEntitlements = {
    id: orgId,
    orgId,
    packageCode: sub?.planCode ?? 'SINGLE_PROJECT',
    workspaceAccessMode: 'FULL_ACCESS',
    subscribedProjectCapacity: sub?.subscribedProjectCapacity ?? 1,
    activeProjectsCount: sub?.usageThisCycle?.projectsCount ?? 0,
    aiBalancePaise: 0,
    aiReservedPaise: 0,
    whatsappBalancePaise: 0,
    whatsappReservedPaise: 0,
    aiOverdraftLimitPaise: 0,
    whatsappOverdraftLimitPaise: 0,
    lowBalanceThresholdPaise: 25000, // ₹250 low-balance alert threshold
    gracePeriodEndsAt: null,
    updatedAt: nowIso,
  };
  await entRef.set(initialized);
  return initialized;
}

// ============================================================================
// 1. Razorpay Plan Sync & Pricing Preview
// ============================================================================

export async function syncRazorpayPlansService(
  db: Firestore,
  actor: AuthenticatedActor,
  injectedProvider?: MinimalRazorpayProvider
): Promise<{
  singleProjectPlanId: string;
  multiProjectSlotPlanId: string;
  taxRatePct: number;
}> {
  const provider = getRazorpayProvider(injectedProvider);
  if (!provider) {
    throw new HttpsError(
      'failed-precondition',
      'RAZORPAY_NOT_CONFIGURED: Populate RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Cloud Functions secrets before syncing live provider plans.'
    );
  }

  const taxRatePct = getConfigurableTaxRatePct();
  const cfgRef = db.collection('_platform_config').doc('razorpay_plans');
  const cfgSnap = await cfgRef.get();
  const existing = cfgSnap.exists ? (cfgSnap.data() as Record<string, unknown>) : {};

  let singlePlanId =
    (existing.singleProjectPlanId as string | undefined) ||
    process.env.RAZORPAY_PLAN_SINGLE_PROJECT;
  let multiSlotPlanId =
    (existing.multiProjectSlotPlanId as string | undefined) ||
    process.env.RAZORPAY_PLAN_MULTI_PROJECT_SLOT;

  if (!singlePlanId) {
    const singleCalc = calculateBuilderSubscriptionMonthlyInr(
      'SINGLE_PROJECT',
      1,
      taxRatePct
    );
    const createdSingle = await provider.plans.create({
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Bharat Makaan — Single Project Builder (Monthly)',
        amount: singleCalc.monthlyTotalInr * 100,
        currency: 'INR',
        description: '1 active project, complete enterprise real estate OS.',
      },
      notes: { packageCode: 'SINGLE_PROJECT', taxRatePct: String(taxRatePct) },
    });
    singlePlanId = createdSingle.id;
  }

  if (!multiSlotPlanId) {
    const unitTaxInr = Math.round((4999 * taxRatePct) / 100);
    const perSlotTotalInr = 4999 + unitTaxInr;
    const createdMulti = await provider.plans.create({
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Bharat Makaan — Multi-Project Builder Slot (Monthly per Project)',
        amount: perSlotTotalInr * 100,
        currency: 'INR',
        description: 'Per-project monthly slot (minimum quantity 2 projects).',
      },
      notes: { packageCode: 'MULTI_PROJECT', taxRatePct: String(taxRatePct) },
    });
    multiSlotPlanId = createdMulti.id;
  }

  const nowIso = new Date().toISOString();
  await cfgRef.set(
    {
      singleProjectPlanId: singlePlanId,
      multiProjectSlotPlanId: multiSlotPlanId,
      taxRatePct,
      updatedByUid: actor.uid,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  await writeAuditEvent(db, {
    orgId: 'PLATFORM',
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: 'RAZORPAY_PLANS_SYNCED',
    category: 'BILLING',
    entityType: 'razorpay_plans',
    entityId: 'razorpay_plans',
    summary: `Synced Razorpay plans: SINGLE=${singlePlanId}, MULTI_SLOT=${multiSlotPlanId} (GST=${taxRatePct}%).`,
  });

  return {
    singleProjectPlanId: singlePlanId,
    multiProjectSlotPlanId: multiSlotPlanId,
    taxRatePct,
  };
}

export async function previewSubscriptionPricingService(
  db: Firestore,
  rawInput: unknown
) {
  const input = previewSubscriptionPricingSchema.parse(rawInput);
  const taxRatePct = getConfigurableTaxRatePct();
  const recurring = calculateBuilderSubscriptionMonthlyInr(
    input.packageCode,
    input.requestedProjectCapacity,
    taxRatePct
  );

  const onboardingCode: OnboardingServiceCode =
    input.onboardingServiceCode ?? 'SELF_SERVICE';
  const onboardingDef = OPTIONAL_ONBOARDING_SERVICES[onboardingCode];
  const onboardingSubtotalInr = onboardingDef.oneTimeFeeInr ?? 0;
  const onboardingTaxInr = Math.round((onboardingSubtotalInr * taxRatePct) / 100);
  const onboardingTotalInr = onboardingSubtotalInr + onboardingTaxInr;

  const subSnap = await db.collection('subscriptions').doc(input.orgId).get();
  const currentSub = subSnap.exists ? (subSnap.data() as Subscription) : null;
  const currentMonthlySubtotalInr = currentSub?.basePriceInr ?? 0;

  return {
    packageCode: recurring.packageCode,
    subscribedProjectCapacity: recurring.subscribedProjectCapacity,
    unitRateInr: recurring.unitRateInr,
    taxRatePct,
    recurring: {
      monthlySubtotalInr: recurring.monthlySubtotalInr,
      monthlyTaxInr: recurring.monthlyTaxInr,
      monthlyTotalInr: recurring.monthlyTotalInr,
      monthlyDeltaSubtotalInr: recurring.monthlySubtotalInr - currentMonthlySubtotalInr,
    },
    onboarding: {
      serviceCode: onboardingCode,
      serviceName: onboardingDef.name,
      requiresCustomQuote: onboardingDef.requiresCustomQuote,
      oneTimeSubtotalInr: onboardingSubtotalInr,
      oneTimeTaxInr: onboardingTaxInr,
      oneTimeTotalInr: onboardingTotalInr,
    },
  };
}

// ============================================================================
// 2. Initiate Subscription Checkout & Optional One-Time Onboarding Order
// ============================================================================

export async function initiateSubscriptionCheckoutService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown,
  injectedProvider?: MinimalRazorpayProvider
): Promise<{
  subscriptionId: string;
  razorpaySubscriptionId?: string;
  razorpayShortUrl?: string;
  razorpayKeyId?: string;
  invoice: SaasInvoice;
  onboardingOrder: OnboardingOrder;
  pricingSummary: Awaited<ReturnType<typeof previewSubscriptionPricingService>>;
}> {
  const input = initiateSubscriptionCheckoutSchema.parse(rawInput);

  if (input.clientPlatform === 'IOS' || input.clientPlatform === 'ANDROID') {
    throw new HttpsError(
      'failed-precondition',
      'SaaS subscription checkout must be completed via the Web Billing Console.'
    );
  }

  // Idempotency guard: prevent duplicate checkout creation on retries
  const existingInvSnap = await db
    .collection('invoices')
    .where('orgId', '==', input.orgId)
    .where('invoiceNumber', '==', `BM-SUB-${input.idempotencyKey.slice(0, 14).toUpperCase()}`)
    .limit(1)
    .get();
  if (!existingInvSnap.empty) {
    const existingInv = existingInvSnap.docs[0]!.data() as SaasInvoice;
    const onbSnap = await db
      .collection('onboarding_orders')
      .where('orgId', '==', input.orgId)
      .where('idempotencyKey', '==', input.idempotencyKey)
      .limit(1)
      .get();
    const subSnap = await db.collection('subscriptions').doc(input.orgId).get();
    const sub = subSnap.data() as Subscription;
    const pricingSummary = await previewSubscriptionPricingService(db, input);
    return {
      subscriptionId: input.orgId,
      razorpaySubscriptionId: existingInv.razorpaySubscriptionId ?? sub?.razorpaySubscriptionId,
      razorpayShortUrl: sub?.razorpayShortUrl,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      invoice: existingInv,
      onboardingOrder: onbSnap.docs[0]!.data() as OnboardingOrder,
      pricingSummary,
    };
  }

  const pricingSummary = await previewSubscriptionPricingService(db, input);
  const provider = getRazorpayProvider(injectedProvider);
  const nowIso = new Date().toISOString();

  let razorpaySubscriptionId: string | undefined;
  let razorpayShortUrl: string | undefined;
  let razorpayPlanId: string | undefined;

  if (provider) {
    const cfgSnap = await db.collection('_platform_config').doc('razorpay_plans').get();
    const cfg = cfgSnap.exists ? (cfgSnap.data() as Record<string, string>) : {};
    razorpayPlanId =
      input.packageCode === 'SINGLE_PROJECT'
        ? cfg.singleProjectPlanId || process.env.RAZORPAY_PLAN_SINGLE_PROJECT || 'plan_single_default'
        : cfg.multiProjectSlotPlanId || process.env.RAZORPAY_PLAN_MULTI_PROJECT_SLOT || 'plan_multi_slot_default';

    const quantity =
      input.packageCode === 'MULTI_PROJECT'
        ? pricingSummary.subscribedProjectCapacity
        : 1;

    const rzpSub = await provider.subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: 120, // 10-year monthly rolling mandate
      quantity,
      customer_notify: 1,
      notes: {
        system: 'BHARAT_MAKAAN_SAAS_BILLING',
        checkoutKind: 'SUBSCRIPTION',
        orgId: input.orgId,
        packageCode: input.packageCode,
        subscribedProjectCapacity: String(pricingSummary.subscribedProjectCapacity),
        idempotencyKey: input.idempotencyKey,
      },
    });
    razorpaySubscriptionId = rzpSub.id;
    razorpayShortUrl = rzpSub.short_url;
  }

  // Optional One-Time Assisted Onboarding Order (separate from subscription entitlements!)
  const onboardingDef = OPTIONAL_ONBOARDING_SERVICES[input.onboardingServiceCode];
  const onbRef = db.collection('onboarding_orders').doc();
  let onboardingRazorpayOrderId: string | undefined;
  let onboardingStatus: OnboardingOrder['status'] = 'FREE_SELF_SERVICE';

  if (onboardingDef.requiresCustomQuote) {
    onboardingStatus = 'QUOTE_REQUESTED';
  } else if ((onboardingDef.oneTimeFeeInr ?? 0) > 0) {
    onboardingStatus = 'PENDING_PAYMENT';
    if (provider) {
      const rzpOrder = await provider.orders.create({
        amount: pricingSummary.onboarding.oneTimeTotalInr * 100,
        currency: 'INR',
        receipt: onbRef.id,
        notes: {
          system: 'BHARAT_MAKAAN_SAAS_BILLING',
          checkoutKind: 'ONBOARDING',
          orgId: input.orgId,
          onboardingOrderId: onbRef.id,
          serviceCode: input.onboardingServiceCode,
        },
      });
      onboardingRazorpayOrderId = rzpOrder.id;
    }
  }

  const invRef = db.collection('invoices').doc();
  const invoice: SaasInvoice = {
    id: invRef.id,
    orgId: input.orgId,
    invoiceNumber: `BM-SUB-${input.idempotencyKey.slice(0, 14).toUpperCase()}`,
    subscriptionId: input.orgId,
    billingReason: 'SUBSCRIPTION',
    packageCode: input.packageCode,
    projectSlotsBilled: pricingSummary.subscribedProjectCapacity,
    subtotalInr: pricingSummary.recurring.monthlySubtotalInr,
    taxRatePct: pricingSummary.taxRatePct,
    gstInr: pricingSummary.recurring.monthlyTaxInr,
    totalInr: pricingSummary.recurring.monthlyTotalInr,
    status: 'ISSUED',
    razorpaySubscriptionId,
    razorpaySignatureVerified: false,
    issuedAt: nowIso,
    paidAt: null,
  };

  const onboardingOrder: OnboardingOrder = {
    id: onbRef.id,
    idempotencyKey: input.idempotencyKey,
    orgId: input.orgId,
    serviceCode: input.onboardingServiceCode,
    serviceName: onboardingDef.name,
    subtotalInr: pricingSummary.onboarding.oneTimeSubtotalInr,
    taxRatePct: pricingSummary.taxRatePct,
    gstInr: pricingSummary.onboarding.oneTimeTaxInr,
    totalInr: pricingSummary.onboarding.oneTimeTotalInr,
    status: onboardingStatus,
    razorpayOrderId: onboardingRazorpayOrderId,
    invoiceId: null,
    requestedByUid: actor.uid,
    notes: input.onboardingNotes,
    createdAt: nowIso,
    paidAt: onboardingStatus === 'FREE_SELF_SERVICE' ? nowIso : null,
    updatedAt: nowIso,
  };

  const paymentRef = db.collection('payments').doc();
  const pendingPayment: SaasPayment = {
    id: paymentRef.id,
    orgId: input.orgId,
    invoiceId: invoice.id,
    subscriptionId: input.orgId,
    paymentPurpose: 'SUBSCRIPTION',
    amountPaise: pricingSummary.recurring.monthlyTotalInr * 100,
    currency: 'INR',
    status: 'CREATED',
    razorpaySubscriptionId,
    signatureVerified: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // Record pending plan change on subscription WITHOUT unlocking paid project slots prematurely!
  const subRef = db.collection('subscriptions').doc(input.orgId);
  await db.runTransaction(async (tx) => {
    const subSnap = await tx.get(subRef);
    if (subSnap.exists) {
      tx.update(subRef, {
        razorpayPlanId: razorpayPlanId ?? null,
        pendingPlanChange: {
          targetPlanCode: input.packageCode,
          targetProjectCapacity: pricingSummary.subscribedProjectCapacity,
          razorpayReplacementSubscriptionId: razorpaySubscriptionId,
          requestedAt: nowIso,
        },
        razorpayShortUrl: razorpayShortUrl ?? null,
        updatedAt: nowIso,
      });
    }
    tx.set(invRef, invoice);
    tx.set(onbRef, onboardingOrder);
    tx.set(paymentRef, pendingPayment);
  });

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'SUBSCRIPTION_CHECKOUT_INITIATED',
    category: 'BILLING',
    entityType: 'subscription',
    entityId: input.orgId,
    summary: `Initiated ${input.packageCode} checkout (${pricingSummary.subscribedProjectCapacity} project slot(s), ₹${pricingSummary.recurring.monthlyTotalInr}/mo incl. tax; onboarding=${input.onboardingServiceCode}).`,
  });

  return {
    subscriptionId: input.orgId,
    razorpaySubscriptionId,
    razorpayShortUrl,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    invoice,
    onboardingOrder,
    pricingSummary,
  };
}

// ============================================================================
// 3. Plan Upgrades, Project Slot Changes, Safe Downgrades & Cancellations
// ============================================================================

export async function changeSubscriptionCapacityService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown,
  injectedProvider?: MinimalRazorpayProvider
) {
  const input = changeSubscriptionCapacitySchema.parse(rawInput);

  if (input.clientPlatform === 'IOS' || input.clientPlatform === 'ANDROID') {
    throw new HttpsError(
      'failed-precondition',
      'Subscription changes must be performed on the Web Billing Console.'
    );
  }

  const targetPricing = calculateBuilderSubscriptionMonthlyInr(
    input.targetPackageCode,
    input.targetProjectCapacity,
    getConfigurableTaxRatePct()
  );

  const [ent, projectsSnap, subSnap] = await Promise.all([
    getOrInitializeEntitlements(db, input.orgId),
    db.collection('projects').where('orgId', '==', input.orgId).get(),
    db.collection('subscriptions').doc(input.orgId).get(),
  ]);

  const activeProjects = projectsSnap.docs
    .map((d) => d.data() as Project)
    .filter((p) => (p.lifecycleStatus ?? 'ACTIVE') === 'ACTIVE');

  const isCapacityIncrease =
    targetPricing.subscribedProjectCapacity > ent.subscribedProjectCapacity ||
    (ent.packageCode === 'SINGLE_PROJECT' && input.targetPackageCode === 'MULTI_PROJECT');

  // If increasing capacity or upgrading SINGLE -> MULTI, require verified billing!
  if (isCapacityIncrease) {
    return initiateSubscriptionCheckoutService(
      db,
      actor,
      {
        orgId: input.orgId,
        packageCode: input.targetPackageCode,
        requestedProjectCapacity: targetPricing.subscribedProjectCapacity,
        onboardingServiceCode: 'SELF_SERVICE',
        clientPlatform: input.clientPlatform,
        idempotencyKey: input.idempotencyKey,
      },
      injectedProvider
    );
  }

  // Downgrade / Capacity Reduction: enforce active project selection without deleting data!
  if (activeProjects.length > targetPricing.subscribedProjectCapacity) {
    const retained = input.retainedActiveProjectIds ?? [];
    if (
      retained.length === 0 ||
      retained.length > targetPricing.subscribedProjectCapacity
    ) {
      throw new HttpsError(
        'failed-precondition',
        `DOWNGRADE_PROJECT_SELECTION_REQUIRED: You currently have ${activeProjects.length} active projects, which exceeds target capacity (${targetPricing.subscribedProjectCapacity}). Select up to ${targetPricing.subscribedProjectCapacity} project(s) to keep ACTIVE; remaining projects will be safely archived as read-only.`
      );
    }

    const activeIds = new Set(activeProjects.map((p) => p.id));
    for (const pid of retained) {
      if (!activeIds.has(pid)) {
        throw new HttpsError(
          'invalid-argument',
          `Project ${pid} is not an active project in your organization.`
        );
      }
    }
  }

  const provider = getRazorpayProvider(injectedProvider);
  const sub = subSnap.exists ? (subSnap.data() as Subscription) : null;
  if (provider?.subscriptions.update && sub?.razorpaySubscriptionId) {
    try {
      await provider.subscriptions.update(sub.razorpaySubscriptionId, {
        quantity:
          input.targetPackageCode === 'MULTI_PROJECT'
            ? targetPricing.subscribedProjectCapacity
            : 1,
        schedule_change_at: 'cycle_end',
      });
    } catch {
      // Provider mandate does not allow direct quantity update; handled cleanly via Firestore state
    }
  }

  const nowIso = new Date().toISOString();
  const retainedSet = new Set(
    input.retainedActiveProjectIds && input.retainedActiveProjectIds.length > 0
      ? input.retainedActiveProjectIds
      : activeProjects
          .slice(0, targetPricing.subscribedProjectCapacity)
          .map((p) => p.id)
  );

  const archivedProjectIds: string[] = [];

  await db.runTransaction(async (tx) => {
    for (const proj of activeProjects) {
      if (!retainedSet.has(proj.id)) {
        archivedProjectIds.push(proj.id);
        tx.update(db.collection('projects').doc(proj.id), {
          lifecycleStatus: 'ARCHIVED_READ_ONLY',
          isPublicPublished: false,
          updatedAt: nowIso,
        });
      }
    }

    const remainingActiveCount = activeProjects.length - archivedProjectIds.length;

    tx.set(
      db.collection('entitlements').doc(input.orgId),
      {
        ...ent,
        packageCode: input.targetPackageCode,
        subscribedProjectCapacity: targetPricing.subscribedProjectCapacity,
        activeProjectsCount: remainingActiveCount,
        updatedAt: nowIso,
      } satisfies TenantEntitlements
    );

    if (sub) {
      tx.update(db.collection('subscriptions').doc(input.orgId), {
        planCode: input.targetPackageCode,
        subscribedProjectCapacity: targetPricing.subscribedProjectCapacity,
        basePriceInr: targetPricing.monthlySubtotalInr,
        monthlyTotalInr: targetPricing.monthlyTotalInr,
        'entitlements.maxProjects': targetPricing.subscribedProjectCapacity,
        'usageThisCycle.projectsCount': remainingActiveCount,
        pendingPlanChange: null,
        updatedAt: nowIso,
      });
    }

    tx.update(db.collection('organizations').doc(input.orgId), {
      subscriptionPlanId: input.targetPackageCode,
      updatedAt: nowIso,
    });
  });

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'SUBSCRIPTION_DOWNGRADED_SAFELY',
    category: 'BILLING',
    entityType: 'subscription',
    entityId: input.orgId,
    summary: `Adjusted subscription to ${input.targetPackageCode} (${targetPricing.subscribedProjectCapacity} active project slot(s)). Archived ${archivedProjectIds.length} project(s) as read-only without deleting any historical data.`,
    after: {
      targetPackageCode: input.targetPackageCode,
      subscribedProjectCapacity: targetPricing.subscribedProjectCapacity,
      archivedProjectIds,
    },
  });

  return {
    downgraded: true,
    packageCode: input.targetPackageCode,
    subscribedProjectCapacity: targetPricing.subscribedProjectCapacity,
    archivedProjectIds,
  };
}

export async function cancelSubscriptionService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown,
  injectedProvider?: MinimalRazorpayProvider
) {
  const input = cancelSubscriptionSchema.parse(rawInput);
  const subRef = db.collection('subscriptions').doc(input.orgId);
  const entRef = db.collection('entitlements').doc(input.orgId);
  const [subSnap, ent] = await Promise.all([
    subRef.get(),
    getOrInitializeEntitlements(db, input.orgId),
  ]);

  if (!subSnap.exists) {
    throw new HttpsError('not-found', 'Subscription record not found.');
  }
  const sub = subSnap.data() as Subscription;
  const provider = getRazorpayProvider(injectedProvider);

  if (provider?.subscriptions.cancel && sub.razorpaySubscriptionId) {
    await provider.subscriptions.cancel(
      sub.razorpaySubscriptionId,
      !input.cancelImmediately
    );
  }

  const nowIso = new Date().toISOString();
  const nextStatus: Subscription['status'] = input.cancelImmediately
    ? 'CANCELLED'
    : 'CANCELLED_AT_PERIOD_END';
  const nextAccessMode: TenantEntitlements['workspaceAccessMode'] =
    input.cancelImmediately ? 'READ_ONLY_SUSPENDED' : ent.workspaceAccessMode;

  await db.runTransaction(async (tx) => {
    tx.update(subRef, {
      status: nextStatus,
      cancelAtPeriodEnd: !input.cancelImmediately,
      cancelledAt: nowIso,
      updatedAt: nowIso,
    });
    tx.set(entRef, {
      ...ent,
      workspaceAccessMode: nextAccessMode,
      updatedAt: nowIso,
    });
  });

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'SUBSCRIPTION_CANCELLED',
    category: 'BILLING',
    entityType: 'subscription',
    entityId: input.orgId,
    summary: `Cancelled subscription (${nextStatus}). Customer CRM, quotations, bookings, and exports preserved. Reason: ${input.reason}`,
  });

  return {
    status: nextStatus,
    workspaceAccessMode: nextAccessMode,
    dataPreserved: true,
  };
}

// ============================================================================
// 4. Prepaid AI Wallet & WhatsApp Wallet Top-Ups + Append-Only Usage Ledger
// ============================================================================

export async function initiateWalletTopupService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown,
  injectedProvider?: MinimalRazorpayProvider
): Promise<{ topupOrder: CreditTopupOrder; razorpayKeyId?: string }> {
  const input = initiateWalletTopupSchema.parse(rawInput);

  if (input.clientPlatform === 'IOS' || input.clientPlatform === 'ANDROID') {
    throw new HttpsError(
      'failed-precondition',
      'Prepaid wallet top-ups must be completed via the Web Billing Console.'
    );
  }

  const existingSnap = await db
    .collection('credit_topups')
    .where('orgId', '==', input.orgId)
    .where('idempotencyKey', '==', input.idempotencyKey)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    return {
      topupOrder: existingSnap.docs[0]!.data() as CreditTopupOrder,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    };
  }

  const taxRatePct = getConfigurableTaxRatePct();
  const gstInr = Math.round((input.amountInr * taxRatePct) / 100);
  const totalPayableInr = input.amountInr + gstInr;
  const totalPayablePaise = totalPayableInr * 100;
  const creditAmountPaise = input.amountInr * 100;
  const nowIso = new Date().toISOString();

  const ref = db.collection('credit_topups').doc();
  let razorpayOrderId: string | undefined;

  const provider = getRazorpayProvider(injectedProvider);
  if (provider) {
    const rzpOrder = await provider.orders.create({
      amount: totalPayablePaise,
      currency: 'INR',
      receipt: ref.id,
      notes: {
        system: 'BHARAT_MAKAAN_SAAS_BILLING',
        checkoutKind: 'WALLET_TOPUP',
        orgId: input.orgId,
        topupOrderId: ref.id,
        walletType: input.walletType,
        creditAmountPaise: String(creditAmountPaise),
      },
    });
    razorpayOrderId = rzpOrder.id;
  }

  const topupOrder: CreditTopupOrder = {
    id: ref.id,
    idempotencyKey: input.idempotencyKey,
    orgId: input.orgId,
    walletType: input.walletType,
    creditAmountInr: input.amountInr,
    creditAmountPaise,
    taxRatePct,
    gstInr,
    totalPayableInr,
    totalPayablePaise,
    status: 'PENDING_PAYMENT',
    razorpayOrderId,
    invoiceId: null,
    requestedByUid: actor.uid,
    createdAt: nowIso,
    creditedAt: null,
    updatedAt: nowIso,
  };

  await ref.set(topupOrder);

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'WALLET_TOPUP_INITIATED',
    category: 'BILLING',
    entityType: 'credit_topup',
    entityId: topupOrder.id,
    summary: `Initiated ${input.walletType} Wallet top-up of ₹${input.amountInr} (Total payable ₹${totalPayableInr} incl. GST).`,
  });

  return { topupOrder, razorpayKeyId: process.env.RAZORPAY_KEY_ID };
}

export function calculateAiUsageCostPaise(
  model: string,
  inputTokens: number,
  outputTokens: number
): { chargePaise: number; rateVersion: string; estimatedCostUsd: number } {
  const modelRate =
    AI_BILLING_RATE_CARD_V1.models[model] ?? AI_BILLING_RATE_CARD_V1.defaultModelRate;
  const usd =
    (Math.max(0, inputTokens) / 1_000_000) * modelRate.inputPer1MUsd +
    (Math.max(0, outputTokens) / 1_000_000) * modelRate.outputPer1MUsd;
  const rawPaise = Math.ceil(usd * AI_BILLING_RATE_CARD_V1.usdToInrRate * 100);
  const chargePaise = Math.max(modelRate.minChargePaise, rawPaise);

  return {
    chargePaise,
    rateVersion: AI_BILLING_RATE_CARD_V1.version,
    estimatedCostUsd: Number(usd.toFixed(6)),
  };
}

/**
 * Reserves prepaid wallet funds before a high-cost AI or WhatsApp action.
 * Never permits negative balances unless `aiOverdraftLimitPaise` / `whatsappOverdraftLimitPaise`
 * was explicitly granted by Platform Super Admin.
 */
export async function reserveWalletBalanceService(
  db: Firestore,
  params: {
    orgId: string;
    walletType: PrepaidWalletType;
    requestId: string;
    estimatedPaise: number;
    actorUid?: string | null;
    summary: string;
  }
): Promise<{ alreadySettled: boolean; reservedPaise: number }> {
  const settledId = `debit_${params.orgId}_${params.walletType}_${params.requestId}`;
  const holdId = `hold_${params.orgId}_${params.walletType}_${params.requestId}`;
  const entRef = db.collection('entitlements').doc(params.orgId);

  return db.runTransaction(async (tx) => {
    const [settledSnap, holdSnap, entSnap] = await Promise.all([
      tx.get(db.collection('usage_ledger').doc(settledId)),
      tx.get(db.collection('usage_ledger').doc(holdId)),
      tx.get(entRef),
    ]);

    if (settledSnap.exists) {
      return { alreadySettled: true, reservedPaise: 0 };
    }
    if (holdSnap.exists) {
      return {
        alreadySettled: false,
        reservedPaise: (holdSnap.data() as UsageLedgerEntry).amountPaise,
      };
    }

    const nowIso = new Date().toISOString();
    const ent: TenantEntitlements = entSnap.exists
      ? (entSnap.data() as TenantEntitlements)
      : {
          id: params.orgId,
          orgId: params.orgId,
          packageCode: 'SINGLE_PROJECT',
          workspaceAccessMode: 'FULL_ACCESS',
          subscribedProjectCapacity: 1,
          activeProjectsCount: 0,
          aiBalancePaise: 0,
          aiReservedPaise: 0,
          whatsappBalancePaise: 0,
          whatsappReservedPaise: 0,
          aiOverdraftLimitPaise: 0,
          whatsappOverdraftLimitPaise: 0,
          lowBalanceThresholdPaise: 25000,
          gracePeriodEndsAt: null,
          updatedAt: nowIso,
        };

    const balance =
      params.walletType === 'AI' ? ent.aiBalancePaise : ent.whatsappBalancePaise;
    const reserved =
      params.walletType === 'AI' ? ent.aiReservedPaise : ent.whatsappReservedPaise;
    const overdraft =
      params.walletType === 'AI'
        ? ent.aiOverdraftLimitPaise
        : ent.whatsappOverdraftLimitPaise;

    const available = balance - reserved + overdraft;
    if (available < params.estimatedPaise) {
      const code =
        params.walletType === 'AI'
          ? 'INSUFFICIENT_AI_CREDITS'
          : 'INSUFFICIENT_WHATSAPP_CREDITS';
      throw new HttpsError(
        'resource-exhausted',
        `${code}: Insufficient prepaid ${params.walletType} Wallet balance (Available ₹${(
          Math.max(0, balance - reserved) / 100
        ).toFixed(2)}). Top up your ${params.walletType} Wallet in Billing -> Wallets to run new chargeable actions. Existing CRM data remains fully accessible.`
      );
    }

    const nextReserved = reserved + params.estimatedPaise;
    const updatedEnt: TenantEntitlements =
      params.walletType === 'AI'
        ? { ...ent, aiReservedPaise: nextReserved, updatedAt: nowIso }
        : { ...ent, whatsappReservedPaise: nextReserved, updatedAt: nowIso };

    const holdEntry: UsageLedgerEntry = {
      id: holdId,
      orgId: params.orgId,
      walletType: params.walletType,
      entryType: 'RESERVATION_HOLD',
      amountPaise: params.estimatedPaise,
      balanceAfterPaise: balance,
      reservedAfterPaise: nextReserved,
      requestId: params.requestId,
      actorUid: params.actorUid ?? null,
      summary: params.summary,
      createdAt: nowIso,
    };

    tx.set(entRef, updatedEnt);
    tx.set(db.collection('usage_ledger').doc(holdId), holdEntry);

    return { alreadySettled: false, reservedPaise: params.estimatedPaise };
  });
}

/**
 * Releases an in-flight wallet reservation when a provider call fails,
 * ensuring failed AI or WhatsApp attempts never deduct funds.
 */
export async function releaseWalletReservationService(
  db: Firestore,
  params: {
    orgId: string;
    walletType: PrepaidWalletType;
    requestId: string;
    reason: string;
  }
): Promise<void> {
  const holdId = `hold_${params.orgId}_${params.walletType}_${params.requestId}`;
  const releaseId = `release_${params.orgId}_${params.walletType}_${params.requestId}`;
  const entRef = db.collection('entitlements').doc(params.orgId);

  await db.runTransaction(async (tx) => {
    const [holdSnap, relSnap, entSnap] = await Promise.all([
      tx.get(db.collection('usage_ledger').doc(holdId)),
      tx.get(db.collection('usage_ledger').doc(releaseId)),
      tx.get(entRef),
    ]);
    if (!holdSnap.exists || relSnap.exists || !entSnap.exists) return;

    const hold = holdSnap.data() as UsageLedgerEntry;
    const ent = entSnap.data() as TenantEntitlements;
    const nowIso = new Date().toISOString();

    const currentReserved =
      params.walletType === 'AI' ? ent.aiReservedPaise : ent.whatsappReservedPaise;
    const balance =
      params.walletType === 'AI' ? ent.aiBalancePaise : ent.whatsappBalancePaise;
    const nextReserved = Math.max(0, currentReserved - hold.amountPaise);

    tx.set(
      entRef,
      params.walletType === 'AI'
        ? { ...ent, aiReservedPaise: nextReserved, updatedAt: nowIso }
        : { ...ent, whatsappReservedPaise: nextReserved, updatedAt: nowIso }
    );

    const releaseEntry: UsageLedgerEntry = {
      id: releaseId,
      orgId: params.orgId,
      walletType: params.walletType,
      entryType: 'RESERVATION_RELEASE',
      amountPaise: hold.amountPaise,
      balanceAfterPaise: balance,
      reservedAfterPaise: nextReserved,
      requestId: params.requestId,
      summary: `Released reservation: ${params.reason}`,
      createdAt: nowIso,
    };
    tx.set(db.collection('usage_ledger').doc(releaseId), releaseEntry);
  });
}

/**
 * Settles actual measured AI token usage against the organization's AI Wallet
 * and releases any unused reservation atomically. Idempotent by `requestId`.
 */
export async function settleAiWalletUsageService(
  db: Firestore,
  params: {
    orgId: string;
    requestId: string;
    actorUid: string;
    feature: AiFeatureTask;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }
): Promise<{ entry: UsageLedgerEntry; deduplicated: boolean }> {
  const settledId = `debit_${params.orgId}_AI_${params.requestId}`;
  const holdId = `hold_${params.orgId}_AI_${params.requestId}`;
  const entRef = db.collection('entitlements').doc(params.orgId);
  const cost = calculateAiUsageCostPaise(
    params.model,
    params.inputTokens,
    params.outputTokens
  );

  return db.runTransaction(async (tx) => {
    const [settledSnap, holdSnap, entSnap] = await Promise.all([
      tx.get(db.collection('usage_ledger').doc(settledId)),
      tx.get(db.collection('usage_ledger').doc(holdId)),
      tx.get(entRef),
    ]);

    if (settledSnap.exists) {
      return {
        entry: settledSnap.data() as UsageLedgerEntry,
        deduplicated: true,
      };
    }

    const nowIso = new Date().toISOString();
    const ent = entSnap.data() as TenantEntitlements;
    const heldPaise = holdSnap.exists
      ? (holdSnap.data() as UsageLedgerEntry).amountPaise
      : 0;

    const nextReserved = Math.max(0, ent.aiReservedPaise - heldPaise);
    const availableWithOverdraft =
      ent.aiBalancePaise - nextReserved + ent.aiOverdraftLimitPaise;

    if (availableWithOverdraft < cost.chargePaise) {
      throw new HttpsError(
        'resource-exhausted',
        'INSUFFICIENT_AI_CREDITS: Prepaid AI Wallet balance is insufficient to settle measured usage.'
      );
    }

    const nextBalance = ent.aiBalancePaise - cost.chargePaise;
    tx.set(entRef, {
      ...ent,
      aiBalancePaise: nextBalance,
      aiReservedPaise: nextReserved,
      updatedAt: nowIso,
    } satisfies TenantEntitlements);

    const entry: UsageLedgerEntry = {
      id: settledId,
      orgId: params.orgId,
      walletType: 'AI',
      entryType: 'USAGE_DEBIT',
      amountPaise: cost.chargePaise,
      balanceAfterPaise: nextBalance,
      reservedAfterPaise: nextReserved,
      requestId: params.requestId,
      actorUid: params.actorUid,
      aiMetadata: {
        feature: params.feature,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        rateVersion: cost.rateVersion,
      },
      summary: `AI ${params.feature} (${params.model}: ${params.inputTokens} in / ${params.outputTokens} out tokens) -> ₹${(
        cost.chargePaise / 100
      ).toFixed(2)}`,
      createdAt: nowIso,
    };

    tx.set(db.collection('usage_ledger').doc(settledId), entry);
    return { entry, deduplicated: false };
  });
}

/**
 * Charges an organization's WhatsApp Wallet for a billable template/conversation
 * message idempotently by `waMessageId`. Never double-charges on retries or webhook redeliveries.
 */
export async function chargeWhatsappMessageWalletService(
  db: Firestore,
  params: {
    orgId: string;
    wabaOrPhoneNumberId: string;
    waMessageId: string;
    recipientMarket?: string;
    messageCategory: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'SERVICE';
    deliveryEvidence: string;
    actorUid?: string | null;
  }
): Promise<{ entry: UsageLedgerEntry | null; deduplicated: boolean; chargePaise: number }> {
  const market = (params.recipientMarket || 'IN').toUpperCase();
  const marketSchedule =
    WHATSAPP_BILLING_RATE_CARD_V1.markets[market] ??
    WHATSAPP_BILLING_RATE_CARD_V1.markets.ROW!;
  const ratePaise = marketSchedule[params.messageCategory] ?? 0;

  // Non-chargeable SERVICE window replies cost ₹0 and never block
  if (ratePaise <= 0) {
    return { entry: null, deduplicated: false, chargePaise: 0 };
  }

  const settledId = `debit_${params.orgId}_WHATSAPP_${params.waMessageId}`;
  const entRef = db.collection('entitlements').doc(params.orgId);

  return db.runTransaction(async (tx) => {
    const [existingSnap, entSnap] = await Promise.all([
      tx.get(db.collection('usage_ledger').doc(settledId)),
      tx.get(entRef),
    ]);

    if (existingSnap.exists) {
      const existing = existingSnap.data() as UsageLedgerEntry;
      return {
        entry: existing,
        deduplicated: true,
        chargePaise: existing.amountPaise,
      };
    }

    const nowIso = new Date().toISOString();
    const ent: TenantEntitlements = entSnap.exists
      ? (entSnap.data() as TenantEntitlements)
      : {
          id: params.orgId,
          orgId: params.orgId,
          packageCode: 'SINGLE_PROJECT',
          workspaceAccessMode: 'FULL_ACCESS',
          subscribedProjectCapacity: 1,
          activeProjectsCount: 0,
          aiBalancePaise: 0,
          aiReservedPaise: 0,
          whatsappBalancePaise: 0,
          whatsappReservedPaise: 0,
          aiOverdraftLimitPaise: 0,
          whatsappOverdraftLimitPaise: 0,
          lowBalanceThresholdPaise: 25000,
          gracePeriodEndsAt: null,
          updatedAt: nowIso,
        };

    const available =
      ent.whatsappBalancePaise -
      ent.whatsappReservedPaise +
      ent.whatsappOverdraftLimitPaise;
    if (available < ratePaise) {
      throw new HttpsError(
        'resource-exhausted',
        `INSUFFICIENT_WHATSAPP_CREDITS: Prepaid WhatsApp Wallet balance (₹${(
          Math.max(0, ent.whatsappBalancePaise - ent.whatsappReservedPaise) / 100
        ).toFixed(2)}) is insufficient for ${params.messageCategory} message (₹${(
          ratePaise / 100
        ).toFixed(2)}). Top up your WhatsApp Wallet in Billing.`
      );
    }

    const nextBalance = ent.whatsappBalancePaise - ratePaise;
    tx.set(entRef, {
      ...ent,
      whatsappBalancePaise: nextBalance,
      updatedAt: nowIso,
    } satisfies TenantEntitlements);

    const entry: UsageLedgerEntry = {
      id: settledId,
      orgId: params.orgId,
      walletType: 'WHATSAPP',
      entryType: 'USAGE_DEBIT',
      amountPaise: ratePaise,
      balanceAfterPaise: nextBalance,
      reservedAfterPaise: ent.whatsappReservedPaise,
      requestId: params.waMessageId,
      actorUid: params.actorUid ?? null,
      whatsappMetadata: {
        wabaOrPhoneNumberId: params.wabaOrPhoneNumberId,
        waMessageId: params.waMessageId,
        recipientMarket: market,
        messageCategory: params.messageCategory,
        deliveryEvidence: params.deliveryEvidence,
        rateVersion: WHATSAPP_BILLING_RATE_CARD_V1.version,
        appliedRatePaise: ratePaise,
      },
      summary: `WhatsApp ${params.messageCategory} (${market}, msg=${params.waMessageId}) -> ₹${(
        ratePaise / 100
      ).toFixed(2)}`,
      createdAt: nowIso,
    };
    tx.set(db.collection('usage_ledger').doc(settledId), entry);

    return { entry, deduplicated: false, chargePaise: ratePaise };
  });
}

export async function refundFailedWhatsappChargeService(
  db: Firestore,
  params: {
    orgId: string;
    waMessageId: string;
    reason: string;
  }
): Promise<{ refunded: boolean; amountPaise: number }> {
  const settledId = `debit_${params.orgId}_WHATSAPP_${params.waMessageId}`;
  const refundId = `refund_${params.orgId}_WHATSAPP_${params.waMessageId}`;
  const entRef = db.collection('entitlements').doc(params.orgId);

  return db.runTransaction(async (tx) => {
    const [settledSnap, refundSnap, entSnap] = await Promise.all([
      tx.get(db.collection('usage_ledger').doc(settledId)),
      tx.get(db.collection('usage_ledger').doc(refundId)),
      tx.get(entRef),
    ]);

    if (!settledSnap.exists || refundSnap.exists || !entSnap.exists) {
      return { refunded: false, amountPaise: 0 };
    }

    const original = settledSnap.data() as UsageLedgerEntry;
    const ent = entSnap.data() as TenantEntitlements;
    const nowIso = new Date().toISOString();
    const nextBalance = ent.whatsappBalancePaise + original.amountPaise;

    tx.set(entRef, {
      ...ent,
      whatsappBalancePaise: nextBalance,
      updatedAt: nowIso,
    } satisfies TenantEntitlements);

    const refundEntry: UsageLedgerEntry = {
      id: refundId,
      orgId: params.orgId,
      walletType: 'WHATSAPP',
      entryType: 'FAILED_DELIVERY_REFUND',
      amountPaise: original.amountPaise,
      balanceAfterPaise: nextBalance,
      reservedAfterPaise: ent.whatsappReservedPaise,
      requestId: params.waMessageId,
      summary: `Auto-credited failed WhatsApp delivery (${params.waMessageId}): ${params.reason}`,
      createdAt: nowIso,
    };
    tx.set(db.collection('usage_ledger').doc(refundId), refundEntry);

    return { refunded: true, amountPaise: original.amountPaise };
  });
}

/**
 * Audited Platform Super Admin credit grant / enterprise overdraft configuration.
 */
export async function superAdminAdjustWalletService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    walletType: PrepaidWalletType;
    creditDeltaPaise?: number;
    overdraftLimitPaise?: number;
    requestId: string;
    reason: string;
  }
): Promise<TenantEntitlements> {
  if (!actor.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Super Admin authorization required.');
  }

  await getOrInitializeEntitlements(db, params.orgId);
  const entRef = db.collection('entitlements').doc(params.orgId);
  const ledgerId = `admin_adj_${params.orgId}_${params.walletType}_${params.requestId}`;

  const updated = await db.runTransaction(async (tx) => {
    const [entSnap, ledSnap] = await Promise.all([
      tx.get(entRef),
      tx.get(db.collection('usage_ledger').doc(ledgerId)),
    ]);
    const ent = entSnap.data() as TenantEntitlements;
    if (ledSnap.exists) return ent;

    const nowIso = new Date().toISOString();
    const delta = params.creditDeltaPaise ?? 0;

    const nextAiBalance =
      params.walletType === 'AI' ? ent.aiBalancePaise + delta : ent.aiBalancePaise;
    const nextWaBalance =
      params.walletType === 'WHATSAPP'
        ? ent.whatsappBalancePaise + delta
        : ent.whatsappBalancePaise;

    if (nextAiBalance < -ent.aiOverdraftLimitPaise || nextWaBalance < -ent.whatsappOverdraftLimitPaise) {
      throw new HttpsError('failed-precondition', 'Adjustment would violate overdraft floor.');
    }

    const nextEnt: TenantEntitlements = {
      ...ent,
      aiBalancePaise: nextAiBalance,
      whatsappBalancePaise: nextWaBalance,
      aiOverdraftLimitPaise:
        params.walletType === 'AI' && params.overdraftLimitPaise !== undefined
          ? params.overdraftLimitPaise
          : ent.aiOverdraftLimitPaise,
      whatsappOverdraftLimitPaise:
        params.walletType === 'WHATSAPP' && params.overdraftLimitPaise !== undefined
          ? params.overdraftLimitPaise
          : ent.whatsappOverdraftLimitPaise,
      updatedAt: nowIso,
    };
    tx.set(entRef, nextEnt);

    if (delta !== 0) {
      const entry: UsageLedgerEntry = {
        id: ledgerId,
        orgId: params.orgId,
        walletType: params.walletType,
        entryType: 'ADMIN_CREDIT_ADJUSTMENT',
        amountPaise: Math.abs(delta),
        balanceAfterPaise: params.walletType === 'AI' ? nextAiBalance : nextWaBalance,
        reservedAfterPaise:
          params.walletType === 'AI' ? ent.aiReservedPaise : ent.whatsappReservedPaise,
        requestId: params.requestId,
        actorUid: actor.uid,
        summary: `Super Admin wallet adjustment (${delta >= 0 ? '+' : '-'}₹${(
          Math.abs(delta) / 100
        ).toFixed(2)}): ${params.reason}`,
        createdAt: nowIso,
      };
      tx.set(db.collection('usage_ledger').doc(ledgerId), entry);
    }

    return nextEnt;
  });

  await writeAuditEvent(db, {
    orgId: 'PLATFORM',
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: 'SUPER_ADMIN_WALLET_ADJUSTED',
    category: 'BILLING',
    entityType: 'entitlements',
    entityId: params.orgId,
    summary: `Adjusted ${params.walletType} wallet for org ${params.orgId}. Reason: ${params.reason}`,
  });

  return updated;
}

// ============================================================================
// 5. Authoritative Payment Activation & Idempotent Razorpay Webhook Processing
// ============================================================================

async function activateSubscriptionEntitlementTransactionally(
  db: Firestore,
  params: {
    eventId: string;
    eventType: string;
    orgId: string;
    packageCode: SaasPlanCode;
    subscribedProjectCapacity: number;
    razorpaySubscriptionId?: string;
    razorpayPaymentId?: string;
    invoiceId?: string;
  }
): Promise<{ deduplicated: boolean }> {
  const eventRef = db.collection('subscription_events').doc(params.eventId);
  const subRef = db.collection('subscriptions').doc(params.orgId);
  const entRef = db.collection('entitlements').doc(params.orgId);
  const orgRef = db.collection('organizations').doc(params.orgId);

  const taxRatePct = getConfigurableTaxRatePct();
  const calc = calculateBuilderSubscriptionMonthlyInr(
    params.packageCode,
    params.subscribedProjectCapacity,
    taxRatePct
  );

  return db.runTransaction(async (tx) => {
    const [evSnap, subSnap, entSnap, projectsSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(subRef),
      tx.get(entRef),
      tx.get(db.collection('projects').where('orgId', '==', params.orgId)),
    ]);

    if (evSnap.exists && (evSnap.data() as SubscriptionEvent).processed) {
      return { deduplicated: true };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const periodEnd = new Date(now.getTime() + 30 * 86400 * 1000).toISOString();
    const activeProjectsCount = projectsSnap.docs.filter(
      (d) => ((d.data() as Project).lifecycleStatus ?? 'ACTIVE') === 'ACTIVE'
    ).length;

    const prevSub = subSnap.exists ? (subSnap.data() as Subscription) : null;
    const prevEnt = entSnap.exists ? (entSnap.data() as TenantEntitlements) : null;

    const nextSub: Subscription = {
      id: params.orgId,
      orgId: params.orgId,
      planCode: calc.packageCode,
      billingCycle: 'MONTHLY',
      subscribedProjectCapacity: calc.subscribedProjectCapacity,
      basePriceInr: calc.monthlySubtotalInr,
      taxRatePct,
      monthlyTotalInr: calc.monthlyTotalInr,
      onboardingFeePaid: prevSub?.onboardingFeePaid ?? false,
      status: 'ACTIVE',
      entitlements: {
        maxProjects: calc.subscribedProjectCapacity,
        maxUsers: -1,
        monthlyAiCredits: 0,
        monthlyWhatsappQuota: 0,
      },
      usageThisCycle: {
        projectsCount: activeProjectsCount,
        activeUsersCount: prevSub?.usageThisCycle.activeUsersCount ?? 1,
        aiCreditsUsed: prevSub?.usageThisCycle.aiCreditsUsed ?? 0,
        whatsappMessagesSent: prevSub?.usageThisCycle.whatsappMessagesSent ?? 0,
      },
      addons: prevSub?.addons ?? {
        extraUsers: 0,
        extraProjects: 0,
        extraAiCredits: 0,
        extraWhatsappQuota: 0,
      },
      razorpaySubscriptionId:
        params.razorpaySubscriptionId ?? prevSub?.razorpaySubscriptionId,
      pendingPlanChange: null,
      gracePeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodStart: nowIso,
      currentPeriodEnd: periodEnd,
      updatedAt: nowIso,
    };

    const nextEnt: TenantEntitlements = {
      id: params.orgId,
      orgId: params.orgId,
      packageCode: calc.packageCode,
      workspaceAccessMode: 'FULL_ACCESS',
      subscribedProjectCapacity: calc.subscribedProjectCapacity,
      activeProjectsCount,
      aiBalancePaise: prevEnt?.aiBalancePaise ?? 0,
      aiReservedPaise: prevEnt?.aiReservedPaise ?? 0,
      whatsappBalancePaise: prevEnt?.whatsappBalancePaise ?? 0,
      whatsappReservedPaise: prevEnt?.whatsappReservedPaise ?? 0,
      aiOverdraftLimitPaise: prevEnt?.aiOverdraftLimitPaise ?? 0,
      whatsappOverdraftLimitPaise: prevEnt?.whatsappOverdraftLimitPaise ?? 0,
      lowBalanceThresholdPaise: prevEnt?.lowBalanceThresholdPaise ?? 25000,
      gracePeriodEndsAt: null,
      updatedAt: nowIso,
    };

    tx.set(subRef, nextSub);
    tx.set(entRef, nextEnt);
    tx.update(orgRef, {
      subscriptionPlanId: calc.packageCode,
      status: 'ACTIVE',
      updatedAt: nowIso,
    });

    if (params.invoiceId) {
      tx.update(db.collection('invoices').doc(params.invoiceId), {
        status: 'PAID',
        razorpayPaymentId: params.razorpayPaymentId ?? null,
        razorpaySignatureVerified: true,
        paidAt: nowIso,
      });
    }

    if (params.razorpayPaymentId) {
      const payId = `rzp_${params.razorpayPaymentId}`;
      tx.set(db.collection('payments').doc(payId), {
        id: payId,
        orgId: params.orgId,
        invoiceId: params.invoiceId ?? null,
        subscriptionId: params.orgId,
        paymentPurpose: 'SUBSCRIPTION',
        amountPaise: calc.monthlyTotalInr * 100,
        currency: 'INR',
        status: 'CAPTURED',
        razorpayPaymentId: params.razorpayPaymentId,
        razorpaySubscriptionId: params.razorpaySubscriptionId,
        signatureVerified: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      } satisfies SaasPayment);
    }

    tx.set(eventRef, {
      id: params.eventId,
      orgId: params.orgId,
      provider: 'RAZORPAY',
      eventType: params.eventType,
      razorpaySubscriptionId: params.razorpaySubscriptionId ?? null,
      razorpayPaymentId: params.razorpayPaymentId ?? null,
      signatureVerified: true,
      processed: true,
      processingSummary: `Activated ${calc.packageCode} (${calc.subscribedProjectCapacity} project slot(s)).`,
      receivedAt: nowIso,
    } satisfies SubscriptionEvent);

    return { deduplicated: false };
  });
}

async function settleCreditTopupTransactionally(
  db: Firestore,
  params: {
    eventId: string;
    topupOrderId: string;
    razorpayPaymentId: string;
  }
): Promise<{ deduplicated: boolean }> {
  const eventRef = db.collection('subscription_events').doc(params.eventId);
  const topupRef = db.collection('credit_topups').doc(params.topupOrderId);

  return db.runTransaction(async (tx) => {
    const [evSnap, topupSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(topupRef),
    ]);

    if (evSnap.exists && (evSnap.data() as SubscriptionEvent).processed) {
      return { deduplicated: true };
    }
    if (!topupSnap.exists) {
      throw new HttpsError('not-found', 'Credit top-up order not found.');
    }

    const topup = topupSnap.data() as CreditTopupOrder;
    if (topup.status === 'PAID') {
      return { deduplicated: true };
    }

    const entRef = db.collection('entitlements').doc(topup.orgId);
    const entSnap = await tx.get(entRef);
    const nowIso = new Date().toISOString();

    const prevEnt: TenantEntitlements = entSnap.exists
      ? (entSnap.data() as TenantEntitlements)
      : {
          id: topup.orgId,
          orgId: topup.orgId,
          packageCode: 'SINGLE_PROJECT',
          workspaceAccessMode: 'FULL_ACCESS',
          subscribedProjectCapacity: 1,
          activeProjectsCount: 0,
          aiBalancePaise: 0,
          aiReservedPaise: 0,
          whatsappBalancePaise: 0,
          whatsappReservedPaise: 0,
          aiOverdraftLimitPaise: 0,
          whatsappOverdraftLimitPaise: 0,
          lowBalanceThresholdPaise: 25000,
          gracePeriodEndsAt: null,
          updatedAt: nowIso,
        };

    const nextBalance =
      topup.walletType === 'AI'
        ? prevEnt.aiBalancePaise + topup.creditAmountPaise
        : prevEnt.whatsappBalancePaise + topup.creditAmountPaise;

    const invRef = db.collection('invoices').doc();
    const invoice: SaasInvoice = {
      id: invRef.id,
      orgId: topup.orgId,
      invoiceNumber: `BM-TOPUP-${topup.id.slice(0, 8).toUpperCase()}`,
      subscriptionId: topup.orgId,
      billingReason: 'WALLET_TOPUP',
      subtotalInr: topup.creditAmountInr,
      taxRatePct: topup.taxRatePct,
      gstInr: topup.gstInr,
      totalInr: topup.totalPayableInr,
      status: 'PAID',
      razorpayOrderId: topup.razorpayOrderId,
      razorpayPaymentId: params.razorpayPaymentId,
      razorpaySignatureVerified: true,
      issuedAt: nowIso,
      paidAt: nowIso,
    };

    const ledgerId = `topup_${topup.orgId}_${topup.id}`;
    const ledgerEntry: UsageLedgerEntry = {
      id: ledgerId,
      orgId: topup.orgId,
      walletType: topup.walletType,
      entryType: 'TOPUP_CREDIT',
      amountPaise: topup.creditAmountPaise,
      balanceAfterPaise: nextBalance,
      reservedAfterPaise:
        topup.walletType === 'AI'
          ? prevEnt.aiReservedPaise
          : prevEnt.whatsappReservedPaise,
      requestId: topup.id,
      actorUid: topup.requestedByUid,
      summary: `Credited ₹${topup.creditAmountInr} to ${topup.walletType} Wallet (Payment ${params.razorpayPaymentId}).`,
      createdAt: nowIso,
    };

    tx.set(
      entRef,
      topup.walletType === 'AI'
        ? { ...prevEnt, aiBalancePaise: nextBalance, updatedAt: nowIso }
        : { ...prevEnt, whatsappBalancePaise: nextBalance, updatedAt: nowIso }
    );
    tx.update(topupRef, {
      status: 'PAID',
      razorpayPaymentId: params.razorpayPaymentId,
      invoiceId: invoice.id,
      creditedAt: nowIso,
      updatedAt: nowIso,
    });
    tx.set(invRef, invoice);
    tx.set(db.collection('usage_ledger').doc(ledgerId), ledgerEntry);
    tx.set(db.collection('payments').doc(`rzp_${params.razorpayPaymentId}`), {
      id: `rzp_${params.razorpayPaymentId}`,
      orgId: topup.orgId,
      invoiceId: invoice.id,
      topupOrderId: topup.id,
      paymentPurpose:
        topup.walletType === 'AI' ? 'AI_WALLET_TOPUP' : 'WHATSAPP_WALLET_TOPUP',
      amountPaise: topup.totalPayablePaise,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayPaymentId: params.razorpayPaymentId,
      razorpayOrderId: topup.razorpayOrderId,
      signatureVerified: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    } satisfies SaasPayment);
    tx.set(eventRef, {
      id: params.eventId,
      orgId: topup.orgId,
      provider: 'RAZORPAY',
      eventType: 'wallet.topup.captured',
      razorpayPaymentId: params.razorpayPaymentId,
      razorpayOrderId: topup.razorpayOrderId ?? null,
      signatureVerified: true,
      processed: true,
      processingSummary: `Credited ${topup.creditAmountPaise} Paise to ${topup.walletType} Wallet.`,
      receivedAt: nowIso,
    } satisfies SubscriptionEvent);

    return { deduplicated: false };
  });
}

/**
 * Verifies post-checkout Razorpay HMAC signature on the server before updating
 * any subscription entitlement, onboarding order, or wallet top-up.
 * Never trusts a client-supplied price, quantity, or boolean success flag.
 */
export async function verifyRazorpayCheckoutSignatureService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown,
  keySecretOverride?: string
) {
  const input = verifyRazorpayCheckoutSignatureSchema.parse(rawInput);
  const secret = keySecretOverride ?? process.env.RAZORPAY_KEY_SECRET ?? '';

  const isValid = verifyRazorpayCheckoutHmac({
    secret,
    paymentId: input.razorpayPaymentId,
    orderId: input.razorpayOrderId,
    subscriptionId: input.razorpaySubscriptionId,
    signature: input.razorpaySignature,
  });

  if (!isValid) {
    throw new HttpsError(
      'permission-denied',
      'INVALID_RAZORPAY_SIGNATURE: Payment signature verification failed on server.'
    );
  }

  const eventId = `checkout_verify_${input.checkoutKind}_${input.razorpayPaymentId}`;

  if (input.checkoutKind === 'WALLET_TOPUP') {
    const res = await settleCreditTopupTransactionally(db, {
      eventId,
      topupOrderId: input.referenceId,
      razorpayPaymentId: input.razorpayPaymentId,
    });
    return { verified: true, ...res };
  }

  if (input.checkoutKind === 'ONBOARDING') {
    const onbRef = db.collection('onboarding_orders').doc(input.referenceId);
    const snap = await onbRef.get();
    if (!snap.exists || snap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Onboarding order not found.');
    }
    const nowIso = new Date().toISOString();
    await onbRef.update({
      status: 'PAID',
      razorpayPaymentId: input.razorpayPaymentId,
      paidAt: nowIso,
      updatedAt: nowIso,
    });
    await db.collection('subscriptions').doc(input.orgId).update({
      onboardingFeePaid: true,
      updatedAt: nowIso,
    });
    return { verified: true, deduplicated: false };
  }

  // SUBSCRIPTION checkout verification: read authoritative target capacity from server-stored pendingPlanChange
  const subSnap = await db.collection('subscriptions').doc(input.orgId).get();
  if (!subSnap.exists) {
    throw new HttpsError('not-found', 'Subscription record not found.');
  }
  const sub = subSnap.data() as Subscription;
  const targetPackage = sub.pendingPlanChange?.targetPlanCode ?? sub.planCode;
  const targetCapacity =
    sub.pendingPlanChange?.targetProjectCapacity ?? sub.subscribedProjectCapacity;

  const res = await activateSubscriptionEntitlementTransactionally(db, {
    eventId,
    eventType: 'checkout.subscription.verified',
    orgId: input.orgId,
    packageCode: targetPackage,
    subscribedProjectCapacity: targetCapacity,
    razorpaySubscriptionId: input.razorpaySubscriptionId ?? sub.razorpaySubscriptionId,
    razorpayPaymentId: input.razorpayPaymentId,
    invoiceId: input.referenceId,
  });

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'SUBSCRIPTION_PAYMENT_VERIFIED',
    category: 'BILLING',
    entityType: 'subscription',
    entityId: input.orgId,
    summary: `Verified Razorpay payment ${input.razorpayPaymentId}; activated ${targetPackage} (${targetCapacity} project slot(s)).`,
  });

  return { verified: true, ...res };
}

/**
 * Processes raw Razorpay webhook events idempotently after HMAC verification.
 */
export async function processRazorpayWebhookService(params: {
  db: Firestore;
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  eventIdHeader?: string | undefined;
  webhookSecret: string;
}): Promise<{ ok: boolean; deduplicated?: boolean; handledEvent?: string }> {
  const { db, rawBody, signatureHeader, eventIdHeader, webhookSecret } = params;

  if (!verifyRazorpayHmacSignature(rawBody, signatureHeader, webhookSecret)) {
    throw new HttpsError('unauthenticated', 'Invalid Razorpay webhook signature.');
  }

  const parsed = (
    typeof rawBody === 'string'
      ? JSON.parse(rawBody)
      : JSON.parse(rawBody.toString('utf8'))
  ) as Record<string, any>;

  const eventType = String(parsed.event || 'unknown');
  const subEntity = parsed?.payload?.subscription?.entity;
  const payEntity = parsed?.payload?.payment?.entity;
  const notes = subEntity?.notes ?? payEntity?.notes ?? {};
  const orgId = String(notes.orgId || '');

  const deterministicEventId =
    eventIdHeader?.trim() ||
    crypto
      .createHash('sha256')
      .update(
        `${eventType}:${subEntity?.id ?? ''}:${payEntity?.id ?? ''}:${parsed?.created_at ?? ''}`
      )
      .digest('hex')
      .slice(0, 32);

  if (!orgId) {
    return { ok: true, handledEvent: 'ignored_non_saas_event' };
  }

  // 1. Subscription Activated / Charged / Authenticated
  if (
    eventType === 'subscription.activated' ||
    eventType === 'subscription.charged' ||
    eventType === 'subscription.authenticated'
  ) {
    const packageCode =
      (notes.packageCode as SaasPlanCode) || 'SINGLE_PROJECT';
    const capacity = Number(
      notes.subscribedProjectCapacity ?? subEntity?.quantity ?? 1
    );
    const res = await activateSubscriptionEntitlementTransactionally(db, {
      eventId: deterministicEventId,
      eventType,
      orgId,
      packageCode,
      subscribedProjectCapacity:
        packageCode === 'SINGLE_PROJECT' ? 1 : Math.max(2, capacity),
      razorpaySubscriptionId: subEntity?.id,
      razorpayPaymentId: payEntity?.id,
    });
    return { ok: true, deduplicated: res.deduplicated, handledEvent: eventType };
  }

  // 2. One-Time Wallet Top-up or Onboarding Order Captured
  if (eventType === 'payment.captured' && payEntity?.id) {
    if (notes.checkoutKind === 'WALLET_TOPUP' && notes.topupOrderId) {
      const res = await settleCreditTopupTransactionally(db, {
        eventId: deterministicEventId,
        topupOrderId: String(notes.topupOrderId),
        razorpayPaymentId: String(payEntity.id),
      });
      return { ok: true, deduplicated: res.deduplicated, handledEvent: eventType };
    }

    if (notes.checkoutKind === 'ONBOARDING' && notes.onboardingOrderId) {
      const evRef = db.collection('subscription_events').doc(deterministicEventId);
      const evSnap = await evRef.get();
      if (evSnap.exists) return { ok: true, deduplicated: true, handledEvent: eventType };
      const nowIso = new Date().toISOString();
      await db
        .collection('onboarding_orders')
        .doc(String(notes.onboardingOrderId))
        .update({
          status: 'PAID',
          razorpayPaymentId: String(payEntity.id),
          paidAt: nowIso,
          updatedAt: nowIso,
        });
      await evRef.set({
        id: deterministicEventId,
        orgId,
        provider: 'RAZORPAY',
        eventType,
        razorpayPaymentId: String(payEntity.id),
        signatureVerified: true,
        processed: true,
        processingSummary: 'Marked assisted onboarding order PAID.',
        receivedAt: nowIso,
      } satisfies SubscriptionEvent);
      return { ok: true, deduplicated: false, handledEvent: eventType };
    }
  }

  // 3. Payment Failed / Subscription Halted -> NEVER grant paid entitlements or wallet credits!
  if (
    eventType === 'payment.failed' ||
    eventType === 'subscription.halted' ||
    eventType === 'subscription.pending'
  ) {
    const evRef = db.collection('subscription_events').doc(deterministicEventId);
    const evSnap = await evRef.get();
    if (evSnap.exists) {
      return { ok: true, deduplicated: true, handledEvent: eventType };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const graceEnds = new Date(
      now.getTime() + DEFAULT_SUBSCRIPTION_GRACE_DAYS * 86400 * 1000
    ).toISOString();

    if (notes.checkoutKind === 'WALLET_TOPUP' && notes.topupOrderId) {
      await db
        .collection('credit_topups')
        .doc(String(notes.topupOrderId))
        .update({
          status: 'FAILED',
          updatedAt: nowIso,
        });
    } else {
      const subRef = db.collection('subscriptions').doc(orgId);
      const entRef = db.collection('entitlements').doc(orgId);
      const [subSnap, entSnap] = await Promise.all([subRef.get(), entRef.get()]);

      if (subSnap.exists) {
        const curSub = subSnap.data() as Subscription;
        // Only enter PAST_DUE grace period if previously ACTIVE; if initial checkout failed, keep existing capacity untouched!
        if (curSub.status === 'ACTIVE') {
          await subRef.update({
            status: 'PAST_DUE',
            gracePeriodEndsAt: graceEnds,
            updatedAt: nowIso,
          });
          if (entSnap.exists) {
            await entRef.update({
              workspaceAccessMode: 'GRACE_WARNING',
              gracePeriodEndsAt: graceEnds,
              updatedAt: nowIso,
            });
          }
        }
      }
    }

    if (payEntity?.id) {
      await db
        .collection('payments')
        .doc(`rzp_${payEntity.id}`)
        .set({
          id: `rzp_${payEntity.id}`,
          orgId,
          topupOrderId: notes.topupOrderId ? String(notes.topupOrderId) : null,
          subscriptionId: notes.checkoutKind === 'SUBSCRIPTION' ? orgId : null,
          paymentPurpose:
            notes.checkoutKind === 'WALLET_TOPUP'
              ? notes.walletType === 'WHATSAPP'
                ? 'WHATSAPP_WALLET_TOPUP'
                : 'AI_WALLET_TOPUP'
              : 'SUBSCRIPTION',
          amountPaise: Number(payEntity.amount ?? 0),
          currency: 'INR',
          status: 'FAILED',
          razorpayPaymentId: String(payEntity.id),
          signatureVerified: true,
          failureReason: String(payEntity.error_description || eventType),
          createdAt: nowIso,
          updatedAt: nowIso,
        } satisfies SaasPayment);
    }

    await evRef.set({
      id: deterministicEventId,
      orgId,
      provider: 'RAZORPAY',
      eventType,
      razorpaySubscriptionId: subEntity?.id ?? null,
      razorpayPaymentId: payEntity?.id ?? null,
      signatureVerified: true,
      processed: true,
      processingSummary: 'Recorded failed payment without granting unpaid entitlements.',
      receivedAt: nowIso,
    } satisfies SubscriptionEvent);

    return { ok: true, deduplicated: false, handledEvent: eventType };
  }

  // 4. Subscription Cancelled
  if (eventType === 'subscription.cancelled') {
    const evRef = db.collection('subscription_events').doc(deterministicEventId);
    if ((await evRef.get()).exists) {
      return { ok: true, deduplicated: true, handledEvent: eventType };
    }
    const nowIso = new Date().toISOString();
    await db.collection('subscriptions').doc(orgId).update({
      status: 'CANCELLED',
      cancelledAt: nowIso,
      updatedAt: nowIso,
    });
    await db.collection('entitlements').doc(orgId).update({
      workspaceAccessMode: 'READ_ONLY_SUSPENDED',
      updatedAt: nowIso,
    });
    await evRef.set({
      id: deterministicEventId,
      orgId,
      provider: 'RAZORPAY',
      eventType,
      razorpaySubscriptionId: subEntity?.id ?? null,
      signatureVerified: true,
      processed: true,
      processingSummary: 'Transitioned cancelled subscription to READ_ONLY_SUSPENDED while preserving data.',
      receivedAt: nowIso,
    } satisfies SubscriptionEvent);
    return { ok: true, deduplicated: false, handledEvent: eventType };
  }

  return { ok: true, handledEvent: eventType };
}

// ============================================================================
// 6. Cloud Functions v2 Callables & Webhook Endpoint
// ============================================================================

export const syncRazorpayPlans = onCall(async (request) => {
  const actor = requireSuperAdmin(request);
  return syncRazorpayPlansService(adminDb, actor);
});

export const previewSubscriptionPricing = onCall(async (request) => {
  const parsed = previewSubscriptionPricingSchema.parse(request.data);
  await requireOrgPermission(request, parsed.orgId, 'billing:view', null, {
    isReadOrBillingOperation: true,
  });
  return previewSubscriptionPricingService(adminDb, parsed);
});

export const initiateSubscriptionCheckout = onCall(async (request) => {
  const parsed = initiateSubscriptionCheckoutSchema.parse(request.data);
  const { actor } = await requireOrgPermission(
    request,
    parsed.orgId,
    'billing:manage',
    null,
    { isReadOrBillingOperation: true }
  );
  return initiateSubscriptionCheckoutService(adminDb, actor, parsed);
});

export const changeSubscriptionCapacity = onCall(async (request) => {
  const parsed = changeSubscriptionCapacitySchema.parse(request.data);
  const { actor } = await requireOrgPermission(
    request,
    parsed.orgId,
    'billing:manage',
    null,
    { isReadOrBillingOperation: true }
  );
  return changeSubscriptionCapacityService(adminDb, actor, parsed);
});

export const cancelSaasSubscription = onCall(async (request) => {
  const parsed = cancelSubscriptionSchema.parse(request.data);
  const { actor } = await requireOrgPermission(
    request,
    parsed.orgId,
    'billing:manage',
    null,
    { isReadOrBillingOperation: true }
  );
  return cancelSubscriptionService(adminDb, actor, parsed);
});

export const initiateWalletTopup = onCall(async (request) => {
  const parsed = initiateWalletTopupSchema.parse(request.data);
  const { actor } = await requireOrgPermission(
    request,
    parsed.orgId,
    'billing:manage',
    null,
    { isReadOrBillingOperation: true }
  );
  return initiateWalletTopupService(adminDb, actor, parsed);
});

export const verifyRazorpayCheckoutSignature = onCall(async (request) => {
  const parsed = verifyRazorpayCheckoutSignatureSchema.parse(request.data);
  const { actor } = await requireOrgPermission(
    request,
    parsed.orgId,
    'billing:manage',
    null,
    { isReadOrBillingOperation: true }
  );
  return verifyRazorpayCheckoutSignatureService(adminDb, actor, parsed);
});

export const superAdminAdjustWallet = onCall(async (request) => {
  const actor = requireSuperAdmin(request);
  const schema = z.object({
    orgId: z.string().min(1),
    walletType: z.enum(['AI', 'WHATSAPP']),
    creditDeltaPaise: z.number().int().optional(),
    overdraftLimitPaise: z.number().int().nonnegative().optional(),
    requestId: z.string().min(4).max(120),
    reason: z.string().min(5).max(400),
  });
  return superAdminAdjustWalletService(adminDb, actor, schema.parse(request.data));
});

export const razorpayBillingWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const secret = process.env.RAZORPAY_SAAS_WEBHOOK_SECRET || '';
  try {
    const result = await processRazorpayWebhookService({
      db: adminDb,
      rawBody: req.rawBody,
      signatureHeader: req.header('x-razorpay-signature'),
      eventIdHeader: req.header('x-razorpay-event-id'),
      webhookSecret: secret,
    });
    res.status(200).json(result);
  } catch (err) {
    const code = err instanceof HttpsError && err.code === 'unauthenticated' ? 401 : 400;
    res.status(code).json({
      error: err instanceof Error ? err.message : 'Webhook processing failed.',
    });
  }
});
