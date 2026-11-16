import * as React from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import {
  Activity,
  Building2,
  CreditCard,
  Eye,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Plug,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  AI_BILLING_RATE_CARD_V1,
  DEFAULT_SAAS_PLANS,
  OPTIONAL_ONBOARDING_SERVICES,
  WHATSAPP_BILLING_RATE_CARD_V1,
} from '@bharat-makaan/config';
import {
  formatInr,
  type AuditEvent,
  type IntegrationConfig,
  type Organization,
  type OrganizationMember,
  type SaasPayment,
  type Subscription,
  type TenantEntitlements,
} from '@bharat-makaan/shared';
import { auth, callBackendFunction } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const ADMIN_NAV = [
  { key: 'dashboard', path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'builders', path: '/admin/builders', label: 'Builders', icon: Building2 },
  { key: 'organizations', path: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { key: 'projects', path: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { key: 'users', path: '/admin/users', label: 'Users & Staff', icon: Users },
  { key: 'subscriptions', path: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { key: 'payments', path: '/admin/payments', label: 'Payments', icon: Activity },
  { key: 'credits', path: '/admin/credits', label: 'AI & WA Credits', icon: Wallet },
  { key: 'integrations', path: '/admin/integrations', label: 'Integrations', icon: Plug },
  { key: 'audit', path: '/admin/audit', label: 'Audit Trail', icon: ScrollText },
  { key: 'settings', path: '/admin/settings', label: 'Platform Settings', icon: Settings },
] as const;

type AdminSectionKey = (typeof ADMIN_NAV)[number]['key'];

export function SuperAdminConsolePage({
  activeSection,
}: {
  activeSection?: AdminSectionKey;
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isSuperAdmin, email } = useTenantStore();

  const resolvedSection: AdminSectionKey = React.useMemo(() => {
    if (activeSection) return activeSection;
    const seg =
      location.pathname.replace(/^\/(admin|super-admin)\/?/, '').split('/')[0] || 'dashboard';
    const match = ADMIN_NAV.find((n) => n.key === seg);
    return match ? match.key : 'dashboard';
  }, [activeSection, location.pathname]);

  const [data, setData] = React.useState<{
    organizations: Organization[];
    subscriptions: Subscription[];
    entitlements: TenantEntitlements[];
    payments: SaasPayment[];
    members: OrganizationMember[];
    integrations: IntegrationConfig[];
    projectsSummary: Array<Record<string, any>>;
    projectCountsByOrg: Record<string, number>;
    supportTickets: Array<Record<string, any>>;
    recentAudits: AuditEvent[];
    systemHealth: Record<string, any>;
  } | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);

  const [inspectTarget, setInspectTarget] = React.useState<Organization | null>(null);
  const [inspectReason, setInspectReason] = React.useState('');
  const [inspectResult, setInspectResult] = React.useState<Record<string, any> | null>(null);
  const [inspectBusy, setInspectBusy] = React.useState(false);

  // Credit adjustment state
  const [creditOrgId, setCreditOrgId] = React.useState('');
  const [creditWallet, setCreditWallet] = React.useState<'AI' | 'WHATSAPP'>('AI');
  const [creditAmountInr, setCreditAmountInr] = React.useState(500);
  const [creditReason, setCreditReason] = React.useState('');
  const [creditBusy, setCreditBusy] = React.useState(false);

  const loadOverview = React.useCallback(async () => {
    try {
      const res = await callBackendFunction<Record<string, never>, any>(
        'superAdminGetPlatformOverview',
        {}
      );
      setData(res);
      if (res.organizations?.length > 0 && !creditOrgId) {
        setCreditOrgId(res.organizations[0].id);
      }
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Super Admin authorization required.');
    }
  }, [creditOrgId]);

  React.useEffect(() => {
    if (isSuperAdmin) {
      void loadOverview();
    }
  }, [isSuperAdmin, loadOverview]);

  const handleToggleSuspend = async (org: Organization) => {
    const nextStatus = org.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await callBackendFunction('superAdminUpdateTenant', {
        orgId: org.id,
        status: nextStatus,
        reason: `Super Admin set tenant status to ${nextStatus}`,
      });
      await loadOverview();
      setBanner(`Updated "${org.name}" to ${nextStatus}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to update tenant.');
    }
  };

  const handleSetMultiProjectCapacity = async (org: Organization, slots: number) => {
    try {
      await callBackendFunction('superAdminUpdateTenant', {
        orgId: org.id,
        planCode: slots <= 1 ? 'SINGLE_PROJECT' : 'MULTI_PROJECT',
        subscribedProjectCapacity: slots,
        reason: `Super Admin set subscribed project capacity to ${slots} slot(s)`,
      });
      await loadOverview();
      setBanner(
        `Updated "${org.name}" to ${slots <= 1 ? 'SINGLE_PROJECT (1 slot)' : `MULTI_PROJECT (${slots} slots)`}.`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to update subscription capacity.');
    }
  };

  const handleSyncRazorpayPlans = async () => {
    try {
      const res = await callBackendFunction<Record<string, never>, any>('syncRazorpayPlans', {});
      setBanner(
        `Razorpay plans verified (${res.mode}): SINGLE=${res.singleProjectPlanId}, MULTI=${res.multiProjectUnitPlanId}`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Razorpay plan sync failed.');
    }
  };

  const handleAdjustWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditOrgId || creditReason.trim().length < 5) return;
    setCreditBusy(true);
    try {
      await callBackendFunction('superAdminAdjustWallet', {
        orgId: creditOrgId,
        walletType: creditWallet,
        creditDeltaPaise: Math.round(Number(creditAmountInr) * 100),
        requestId: `sa_adj_${Date.now()}`,
        reason: creditReason.trim(),
      });
      setCreditReason('');
      await loadOverview();
      setBanner(`Credited ${formatInr(creditAmountInr)} to ${creditWallet} wallet (Audit logged).`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Wallet adjustment failed.');
    } finally {
      setCreditBusy(false);
    }
  };

  const handleAuditedInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectTarget || inspectReason.trim().length < 10) return;
    setInspectBusy(true);
    try {
      const res = await callBackendFunction<any, Record<string, any>>(
        'superAdminInspectOrganizationData',
        {
          orgId: inspectTarget.id,
          reason: inspectReason.trim(),
        }
      );
      setInspectResult(res);
      await loadOverview();
      setBanner(
        `Audited support inspection recorded for "${inspectTarget.name}" (Audit Trail updated).`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Audited inspection denied.');
    } finally {
      setInspectBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/login');
  };

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-14 space-y-6">
        <EmptyState
          icon={ShieldCheck}
          title="Platform Super Admin Authorization Required"
          description="Sign in with the provisioned Platform Super Admin account with enrolled MFA to access global governance."
        />
      </div>
    );
  }

  const builderOrgs = (data?.organizations ?? []).filter(
    (o) => (o.organizationType ?? 'BUILDER') === 'BUILDER'
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Dedicated Super Admin Top Bar & Navigation */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
              SA
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">
                Bharat Makaan — Super Admin Console
              </div>
              <div className="text-[11px] text-muted-foreground">
                Authenticated as {email} • MFA Enforced
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadOverview()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/builder/dashboard">Builder Console</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </div>

        <nav
          aria-label="Super Admin Navigation"
          className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 pb-2"
        >
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.key}
                to={item.path}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive || resolvedSection === item.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <PageHeader
          eyebrow="Global SaaS Governance"
          title={ADMIN_NAV.find((n) => n.key === resolvedSection)?.label ?? 'Platform Overview'}
          description="Monitor multi-builder organizations, active project entitlements, Razorpay subscriptions & payments, prepaid AI/WhatsApp wallets, and audited support access."
        />

        {banner && (
          <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
            {banner}
          </div>
        )}

        {data && (
          <>
            {resolvedSection === 'dashboard' && (
              <div className="grid gap-4 sm:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">System Health</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xl font-bold text-emerald-700">
                    {data.systemHealth.status}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">
                      Organizations / Projects
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xl font-bold">
                    {data.systemHealth.totalOrganizations} /{' '}
                    {data.systemHealth.totalProjects ?? data.projectsSummary.length}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">
                      AI Tokens Sampled
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xl font-bold">
                    {(data.systemHealth.totalAiTokensSampled ?? 0).toLocaleString('en-IN')}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">
                      Verified Payments
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xl font-bold">
                    {data.payments?.length ?? 0}
                  </CardContent>
                </Card>
              </div>
            )}

            {(resolvedSection === 'dashboard' ||
              resolvedSection === 'builders' ||
              resolvedSection === 'organizations') && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {resolvedSection === 'builders'
                      ? `Registered Builders (${builderOrgs.length})`
                      : `All Registered Organizations (${data.organizations.length})`}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    data={resolvedSection === 'builders' ? builderOrgs : data.organizations}
                    emptyMessage="No organizations provisioned yet."
                    columns={[
                      { accessorKey: 'name', header: 'Organization Name' },
                      {
                        accessorKey: 'organizationType',
                        header: 'Type',
                        cell: ({ row }) => row.original.organizationType ?? 'BUILDER',
                      },
                      { accessorKey: 'headquartersCity', header: 'HQ City' },
                      { accessorKey: 'subscriptionPlanId', header: 'Package' },
                      {
                        id: 'activeProjects',
                        header: 'Active Projects',
                        cell: ({ row }) => data.projectCountsByOrg?.[row.original.id] ?? 0,
                      },
                      {
                        accessorKey: 'status',
                        header: 'Status',
                        cell: ({ row }) => <StatusBadge status={row.original.status} />,
                      },
                      {
                        id: 'actions',
                        header: 'Governance & Audited Access',
                        cell: ({ row }) => (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setInspectTarget(row.original);
                                setInspectReason('');
                                setInspectResult(null);
                              }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Audited Inspect
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSetMultiProjectCapacity(row.original, 5)}
                            >
                              Set 5 Slots
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleSuspend(row.original)}
                            >
                              {row.original.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                            </Button>
                          </div>
                        ),
                      },
                    ]}
                  />
                </CardContent>
              </Card>
            )}

            {resolvedSection === 'projects' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Platform Projects Inventory ({data.projectsSummary.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    data={data.projectsSummary}
                    emptyMessage="No projects registered across organizations."
                    columns={[
                      { accessorKey: 'name', header: 'Project' },
                      { accessorKey: 'builderName', header: 'Builder' },
                      { accessorKey: 'city', header: 'City' },
                      { accessorKey: 'projectType', header: 'Type' },
                      { accessorKey: 'totalUnits', header: 'Units' },
                      {
                        accessorKey: 'lifecycleStatus',
                        header: 'Lifecycle',
                        cell: ({ row }) => <StatusBadge status={row.original.lifecycleStatus} />,
                      },
                    ]}
                  />
                </CardContent>
              </Card>
            )}

            {resolvedSection === 'users' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Organization Memberships &amp; Staff ({data.members?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    data={data.members ?? []}
                    emptyMessage="No staff memberships created yet."
                    columns={[
                      { accessorKey: 'email', header: 'Email' },
                      { accessorKey: 'displayName', header: 'Name' },
                      { accessorKey: 'orgId', header: 'Org ID' },
                      { accessorKey: 'role', header: 'Role' },
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

            {resolvedSection === 'subscriptions' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold">Strictly Two Builder SaaS Packages</h2>
                  <Button size="sm" variant="outline" onClick={handleSyncRazorpayPlans}>
                    Sync Razorpay Plans
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {Object.values(DEFAULT_SAAS_PLANS).map((plan) => (
                    <Card key={plan.code}>
                      <CardHeader>
                        <CardTitle className="text-sm">{plan.name}</CardTitle>
                        <div className="text-lg font-bold text-primary">
                          {plan.code === 'SINGLE_PROJECT'
                            ? `${formatInr(plan.monthlyPriceInr)} / month + GST`
                            : `${formatInr(plan.perProjectMonthlyInr)} / project / month + GST (min 2 = ₹9,998)`}
                        </div>
                        <CardDescription>{plan.tagline}</CardDescription>
                      </CardHeader>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Tenant Subscriptions ({data.subscriptions.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      data={data.subscriptions}
                      emptyMessage="No subscriptions recorded."
                      columns={[
                        { accessorKey: 'orgId', header: 'Org ID' },
                        { accessorKey: 'planCode', header: 'Package' },
                        { accessorKey: 'subscribedProjectCapacity', header: 'Project Slots' },
                        {
                          accessorKey: 'basePriceInr',
                          header: 'Base Monthly',
                          cell: ({ row }) => formatInr(row.original.basePriceInr ?? 5999),
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
              </div>
            )}

            {resolvedSection === 'payments' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Razorpay Verified Payments &amp; Failures ({data.payments?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    data={data.payments ?? []}
                    emptyMessage="No Razorpay payment events recorded yet."
                    columns={[
                      { accessorKey: 'orgId', header: 'Org ID' },
                      { accessorKey: 'paymentPurpose', header: 'Purpose' },
                      {
                        accessorKey: 'amountPaise',
                        header: 'Amount',
                        cell: ({ row }) => formatInr((row.original.amountPaise ?? 0) / 100),
                      },
                      { accessorKey: 'razorpayPaymentId', header: 'Razorpay Payment ID' },
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

            {resolvedSection === 'credits' && (
              <div className="grid gap-6 lg:grid-cols-12">
                <Card className="lg:col-span-5">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Audited Wallet Credit / Refund Adjustment
                    </CardTitle>
                    <CardDescription>
                      Adjust AI or WhatsApp prepaid wallet balances with an immutable ledger entry.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleAdjustWallet} className="space-y-3">
                      <div className="space-y-1">
                        <Label>Target Organization</Label>
                        <Select value={creditOrgId} onValueChange={setCreditOrgId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Organization" />
                          </SelectTrigger>
                          <SelectContent>
                            {data.organizations.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.name} ({o.id})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label>Wallet</Label>
                          <Select
                            value={creditWallet}
                            onValueChange={(v) => setCreditWallet(v as 'AI' | 'WHATSAPP')}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AI">AI Wallet</SelectItem>
                              <SelectItem value="WHATSAPP">WhatsApp Wallet</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Delta Amount (INR)</Label>
                          <Input
                            type="number"
                            value={creditAmountInr}
                            onChange={(e) => setCreditAmountInr(Number(e.target.value))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>Audit Justification *</Label>
                        <Input
                          required
                          minLength={5}
                          placeholder="e.g., Invoice #INV-2026 offline wire settlement"
                          value={creditReason}
                          onChange={(e) => setCreditReason(e.target.value)}
                        />
                      </div>
                      <Button type="submit" size="sm" className="w-full" disabled={creditBusy}>
                        {creditBusy ? 'Applying Ledger Entry...' : 'Record Audited Wallet Adjustment'}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-7">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Tenant Prepaid Wallet Entitlements ({data.entitlements?.length ?? 0})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      data={data.entitlements ?? []}
                      emptyMessage="No tenant entitlements provisioned yet."
                      columns={[
                        { accessorKey: 'orgId', header: 'Org ID' },
                        { accessorKey: 'packageCode', header: 'Package' },
                        { accessorKey: 'subscribedProjectCapacity', header: 'Slots' },
                        {
                          accessorKey: 'aiBalancePaise',
                          header: 'AI Wallet',
                          cell: ({ row }) => formatInr((row.original.aiBalancePaise ?? 0) / 100),
                        },
                        {
                          accessorKey: 'whatsappBalancePaise',
                          header: 'WA Wallet',
                          cell: ({ row }) =>
                            formatInr((row.original.whatsappBalancePaise ?? 0) / 100),
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {resolvedSection === 'integrations' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Connected Provider Integrations ({data.integrations?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    data={data.integrations ?? []}
                    emptyMessage="No tenant integration configurations stored yet."
                    columns={[
                      { accessorKey: 'orgId', header: 'Org ID' },
                      { accessorKey: 'provider', header: 'Provider' },
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

            {resolvedSection === 'audit' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Global Immutable Audit Trail ({data.recentAudits.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    data={data.recentAudits}
                    emptyMessage="No audit records yet."
                    columns={[
                      {
                        accessorKey: 'createdAt',
                        header: 'Timestamp',
                        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
                      },
                      { accessorKey: 'orgId', header: 'Tenant' },
                      { accessorKey: 'category', header: 'Category' },
                      { accessorKey: 'action', header: 'Action' },
                      { accessorKey: 'summary', header: 'Summary' },
                    ]}
                  />
                </CardContent>
              </Card>
            )}

            {resolvedSection === 'settings' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      OpenAI Rate Card ({AI_BILLING_RATE_CARD_V1.version})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-1.5">
                    {Object.entries(AI_BILLING_RATE_CARD_V1.models).map(([model, r]) => (
                      <div key={model} className="flex justify-between">
                        <span className="font-mono">{model}</span>
                        <span>
                          In: {r.inputPer1MUsd} USD/1M • Out: {r.outputPer1MUsd} USD/1M
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Meta WhatsApp Rate Card ({WHATSAPP_BILLING_RATE_CARD_V1.version})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-1.5">
                    {Object.entries(WHATSAPP_BILLING_RATE_CARD_V1.markets).map(([mkt, cats]) => (
                      <div key={mkt} className="flex justify-between">
                        <span className="font-mono font-semibold">{mkt}</span>
                        <span>
                          Mktg: {formatInr(cats.MARKETING / 100)} • Util:{' '}
                          {formatInr(cats.UTILITY / 100)}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-sm">Optional Assisted Onboarding Services</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-4 text-xs">
                    {Object.values(OPTIONAL_ONBOARDING_SERVICES).map((svc) => (
                      <div key={svc.code} className="rounded border border-border p-3">
                        <div className="font-semibold">{svc.name}</div>
                        <div className="text-primary font-bold mt-1">
                          {svc.oneTimeFeeInr === null
                            ? 'Custom Quote'
                            : formatInr(svc.oneTimeFeeInr)}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}

        {/* Audited Tenant Support Inspection Dialog */}
        <Dialog
          open={Boolean(inspectTarget)}
          onOpenChange={(o) => {
            if (!o) {
              setInspectTarget(null);
              setInspectResult(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Audited Tenant Inspection — {inspectTarget?.name}</DialogTitle>
              <DialogDescription>
                Customer-sensitive tenant records are strictly isolated. Entering a support
                justification logs an immutable `SUPER_ADMIN_SENSITIVE_DATA_ACCESS` audit record.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAuditedInspect} className="space-y-3">
              <div className="space-y-1">
                <Label>Support Ticket / Audit Justification (Min 10 characters) *</Label>
                <Input
                  required
                  minLength={10}
                  placeholder="e.g., Support Ticket #1042 — Verify project quota and inventory sync"
                  value={inspectReason}
                  onChange={(e) => setInspectReason(e.target.value)}
                />
              </div>

              {inspectResult && (
                <div className="rounded-lg border border-border bg-secondary/50 p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-foreground">
                    Operational Summary (PII Masked)
                  </div>
                  <div>Projects Registered: {inspectResult.projects?.length ?? 0}</div>
                  <div>Active Staff Members: {inspectResult.activeMembersCount ?? 0}</div>
                  <div>Total Units: {inspectResult.operationalCounts?.unitsCount ?? 0}</div>
                  <div>Total Leads: {inspectResult.operationalCounts?.leadsCount ?? 0}</div>
                  <div>Total Bookings: {inspectResult.operationalCounts?.bookingsCount ?? 0}</div>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="submit"
                  size="sm"
                  disabled={inspectBusy || inspectReason.trim().length < 10}
                >
                  {inspectBusy ? 'Logging Audit & Inspecting...' : 'Authorize & Inspect Summary'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
