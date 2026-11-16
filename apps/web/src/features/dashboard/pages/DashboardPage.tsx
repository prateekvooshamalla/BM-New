import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2, Clock, FolderPlus, IndianRupee, Users } from 'lucide-react';
import {
  formatInrCompact,
  type Booking,
  type Lead,
  type SiteVisit,
  type Unit,
} from '@bharat-makaan/shared';
import { subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CreateOrganizationDialog } from '@/features/organizations/components/CreateOrganizationDialog';

export function DashboardPage() {
  const navigate = useNavigate();
  const [createOrgOpen, setCreateOrgOpen] = React.useState(false);
  const { activeOrgId, activeOrganization, projects, activeProject, activeProjectId } =
    useTenantStore();

  const [liveUnits, setLiveUnits] = React.useState<Unit[]>([]);
  const [liveLeads, setLiveLeads] = React.useState<Lead[]>([]);
  const [liveVisits, setLiveVisits] = React.useState<SiteVisit[]>([]);
  const [liveBookings, setLiveBookings] = React.useState<Booking[]>([]);

  React.useEffect(() => {
    if (!activeOrgId) {
      setLiveUnits([]);
      setLiveLeads([]);
      setLiveVisits([]);
      setLiveBookings([]);
      return;
    }

    const subs = [
      subscribeTenantCollection<Unit>({
        orgId: activeOrgId,
        collectionName: 'units',
        onData: setLiveUnits,
      }),
      subscribeTenantCollection<Lead>({
        orgId: activeOrgId,
        collectionName: 'leads',
        onData: setLiveLeads,
      }),
      subscribeTenantCollection<SiteVisit>({
        orgId: activeOrgId,
        collectionName: 'site_visits',
        onData: setLiveVisits,
      }),
      subscribeTenantCollection<Booking>({
        orgId: activeOrgId,
        collectionName: 'bookings',
        onData: setLiveBookings,
      }),
    ];

    return () => subs.forEach((u) => u());
  }, [activeOrgId]);

  // Compute live database-driven totals (strictly zero dummy/fabricated figures)
  const scopedProjects = activeProject ? [activeProject] : projects;
  const scopedProjectIds = React.useMemo(
    () => new Set(scopedProjects.map((p) => p.id)),
    [scopedProjects]
  );

  const totals = React.useMemo(() => {
    const statTotals = scopedProjects.reduce(
      (acc, p) => {
        acc.totalUnits += p.stats?.totalUnits ?? 0;
        acc.availableUnits += p.stats?.availableUnits ?? 0;
        acc.onHoldUnits += p.stats?.onHoldUnits ?? 0;
        acc.reservedUnits += p.stats?.reservedUnits ?? 0;
        acc.bookedUnits += p.stats?.bookedUnits ?? 0;
        acc.registeredUnits += p.stats?.registeredUnits ?? 0;
        acc.totalLeads += p.stats?.totalLeads ?? 0;
        acc.totalSiteVisits += p.stats?.totalSiteVisits ?? 0;
        acc.bookedSalesValueInr += p.stats?.bookedSalesValueInr ?? 0;
        acc.collectionsVerifiedInr += p.stats?.collectionsVerifiedInr ?? 0;
        acc.pendingTasksCount += p.stats?.pendingTasksCount ?? 0;
        return acc;
      },
      {
        totalUnits: 0,
        availableUnits: 0,
        onHoldUnits: 0,
        reservedUnits: 0,
        bookedUnits: 0,
        registeredUnits: 0,
        totalLeads: 0,
        totalSiteVisits: 0,
        bookedSalesValueInr: 0,
        collectionsVerifiedInr: 0,
        pendingTasksCount: 0,
      }
    );

    const unitsInScope = activeProjectId
      ? liveUnits.filter((u) => u.projectId === activeProjectId)
      : liveUnits.filter((u) => scopedProjectIds.size === 0 || scopedProjectIds.has(u.projectId));

    const leadsInScope = activeProjectId
      ? liveLeads.filter(
          (l) =>
            l.projectId === activeProjectId ||
            (l.preferredProjectIds ?? []).includes(activeProjectId)
        )
      : liveLeads;

    const visitsInScope = activeProjectId
      ? liveVisits.filter((v) => v.projectId === activeProjectId)
      : liveVisits;

    const bookingsInScope = activeProjectId
      ? liveBookings.filter((b) => b.projectId === activeProjectId)
      : liveBookings;

    const activeBookings = bookingsInScope.filter((b) => b.status !== 'CANCELLED');

    return {
      totalUnits: Math.max(statTotals.totalUnits, unitsInScope.length),
      availableUnits:
        unitsInScope.length > 0
          ? unitsInScope.filter((u) => u.status === 'AVAILABLE').length
          : statTotals.availableUnits,
      onHoldUnits:
        unitsInScope.length > 0
          ? unitsInScope.filter((u) => u.status === 'ON_HOLD').length
          : statTotals.onHoldUnits,
      reservedUnits:
        unitsInScope.length > 0
          ? unitsInScope.filter((u) => u.status === 'RESERVED').length
          : statTotals.reservedUnits,
      bookedUnits:
        unitsInScope.length > 0
          ? unitsInScope.filter((u) => u.status === 'BOOKED' || u.status === 'AGREEMENT').length
          : statTotals.bookedUnits,
      registeredUnits:
        unitsInScope.length > 0
          ? unitsInScope.filter((u) => u.status === 'REGISTERED').length
          : statTotals.registeredUnits,
      totalLeads: Math.max(statTotals.totalLeads, leadsInScope.length),
      totalSiteVisits: Math.max(statTotals.totalSiteVisits, visitsInScope.length),
      bookedSalesValueInr: Math.max(
        statTotals.bookedSalesValueInr,
        activeBookings.reduce((s, b) => s + (b.totalPayableInr ?? 0), 0)
      ),
      collectionsVerifiedInr: Math.max(
        statTotals.collectionsVerifiedInr,
        activeBookings.reduce((s, b) => s + (b.totalCollectedVerifiedInr ?? 0), 0)
      ),
      pendingTasksCount: statTotals.pendingTasksCount,
    };
  }, [
    activeProjectId,
    liveBookings,
    liveLeads,
    liveUnits,
    liveVisits,
    scopedProjectIds,
    scopedProjects,
  ]);

  if (!activeOrgId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Enterprise Workspace"
          title="Welcome to Bharat Makaan"
          description="Provision your builder organization to start managing projects, visual inventory, dynamic pricing, CRM, and bookings."
        />
        <EmptyState
          icon={Building2}
          title="No builder organization selected."
          description="Create your organization workspace to isolate your projects, employees, inventory, price books, and financial records."
          actionLabel="Create Builder Organization"
          onAction={() => setCreateOrgOpen(true)}
        />
        <CreateOrganizationDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={activeOrganization?.name}
          title="Executive Dashboard"
          description="Real-time operational metrics across inventory, sales, site visits, and collections."
          actions={
            <Button size="sm" onClick={() => navigate('/builder/inventory')}>
              <FolderPlus className="h-4 w-4" />
              Create First Project
            </Button>
          }
        />
        <EmptyState
          icon={Building2}
          title="No projects yet. Create your first project."
          description="Set up your project hierarchy (Phases, Towers, Floors, and Units or Plots) to unlock live inventory, dynamic pricing, and CRM metrics."
          actionLabel="Go to Projects & Inventory"
          onAction={() => navigate('/builder/inventory')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={activeOrganization?.name}
        title={activeProject ? `${activeProject.name} — Dashboard` : 'Portfolio Dashboard'}
        description="Live database-driven inventory, pipeline, and collection metrics."
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/builder/inventory')}>
            Manage Inventory
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Available / Total Units
            </CardTitle>
            <Building2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totals.availableUnits} / {totals.totalUnits}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.onHoldUnits} on hold • {totals.reservedUnits} reserved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Booked &amp; Registered
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totals.bookedUnits + totals.registeredUnits}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.bookedUnits} booked • {totals.registeredUnits} registered
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Sales Value &amp; Collections
            </CardTitle>
            <IndianRupee className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatInrCompact(totals.bookedSalesValueInr)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Verified collected: {formatInrCompact(totals.collectionsVerifiedInr)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Leads, Visits &amp; Tasks
            </CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.totalLeads}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.totalSiteVisits} site visits • {totals.pendingTasksCount} pending tasks
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Active Projects ({scopedProjects.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scopedProjects.map((project) => {
              const projUnits = liveUnits.filter((u) => u.projectId === project.id);
              const projAvail =
                projUnits.length > 0
                  ? projUnits.filter((u) => u.status === 'AVAILABLE').length
                  : (project.stats?.availableUnits ?? 0);
              const projTotal = Math.max(project.stats?.totalUnits ?? 0, projUnits.length);

              return (
                <button
                  type="button"
                  key={project.id}
                  onClick={() => navigate(`/builder/projects/${project.id}`)}
                  className="flex flex-col justify-between rounded-lg border border-border p-4 text-left hover:bg-secondary/40 transition-colors cursor-pointer"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">{project.name}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {project.code}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {project.locality}, {project.city} • RERA: {project.reraNumber}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs w-full">
                    <span>
                      <Clock className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
                      {project.constructionStatus.replace(/_/g, ' ')}
                    </span>
                    <span className="font-medium text-primary">
                      {projAvail}/{projTotal} Available
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
