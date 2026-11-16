import * as React from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  CreditCard,
  MessageSquareText,
  Plus,
  ReceiptIndianRupee,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import {
  BUILDER_SUBSCRIPTION_PACKAGES,
  OPTIONAL_ONBOARDING_SERVICES,
  WALLET_TOPUP_PRESETS_INR,
  calculateBuilderSubscriptionMonthlyInr,
  formatInr,
  type CreditTopupOrder,
  type OnboardingOrder,
  type OnboardingServiceCode,
  type PrepaidWalletType,
  type SaasInvoice,
  type SaasPayment,
  type SaasPlanCode,
  type Subscription,
  type UsageLedgerEntry,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreateOrganizationDialog } from '@/features/organizations/components/CreateOrganizationDialog';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpayCheckoutScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function formatPaiseAsInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function BuilderBillingPage({
  onboardingMode = false,
}: {
  onboardingMode?: boolean;
}) {
  const {
    activeOrgId,
    activeOrganization,
    activeEntitlements,
    projects,
    email,
  } = useTenantStore();

  const [createOrgOpen, setCreateOrgOpen] = React.useState(false);
  const [subscription, setSubscription] = React.useState<Subscription | null>(null);
  const [invoices, setInvoices] = React.useState<SaasInvoice[]>([]);
  const [payments, setPayments] = React.useState<SaasPayment[]>([]);
  const [onboardingOrders, setOnboardingOrders] = React.useState<OnboardingOrder[]>([]);
  const [topupOrders, setTopupOrders] = React.useState<CreditTopupOrder[]>([]);
  const [ledgerEntries, setLedgerEntries] = React.useState<UsageLedgerEntry[]>([]);

  // Package & Slot Selection State
  const [selectedPackage, setSelectedPackage] =
    React.useState<SaasPlanCode>('SINGLE_PROJECT');
  const [projectSlots, setProjectSlots] = React.useState<number>(2);
  const [onboardingCode, setOnboardingCode] =
    React.useState<OnboardingServiceCode>('SELF_SERVICE');
  const [retainedProjectIds, setRetainedProjectIds] = React.useState<string[]>([]);

  // Wallet Top-Up State
  const [aiTopupInr, setAiTopupInr] = React.useState<string>('2000');
  const [waTopupInr, setWaTopupInr] = React.useState<string>('2000');
  const [cancelReason, setCancelReason] = React.useState<string>('');

  const [busy, setBusy] = React.useState(false);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!activeOrgId) return;

    const uSub = onSnapshot(
      doc(db, 'subscriptions', activeOrgId),
      (snap) => {
        if (snap.exists()) {
          const s = snap.data() as Subscription;
          setSubscription(s);
          setSelectedPackage(s.planCode);
          if (s.planCode === 'MULTI_PROJECT') {
            setProjectSlots(Math.max(2, s.subscribedProjectCapacity));
          }
        }
      },
      () => {}
    );

    const uInv = onSnapshot(
      query(
        collection(db, 'invoices'),
        where('orgId', '==', activeOrgId),
        orderBy('issuedAt', 'desc'),
        limit(50)
      ),
      (snap) => setInvoices(snap.docs.map((d) => d.data() as SaasInvoice)),
      () => setInvoices([])
    );

    const uPay = onSnapshot(
      query(
        collection(db, 'payments'),
        where('orgId', '==', activeOrgId),
        orderBy('createdAt', 'desc'),
        limit(50)
      ),
      (snap) => setPayments(snap.docs.map((d) => d.data() as SaasPayment)),
      () => setPayments([])
    );

    const uOnb = onSnapshot(
      query(
        collection(db, 'onboarding_orders'),
        where('orgId', '==', activeOrgId),
        limit(20)
      ),
      (snap) => setOnboardingOrders(snap.docs.map((d) => d.data() as OnboardingOrder)),
      () => setOnboardingOrders([])
    );

    const uTop = onSnapshot(
      query(
        collection(db, 'credit_topups'),
        where('orgId', '==', activeOrgId),
        limit(30)
      ),
      (snap) => setTopupOrders(snap.docs.map((d) => d.data() as CreditTopupOrder)),
      () => setTopupOrders([])
    );

    const uLed = onSnapshot(
      query(
        collection(db, 'usage_ledger'),
        where('orgId', '==', activeOrgId),
        orderBy('createdAt', 'desc'),
        limit(100)
      ),
      (snap) => setLedgerEntries(snap.docs.map((d) => d.data() as UsageLedgerEntry)),
      () => setLedgerEntries([])
    );

    return () => {
      uSub();
      uInv();
      uPay();
      uOnb();
      uTop();
      uLed();
    };
  }, [activeOrgId]);

  const activeProjects = React.useMemo(
    () => projects.filter((p) => (p.lifecycleStatus ?? 'ACTIVE') === 'ACTIVE'),
    [projects]
  );

  const livePricing = React.useMemo(
    () =>
      calculateBuilderSubscriptionMonthlyInr(
        selectedPackage,
        selectedPackage === 'MULTI_PROJECT' ? projectSlots : 1,
        18
      ),
    [projectSlots, selectedPackage]
  );

  const selectedOnboarding = OPTIONAL_ONBOARDING_SERVICES[onboardingCode];
  const onboardingSubtotal = selectedOnboarding.oneTimeFeeInr ?? 0;
  const onboardingGst = Math.round(onboardingSubtotal * 0.18);
  const onboardingTotal = onboardingSubtotal + onboardingGst;

  const needsDowngradeProjectSelection =
    activeProjects.length > livePricing.subscribedProjectCapacity;

  const handleSubscriptionCheckoutOrChange = async () => {
    if (!activeOrgId) return;
    setBusy(true);
    setBanner(null);
    setErrorMsg(null);

    try {
      const idempotencyKey = `sub_${activeOrgId}_${selectedPackage}_${livePricing.subscribedProjectCapacity}_${Date.now()}`;
      const isExistingActiveSub = subscription?.status === 'ACTIVE';

      if (isExistingActiveSub && needsDowngradeProjectSelection) {
        const res = await callBackendFunction<any, any>('changeSubscriptionCapacity', {
          orgId: activeOrgId,
          targetPackageCode: selectedPackage,
          targetProjectCapacity: livePricing.subscribedProjectCapacity,
          retainedActiveProjectIds: retainedProjectIds,
          clientPlatform: 'WEB',
          idempotencyKey,
        });
        setBanner(
          `Subscription updated to ${res.packageCode} (${res.subscribedProjectCapacity} active project slot(s)). Excess projects were safely archived as read-only.`
        );
        setBusy(false);
        return;
      }

      const checkoutRes = await callBackendFunction<
        any,
        {
          razorpaySubscriptionId?: string;
          razorpayKeyId?: string;
          invoice: SaasInvoice;
          onboardingOrder: OnboardingOrder;
        }
      >('initiateSubscriptionCheckout', {
        orgId: activeOrgId,
        packageCode: selectedPackage,
        requestedProjectCapacity: livePricing.subscribedProjectCapacity,
        onboardingServiceCode: onboardingCode,
        clientPlatform: 'WEB',
        idempotencyKey,
      });

      if (checkoutRes.razorpayKeyId && checkoutRes.razorpaySubscriptionId) {
        const loaded = await loadRazorpayCheckoutScript();
        if (loaded && window.Razorpay) {
          const rzp = new window.Razorpay({
            key: checkoutRes.razorpayKeyId,
            subscription_id: checkoutRes.razorpaySubscriptionId,
            name: 'Bharat Makaan Cloud',
            description: `${BUILDER_SUBSCRIPTION_PACKAGES[selectedPackage].name} (${livePricing.subscribedProjectCapacity} Project Slot(s))`,
            prefill: { email: email ?? '' },
            handler: async (response: Record<string, string>) => {
              await callBackendFunction('verifyRazorpayCheckoutSignature', {
                orgId: activeOrgId,
                checkoutKind: 'SUBSCRIPTION',
                referenceId: checkoutRes.invoice.id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySubscriptionId: response.razorpay_subscription_id,
                razorpaySignature: response.razorpay_signature,
              });
              setBanner(
                `Payment verified! Activated ${selectedPackage} with ${livePricing.subscribedProjectCapacity} project slot(s).`
              );
            },
          });
          rzp.open();
        }
      } else {
        setBanner(
          `Issued pending invoice ${checkoutRes.invoice.invoiceNumber} (${formatInr(checkoutRes.invoice.totalInr)} incl. GST). Configure RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET in Cloud Functions secrets to open live Razorpay Checkout; paid capacity unlocks strictly after verified payment.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Subscription checkout failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleWalletTopup = async (walletType: PrepaidWalletType, amountInrRaw: string) => {
    if (!activeOrgId) return;
    const amountInr = Number(amountInrRaw);
    if (!Number.isFinite(amountInr) || amountInr < 100) {
      setErrorMsg('Enter a valid top-up amount of at least ₹100.');
      return;
    }

    setBusy(true);
    setBanner(null);
    setErrorMsg(null);
    try {
      const res = await callBackendFunction<
        any,
        { topupOrder: CreditTopupOrder; razorpayKeyId?: string }
      >('initiateWalletTopup', {
        orgId: activeOrgId,
        walletType,
        amountInr,
        clientPlatform: 'WEB',
        idempotencyKey: `topup_${activeOrgId}_${walletType}_${amountInr}_${Date.now()}`,
      });

      if (res.razorpayKeyId && res.topupOrder.razorpayOrderId) {
        const loaded = await loadRazorpayCheckoutScript();
        if (loaded && window.Razorpay) {
          const rzp = new window.Razorpay({
            key: res.razorpayKeyId,
            order_id: res.topupOrder.razorpayOrderId,
            amount: res.topupOrder.totalPayablePaise,
            currency: 'INR',
            name: 'Bharat Makaan Cloud',
            description: `${walletType} Prepaid Wallet Top-Up (₹${amountInr})`,
            prefill: { email: email ?? '' },
            handler: async (response: Record<string, string>) => {
              await callBackendFunction('verifyRazorpayCheckoutSignature', {
                orgId: activeOrgId,
                checkoutKind: 'WALLET_TOPUP',
                referenceId: res.topupOrder.id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
              });
              setBanner(`Credited ₹${amountInr} to your ${walletType} Wallet!`);
            },
          });
          rzp.open();
        }
      } else {
        setBanner(
          `Created ${walletType} Wallet top-up order (₹${amountInr} + GST = ${formatInr(res.topupOrder.totalPayableInr)}). Balance increases strictly after verified Razorpay capture.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Wallet top-up initiation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!activeOrgId || cancelReason.trim().length < 3) return;
    setBusy(true);
    setBanner(null);
    setErrorMsg(null);
    try {
      await callBackendFunction('cancelSaasSubscription', {
        orgId: activeOrgId,
        cancelImmediately: false,
        reason: cancelReason.trim(),
      });
      setCancelReason('');
      setBanner(
        'Subscription scheduled to cancel at period end. All projects, CRM leads, quotations, and lawful exports remain preserved.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Cancellation request failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={onboardingMode ? 'Step 1 of 2 — Builder Company Onboarding' : 'Enterprise Billing'}
          title="Register Your Builder or Developer Organization"
          description="Set up your legal company entity first, then choose between Single Project Builder (₹5,999/mo) or Multi-Project Builder (₹4,999/project/mo)."
          actions={
            <Button size="sm" onClick={() => setCreateOrgOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Builder Organization
            </Button>
          }
        />
        <EmptyState
          icon={Building2}
          title="No Builder Organization Created Yet"
          description="Click below to register your company details, GSTIN/Tax ID, and headquarters city."
          actionLabel="Start Builder Onboarding"
          onAction={() => setCreateOrgOpen(true)}
        />
        <CreateOrganizationDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
      </div>
    );
  }

  const aiAvailablePaise = Math.max(
    0,
    (activeEntitlements?.aiBalancePaise ?? 0) - (activeEntitlements?.aiReservedPaise ?? 0)
  );
  const waAvailablePaise = Math.max(
    0,
    (activeEntitlements?.whatsappBalancePaise ?? 0) -
      (activeEntitlements?.whatsappReservedPaise ?? 0)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Tenant Billing & Prepaid Wallets • ${activeOrganization?.name ?? ''}`}
        title={
          onboardingMode
            ? 'Builder Onboarding, Subscription & Wallets'
            : 'Subscriptions, Project Capacity & Prepaid Wallets'
        }
        description="Manage your Single Project or Multi-Project Builder subscription, optional white-glove onboarding, prepaid AI & WhatsApp wallets, and GST invoices."
      />

      {/* Billing Recovery / Grace Warning Banner */}
      {(activeEntitlements?.workspaceAccessMode === 'GRACE_WARNING' ||
        activeEntitlements?.workspaceAccessMode === 'READ_ONLY_SUSPENDED' ||
        subscription?.status === 'PAST_DUE') && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">
                Billing Attention Required ({subscription?.status ?? activeEntitlements?.workspaceAccessMode})
              </div>
              <p className="mt-0.5">
                {activeEntitlements?.workspaceAccessMode === 'READ_ONLY_SUSPENDED'
                  ? 'Workspace is in controlled read-only mode. Existing CRM records, bookings, and exports remain preserved. Complete subscription checkout below to restore write operations.'
                  : `Renewal payment failed. Grace period ends ${
                      activeEntitlements?.gracePeriodEndsAt
                        ? new Date(activeEntitlements.gracePeriodEndsAt).toLocaleDateString()
                        : 'soon'
                    }.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Insufficient / Low Prepaid Credits Warning */}
      {(aiAvailablePaise === 0 || waAvailablePaise === 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/60 px-4 py-3 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>Prepaid Wallet Notice:</strong> AI consumption and chargeable WhatsApp
              templates require positive wallet balances (AI: {formatPaiseAsInr(aiAvailablePaise)},
              WhatsApp: {formatPaiseAsInr(waAvailablePaise)}). Core CRM, inventory, pricing, and
              quotations remain active even at ₹0.00 wallet balance.
            </span>
          </div>
        </div>
      )}

      {banner && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100">
          {banner}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {errorMsg}
        </div>
      )}

      {/* Live Entitlements & Wallets KPI Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Active Builder Package</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-base font-bold">
              {subscription?.planCode === 'MULTI_PROJECT'
                ? 'Multi-Project Builder'
                : 'Single Project Builder'}
            </div>
            <StatusBadge status={subscription?.status ?? 'PENDING_CHECKOUT'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">
              Active Project Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeProjects.length} / {activeEntitlements?.subscribedProjectCapacity ?? 1}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Server-enforced active project slots
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-primary" />
              Prepaid AI Wallet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPaiseAsInr(aiAvailablePaise)}</div>
            <div className="text-[11px] text-muted-foreground">
              Reserved in-flight: {formatPaiseAsInr(activeEntitlements?.aiReservedPaise ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <MessageSquareText className="h-3.5 w-3.5 text-emerald-600" />
              Prepaid WhatsApp Wallet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPaiseAsInr(waAvailablePaise)}</div>
            <div className="text-[11px] text-muted-foreground">
              Metered per authorized Meta rate card
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="packages">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="packages">Packages &amp; Project Slots</TabsTrigger>
          <TabsTrigger value="wallets">AI &amp; WhatsApp Wallets</TabsTrigger>
          <TabsTrigger value="ledger">Usage &amp; Credit Ledger ({ledgerEntries.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices &amp; Payments ({invoices.length})</TabsTrigger>
          <TabsTrigger value="cancel">Cancel &amp; Recovery</TabsTrigger>
        </TabsList>

        {/* TAB 1: TWO BUILDER PACKAGES + OPTIONAL ONBOARDING */}
        <TabsContent value="packages" className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            {/* Package 1: SINGLE_PROJECT */}
            <Card
              className={
                selectedPackage === 'SINGLE_PROJECT'
                  ? 'border-2 border-primary shadow-sm'
                  : 'border-border'
              }
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {BUILDER_SUBSCRIPTION_PACKAGES.SINGLE_PROJECT.name}
                  </CardTitle>
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold">
                    SINGLE_PROJECT
                  </span>
                </div>
                <div className="pt-1 text-2xl font-bold text-primary">
                  ₹5,999 <span className="text-xs font-normal text-muted-foreground">/ month + GST</span>
                </div>
                <CardDescription>
                  {BUILDER_SUBSCRIPTION_PACKAGES.SINGLE_PROJECT.tagline}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <ul className="space-y-1.5">
                  {BUILDER_SUBSCRIPTION_PACKAGES.SINGLE_PROJECT.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant={selectedPackage === 'SINGLE_PROJECT' ? 'default' : 'outline'}
                  size="sm"
                  className="w-full"
                  onClick={() => setSelectedPackage('SINGLE_PROJECT')}
                >
                  {selectedPackage === 'SINGLE_PROJECT'
                    ? 'Selected — Single Project (1 Active Project)'
                    : 'Select Single Project Package'}
                </Button>
              </CardContent>
            </Card>

            {/* Package 2: MULTI_PROJECT */}
            <Card
              className={
                selectedPackage === 'MULTI_PROJECT'
                  ? 'border-2 border-primary shadow-sm'
                  : 'border-border'
              }
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {BUILDER_SUBSCRIPTION_PACKAGES.MULTI_PROJECT.name}
                  </CardTitle>
                  <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">
                    MULTI_PROJECT
                  </span>
                </div>
                <div className="pt-1 text-2xl font-bold text-primary">
                  ₹4,999{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    / project / month + GST (Min 2 projects = ₹9,998/mo)
                  </span>
                </div>
                <CardDescription>
                  {BUILDER_SUBSCRIPTION_PACKAGES.MULTI_PROJECT.tagline}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <ul className="space-y-1.5">
                  {BUILDER_SUBSCRIPTION_PACKAGES.MULTI_PROJECT.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                  <Label className="text-xs">
                    Subscribed Active Project Capacity (Minimum 2 slots)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={2}
                      max={200}
                      value={projectSlots}
                      onChange={(e) =>
                        setProjectSlots(Math.max(2, Number(e.target.value) || 2))
                      }
                      className="h-8 w-28 text-xs bg-background"
                    />
                    <span className="text-xs font-semibold text-foreground">
                      = {formatInr(4999 * Math.max(2, projectSlots))} / month before GST
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant={selectedPackage === 'MULTI_PROJECT' ? 'default' : 'outline'}
                  size="sm"
                  className="w-full"
                  onClick={() => setSelectedPackage('MULTI_PROJECT')}
                >
                  {selectedPackage === 'MULTI_PROJECT'
                    ? `Selected — ${Math.max(2, projectSlots)} Project Slots`
                    : 'Select Multi-Project Package'}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Optional One-Time Assisted Onboarding Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Optional One-Time Assisted Onboarding (Never Charged Unless Explicitly Selected)
              </CardTitle>
              <CardDescription className="text-xs">
                Separate one-time setup order — does not alter recurring subscription plans.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.values(OPTIONAL_ONBOARDING_SERVICES).map((svc) => (
                <button
                  key={svc.code}
                  type="button"
                  onClick={() => setOnboardingCode(svc.code)}
                  className={`rounded-lg border p-3 text-left text-xs transition cursor-pointer ${
                    onboardingCode === svc.code
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:bg-secondary/40'
                  }`}
                >
                  <div className="font-semibold text-foreground">{svc.name}</div>
                  <div className="mt-1 text-sm font-bold text-primary">
                    {svc.oneTimeFeeInr === 0
                      ? 'Free'
                      : svc.oneTimeFeeInr
                        ? `${formatInr(svc.oneTimeFeeInr)} one-time`
                        : 'Separately Quoted'}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    {svc.description}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Safe Downgrade Project Retention Selector */}
          {needsDowngradeProjectSelection && (
            <Card className="border-amber-300">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-amber-900 dark:text-amber-200">
                  Select Active Project(s) to Retain ({retainedProjectIds.length}/
                  {livePricing.subscribedProjectCapacity})
                </CardTitle>
                <CardDescription className="text-xs">
                  You currently have {activeProjects.length} active projects. Unselected projects
                  will be safely archived to read-only — zero projects, quotations, leads, or
                  historical records are deleted.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 text-xs">
                {activeProjects.map((proj) => {
                  const checked = retainedProjectIds.includes(proj.id);
                  return (
                    <label
                      key={proj.id}
                      className="flex items-center gap-2 rounded border border-border p-2.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (
                              retainedProjectIds.length <
                              livePricing.subscribedProjectCapacity
                            ) {
                              setRetainedProjectIds([...retainedProjectIds, proj.id]);
                            }
                          } else {
                            setRetainedProjectIds(
                              retainedProjectIds.filter((id) => id !== proj.id)
                            );
                          }
                        }}
                      />
                      <span>
                        <strong>{proj.name}</strong> ({proj.code}) — {proj.city}
                      </span>
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Checkout Impact Summary Bar */}
          <Card className="bg-secondary/30">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
              <div className="space-y-1">
                <div className="font-semibold text-sm text-foreground">
                  Checkout Summary — {BUILDER_SUBSCRIPTION_PACKAGES[selectedPackage].name} (
                  {livePricing.subscribedProjectCapacity} Active Project Slot(s))
                </div>
                <div className="text-muted-foreground">
                  Recurring Monthly: {formatInr(livePricing.monthlySubtotalInr)} + 18% GST (
                  {formatInr(livePricing.monthlyTaxInr)}) ={' '}
                  <strong className="text-foreground">
                    {formatInr(livePricing.monthlyTotalInr)}/month
                  </strong>
                  {onboardingTotal > 0 && (
                    <>
                      {' '}
                      • Optional Onboarding: +{formatInr(onboardingTotal)} one-time (incl. GST)
                    </>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                disabled={
                  busy ||
                  (needsDowngradeProjectSelection &&
                    retainedProjectIds.length === 0)
                }
                onClick={handleSubscriptionCheckoutOrChange}
              >
                <CreditCard className="h-4 w-4" />
                {busy ? 'Processing...' : 'Proceed with Verified Razorpay Checkout'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: PREPAID AI & WHATSAPP WALLETS */}
        <TabsContent value="wallets" className="grid gap-5 md:grid-cols-2">
          {/* AI Wallet */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                Prepaid AI Wallet
              </CardTitle>
              <CardDescription className="text-xs">
                Funds OpenAI conversational orchestration, floor-plan vision extraction, and buyer
                matching. Unused reservations are automatically released.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <div className="text-muted-foreground">Available Balance</div>
                <div className="text-2xl font-bold text-foreground">
                  {formatPaiseAsInr(aiAvailablePaise)}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Choose Top-Up Value (Excl. GST)</Label>
                <div className="flex flex-wrap gap-2">
                  {WALLET_TOPUP_PRESETS_INR.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={aiTopupInr === String(preset) ? 'default' : 'outline'}
                      onClick={() => setAiTopupInr(String(preset))}
                    >
                      ₹{preset.toLocaleString('en-IN')}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={100}
                  value={aiTopupInr}
                  onChange={(e) => setAiTopupInr(e.target.value)}
                  placeholder="Custom INR (>= 100)"
                  className="h-9 text-xs"
                />
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => handleWalletTopup('AI', aiTopupInr)}
                >
                  Top Up AI Wallet
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp Wallet */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-emerald-600" />
                Prepaid WhatsApp Wallet
              </CardTitle>
              <CardDescription className="text-xs">
                Funds chargeable Meta WhatsApp Cloud template &amp; marketing conversations. Failed
                deliveries are automatically credited back.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <div className="text-muted-foreground">Available Balance</div>
                <div className="text-2xl font-bold text-foreground">
                  {formatPaiseAsInr(waAvailablePaise)}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Choose Top-Up Value (Excl. GST)</Label>
                <div className="flex flex-wrap gap-2">
                  {WALLET_TOPUP_PRESETS_INR.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={waTopupInr === String(preset) ? 'default' : 'outline'}
                      onClick={() => setWaTopupInr(String(preset))}
                    >
                      ₹{preset.toLocaleString('en-IN')}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={100}
                  value={waTopupInr}
                  onChange={(e) => setWaTopupInr(e.target.value)}
                  placeholder="Custom INR (>= 100)"
                  className="h-9 text-xs"
                />
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => handleWalletTopup('WHATSAPP', waTopupInr)}
                >
                  Top Up WhatsApp Wallet
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: APPEND-ONLY USAGE & CREDIT LEDGER */}
        <TabsContent value="ledger">
          <DataTable
            data={ledgerEntries}
            emptyMessage="No wallet top-ups or metered AI/WhatsApp usage entries recorded yet."
            columns={[
              {
                accessorKey: 'createdAt',
                header: 'Timestamp',
                cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
              },
              { accessorKey: 'walletType', header: 'Wallet' },
              {
                accessorKey: 'entryType',
                header: 'Entry Type',
                cell: ({ row }) => <StatusBadge status={row.original.entryType} />,
              },
              {
                accessorKey: 'amountPaise',
                header: 'Amount',
                cell: ({ row }) => formatPaiseAsInr(row.original.amountPaise),
              },
              {
                accessorKey: 'balanceAfterPaise',
                header: 'Balance After',
                cell: ({ row }) => formatPaiseAsInr(row.original.balanceAfterPaise),
              },
              { accessorKey: 'summary', header: 'Details & Rate Evidence' },
            ]}
          />
        </TabsContent>

        {/* TAB 4: INVOICES, PAYMENTS & ONBOARDING ORDERS */}
        <TabsContent value="invoices" className="space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ReceiptIndianRupee className="h-4 w-4 text-primary" />
                GST Invoices ({invoices.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={invoices}
                emptyMessage="No SaaS invoices issued yet."
                columns={[
                  { accessorKey: 'invoiceNumber', header: 'Invoice #' },
                  { accessorKey: 'billingReason', header: 'Reason' },
                  {
                    accessorKey: 'subtotalInr',
                    header: 'Subtotal',
                    cell: ({ row }) => formatInr(row.original.subtotalInr),
                  },
                  {
                    accessorKey: 'gstInr',
                    header: 'GST',
                    cell: ({ row }) => formatInr(row.original.gstInr),
                  },
                  {
                    accessorKey: 'totalInr',
                    header: 'Total',
                    cell: ({ row }) => formatInr(row.original.totalInr),
                  },
                  {
                    accessorKey: 'status',
                    header: 'Status',
                    cell: ({ row }) => <StatusBadge status={row.original.status} />,
                  },
                ]}
              />
            </CardContent>
          </Card>

          {(payments.length > 0 || onboardingOrders.length > 0 || topupOrders.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Verified Razorpay Payment Attempts ({payments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={payments}
                  emptyMessage="No payment transactions yet."
                  columns={[
                    {
                      accessorKey: 'createdAt',
                      header: 'Date',
                      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
                    },
                    { accessorKey: 'paymentPurpose', header: 'Purpose' },
                    {
                      accessorKey: 'amountPaise',
                      header: 'Amount',
                      cell: ({ row }) => formatPaiseAsInr(row.original.amountPaise),
                    },
                    {
                      accessorKey: 'status',
                      header: 'Status',
                      cell: ({ row }) => <StatusBadge status={row.original.status} />,
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* TAB 5: CANCELLATION & DATA PRESERVATION */}
        <TabsContent value="cancel">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Cancel Subscription &amp; Data Preservation Policy
              </CardTitle>
              <CardDescription className="text-xs">
                Cancelling stops future recurring billing at period end. Bharat Makaan never
                deletes your projects, quotations, bookings, or customer records upon cancellation;
                your workspace transitions cleanly to read-only export mode after the paid cycle.
              </CardDescription>
            </CardHeader>
            <CardContent className="max-w-lg space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Reason for Cancellation *</Label>
                <Input
                  placeholder="e.g., Project sold out / seasonal pause"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="text-xs"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || cancelReason.trim().length < 3}
                onClick={handleCancelSubscription}
              >
                Schedule End-of-Cycle Cancellation
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
