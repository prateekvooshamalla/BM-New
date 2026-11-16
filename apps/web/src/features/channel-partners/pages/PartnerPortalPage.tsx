import * as React from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import {
  Building2,
  CalendarClock,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  ReceiptIndianRupee,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  formatAreaSqft,
  formatInr,
  type LeadRegistration,
  type Organization,
  type Project,
  type Quotation,
  type SiteVisit,
} from '@bharat-makaan/shared';
import { auth, callBackendFunction, db } from '@/lib/firebase';
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
import { AiAssistantDock } from '@/features/ai-assistant/components/AiAssistantDock';
import { WorkspaceViewSwitcher } from '@/components/layout/WorkspaceViewSwitcher';

const PARTNER_NAV = [
  { key: 'dashboard', path: '/partner/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'builders', path: '/partner/builders', label: 'Builders', icon: Building2 },
  { key: 'projects', path: '/partner/projects', label: 'Projects', icon: Handshake },
  { key: 'inventory', path: '/partner/inventory', label: 'Inventory', icon: Building2 },
  { key: 'leads', path: '/partner/leads', label: 'Protected Leads', icon: Users },
  { key: 'visits', path: '/partner/visits', label: 'Site Visits', icon: CalendarClock },
  { key: 'quotations', path: '/partner/quotations', label: 'Quotations', icon: FileText },
  { key: 'commissions', path: '/partner/commissions', label: 'Commissions', icon: ReceiptIndianRupee },
  { key: 'profile', path: '/partner/profile', label: 'Agency Profile', icon: UserCheck },
] as const;

type PartnerSectionKey = (typeof PARTNER_NAV)[number]['key'];

export function PartnerPortalPage({
  activeSection,
}: {
  activeSection?: PartnerSectionKey;
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activePartnerOrg,
    partnerMemberships,
    email,
    aiDrawerOpen,
    setAiDrawerOpen,
  } = useTenantStore();

  const resolvedSection: PartnerSectionKey = React.useMemo(() => {
    if (activeSection) return activeSection;
    const seg = location.pathname.replace(/^\/partner\/?/, '').split('/')[0] || 'dashboard';
    const match = PARTNER_NAV.find((n) => n.key === seg);
    return match ? match.key : 'dashboard';
  }, [activeSection, location.pathname]);

  const [units, setUnits] = React.useState<Array<Record<string, any>>>([]);
  const [registrations, setRegistrations] = React.useState<LeadRegistration[]>([]);
  const [partnerVisits, setPartnerVisits] = React.useState<SiteVisit[]>([]);
  const [partnerQuotations, setPartnerQuotations] = React.useState<Quotation[]>([]);
  const [builderOrgs, setBuilderOrgs] = React.useState<Organization[]>([]);
  const [authorizedProjects, setAuthorizedProjects] = React.useState<Project[]>([]);

  const [builderOrgId, setBuilderOrgId] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [custName, setCustName] = React.useState('');
  const [custPhone, setCustPhone] = React.useState('');
  const [banner, setBanner] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!activePartnerOrg) return;
    const authorizedOrgIds = (activePartnerOrg.authorizedOrgIds ?? []).filter((oid) => {
      const scope = activePartnerOrg.builderScopes?.[oid];
      return !scope || scope.status === 'AUTHORIZED';
    });
    const firstOrgId = authorizedOrgIds[0] ?? '';
    setBuilderOrgId(firstOrgId);

    void Promise.all(
      authorizedOrgIds.map((oid) => getDoc(doc(db, 'organizations', oid)))
    ).then((snaps) => {
      setBuilderOrgs(snaps.filter((s) => s.exists()).map((s) => s.data() as Organization));
    });

    const uReg = onSnapshot(
      query(collection(db, 'lead_registrations'), where('partnerOrgId', '==', activePartnerOrg.id)),
      (s) => setRegistrations(s.docs.map((d) => d.data() as LeadRegistration)),
      () => setRegistrations([])
    );

    const uVis = onSnapshot(
      query(collection(db, 'site_visits'), where('partnerOrgId', '==', activePartnerOrg.id)),
      (s) => setPartnerVisits(s.docs.map((d) => d.data() as SiteVisit)),
      () => setPartnerVisits([])
    );

    const uQt = onSnapshot(
      query(collection(db, 'quotations'), where('partnerOrgId', '==', activePartnerOrg.id)),
      (s) => setPartnerQuotations(s.docs.map((d) => d.data() as Quotation)),
      () => setPartnerQuotations([])
    );

    return () => {
      uReg();
      uVis();
      uQt();
    };
  }, [activePartnerOrg]);

  // Load authorized projects for selected builder
  React.useEffect(() => {
    if (!activePartnerOrg || !builderOrgId) {
      setAuthorizedProjects([]);
      setProjectId('');
      return;
    }
    const scope = activePartnerOrg.builderScopes?.[builderOrgId];
    if (scope && scope.status !== 'AUTHORIZED') {
      setAuthorizedProjects([]);
      setProjectId('');
      return;
    }
    const scopedProjectIds = scope?.projectIds ?? [];

    if (scopedProjectIds.length === 0) {
      setAuthorizedProjects([]);
      setProjectId('');
      return;
    }

    void Promise.all(scopedProjectIds.map((pid) => getDoc(doc(db, 'projects', pid)))).then(
      (snaps) => {
        const list = snaps.filter((s) => s.exists()).map((s) => s.data() as Project);
        setAuthorizedProjects(list);
        setProjectId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? '')
        );
      }
    );
  }, [activePartnerOrg, builderOrgId]);

  // Fetch sanitized partner-permitted inventory via backend service
  React.useEffect(() => {
    if (!activePartnerOrg || !builderOrgId || !projectId) {
      setUnits([]);
      return;
    }

    let cancelled = false;
    callBackendFunction<any, { units: Array<Record<string, any>> }>(
      'listPartnerAuthorizedInventory',
      {
        orgId: builderOrgId,
        projectId,
        partnerOrgId: activePartnerOrg.id,
      }
    )
      .then((res) => {
        if (!cancelled) setUnits(res.units ?? []);
      })
      .catch(() => {
        if (!cancelled) setUnits([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activePartnerOrg, builderOrgId, projectId]);

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePartnerOrg || !builderOrgId || !projectId) return;
    try {
      const res = await callBackendFunction<any, { conflictDetected: boolean }>(
        'registerPartnerLead',
        {
          orgId: builderOrgId,
          projectId,
          partnerOrgId: activePartnerOrg.id,
          customerName: custName,
          phone: custPhone,
        }
      );
      setCustName('');
      setCustPhone('');
      setBanner(
        res.conflictDetected
          ? 'Duplicate registration flagged for builder review.'
          : 'Customer lead registered with active protection window.'
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Registration failed.');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/login');
  };

  if (!activePartnerOrg) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-6">
        <PageHeader
          eyebrow="Channel Partner Network"
          title="Partner Agency Portal"
          description="Sign in with an authorized Channel Partner account to browse permitted builder inventory, register protected leads, and track commissions."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link to="/">Return to Property Portal</Link>
            </Button>
          }
        />
        <EmptyState
          icon={Handshake}
          title="No active Channel Partner membership found for this account."
          description="Channel partners require an explicit builder invitation and approved project scope before accessing builder inventory."
        />
      </div>
    );
  }

  const allBuilderScopeEntries = Object.entries(activePartnerOrg.builderScopes ?? {});

  return (
    <div className="min-h-screen bg-background">
      {/* Dedicated Partner Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
              CP
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">
                {activePartnerOrg.companyName}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Channel Partner Console • RERA: {activePartnerOrg.reraNumber || 'Pending'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceViewSwitcher />
            {builderOrgId && (
              <Button
                type="button"
                variant={aiDrawerOpen ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAiDrawerOpen(!aiDrawerOpen)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI Assistant
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </div>

        <nav
          aria-label="Channel Partner Navigation"
          className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 pb-2"
        >
          {PARTNER_NAV.map((item) => {
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
          eyebrow={`Channel Partner • ${email ?? ''}`}
          title={PARTNER_NAV.find((n) => n.key === resolvedSection)?.label ?? 'Partner Dashboard'}
          description="Strictly scoped to builder-approved projects. Internal builder price books and private customer ledgers remain isolated."
        />

        {/* Multi-Builder & Authorized Project Scope Selector */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="w-64 space-y-1">
              <Label className="text-[11px] uppercase text-muted-foreground">
                Authorized Builder
              </Label>
              <Select value={builderOrgId} onValueChange={setBuilderOrgId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="No Approved Builder Yet" />
                </SelectTrigger>
                <SelectContent>
                  {builderOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} ({org.headquartersCity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-64 space-y-1">
              <Label className="text-[11px] uppercase text-muted-foreground">
                Authorized Project
              </Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select Authorized Project" />
                </SelectTrigger>
                <SelectContent>
                  {authorizedProjects.map((proj) => (
                    <SelectItem key={proj.id} value={proj.id}>
                      {proj.name} ({proj.code}) — {proj.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {banner && (
          <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
            {banner}
          </div>
        )}

        {/* Section Views */}
        {(resolvedSection === 'dashboard' || resolvedSection === 'commissions') && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">Protected Leads</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {activePartnerOrg.metrics.registeredLeadsCount}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">Converted Bookings</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {activePartnerOrg.metrics.bookingsCount}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">Commission Eligible</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold text-emerald-700">
                {formatInr(activePartnerOrg.metrics.eligibleCommissionInr)}
              </CardContent>
            </Card>
          </div>
        )}

        {resolvedSection === 'builders' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Builder Authorization Scopes</CardTitle>
              <CardDescription>
                Pending builder invitations remain locked until a Builder Admin approves project
                access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {allBuilderScopeEntries.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No builder authorizations yet."
                  description="Once a builder invites and approves your agency, their authorized projects appear here."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {allBuilderScopeEntries.map(([bOrgId, scope]) => {
                    const bOrg = builderOrgs.find((o) => o.id === bOrgId);
                    return (
                      <div
                        key={bOrgId}
                        className="rounded-lg border border-border p-4 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">
                            {bOrg ? bOrg.name : `Builder ${bOrgId}`}
                          </span>
                          <StatusBadge status={scope.status} />
                        </div>
                        <div className="text-muted-foreground">
                          Authorized Projects: {scope.projectIds.length} • Commission:{' '}
                          {scope.commissionPct}% ({scope.commissionTerms})
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {resolvedSection === 'projects' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Authorized Projects ({authorizedProjects.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={authorizedProjects}
                emptyMessage="No authorized projects available for the selected builder."
                columns={[
                  { accessorKey: 'name', header: 'Project Name' },
                  { accessorKey: 'code', header: 'Code' },
                  { accessorKey: 'city', header: 'City' },
                  { accessorKey: 'reraNumber', header: 'RERA Registration' },
                  {
                    accessorKey: 'constructionStatus',
                    header: 'Construction Status',
                    cell: ({ row }) => <StatusBadge status={row.original.constructionStatus} />,
                  },
                ]}
              />
            </CardContent>
          </Card>
        )}

        {(resolvedSection === 'dashboard' || resolvedSection === 'inventory') && (
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Register Customer Lead
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmitRegistration} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Customer Name *</Label>
                    <Input
                      required
                      value={custName}
                      onChange={(e) => setCustName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Customer Phone *</Label>
                    <Input
                      required
                      value={custPhone}
                      onChange={(e) => setCustPhone(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" size="sm" disabled={!projectId}>
                    Register Protected Lead
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Permitted Project Inventory ({units.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={units}
                  searchPlaceholder="Search unit or BHK..."
                  emptyMessage="No units found for selected authorized project."
                  columns={[
                    { accessorKey: 'unitNumber', header: 'Unit #' },
                    { accessorKey: 'bhk', header: 'BHK' },
                    {
                      accessorKey: 'saleableAreaSqft',
                      header: 'Area',
                      cell: ({ row }) => formatAreaSqft(row.original.saleableAreaSqft ?? 0),
                    },
                    {
                      accessorKey: 'calculatedTotalPrice',
                      header: 'Indicative Price',
                      cell: ({ row }) =>
                        row.original.calculatedTotalPrice !== undefined
                          ? formatInr(row.original.calculatedTotalPrice)
                          : 'Hidden by Builder',
                    },
                    {
                      accessorKey: 'status',
                      header: 'Availability',
                      cell: ({ row }) => <StatusBadge status={row.original.status} />,
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {(resolvedSection === 'dashboard' ||
          resolvedSection === 'leads' ||
          resolvedSection === 'commissions') && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Lead Protection &amp; Attribution Status ({registrations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={registrations}
                emptyMessage="No leads registered yet."
                columns={[
                  { accessorKey: 'customerName', header: 'Customer' },
                  { accessorKey: 'normalizedPhone', header: 'Phone' },
                  {
                    accessorKey: 'protectedUntil',
                    header: 'Protection Expiry',
                    cell: ({ row }) =>
                      new Date(row.original.protectedUntil).toLocaleDateString(),
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

        {resolvedSection === 'visits' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Attributed Customer Site Visits ({partnerVisits.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={partnerVisits}
                emptyMessage="No partner-attributed site visits scheduled yet."
                columns={[
                  { accessorKey: 'customerName', header: 'Customer' },
                  {
                    accessorKey: 'scheduledStartAt',
                    header: 'Scheduled At',
                    cell: ({ row }) =>
                      new Date(row.original.scheduledStartAt).toLocaleString(),
                  },
                  {
                    accessorKey: 'status',
                    header: 'Visit Status',
                    cell: ({ row }) => <StatusBadge status={row.original.status} />,
                  },
                ]}
              />
            </CardContent>
          </Card>
        )}

        {resolvedSection === 'quotations' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Shared Customer Quotations ({partnerQuotations.length})
              </CardTitle>
              <CardDescription>
                Partner accounts can view builder-issued quotations attributed to their agency
                without modifying pricing formulas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                data={partnerQuotations}
                emptyMessage="No quotations attributed to your agency yet."
                columns={[
                  { accessorKey: 'quotationNumber', header: 'Quotation #' },
                  { accessorKey: 'unitNumber', header: 'Unit #' },
                  {
                    id: 'customer',
                    header: 'Customer',
                    cell: ({ row }) => row.original.customer?.name ?? '—',
                  },
                  {
                    accessorKey: 'totalPayableInr',
                    header: 'Total Payable',
                    cell: ({ row }) => formatInr(row.original.totalPayableInr),
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

        {resolvedSection === 'profile' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Partner Agency Identity &amp; Team</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 text-xs">
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="text-muted-foreground">Registered Agency Name</div>
                <div className="font-semibold text-sm">{activePartnerOrg.companyName}</div>
              </div>
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="text-muted-foreground">Agent / Agency RERA ID</div>
                <div className="font-mono font-semibold text-sm">
                  {activePartnerOrg.reraNumber || 'Pending Verification'}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="text-muted-foreground">Commission Slab (Selected Builder)</div>
                <div className="font-semibold text-sm">
                  {builderOrgId && activePartnerOrg.builderScopes?.[builderOrgId]
                    ? `${activePartnerOrg.builderScopes[builderOrgId]!.commissionPct}%`
                    : 'Scoped per Builder'}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="text-muted-foreground">Your Partner Role</div>
                <div className="font-semibold text-sm">
                  {partnerMemberships[0]?.role ?? 'PARTNER_ADMIN'}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {builderOrgId && (
          <AiAssistantDock
            partnerContext={{
              partnerOrgId: activePartnerOrg.id,
              builderOrgId,
              projectId: projectId || null,
            }}
          />
        )}
      </div>
    </div>
  );
}
