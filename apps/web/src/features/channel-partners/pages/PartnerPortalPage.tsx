import * as React from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { Building2, Handshake, ShieldCheck, Sparkles } from 'lucide-react';
import {
  formatAreaSqft,
  formatInr,
  type LeadRegistration,
  type Organization,
  type Project,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AiAssistantDock } from '@/features/ai-assistant/components/AiAssistantDock';

export function PartnerPortalPage() {
  const { activePartnerOrg, aiDrawerOpen, setAiDrawerOpen } = useTenantStore();
  const [units, setUnits] = React.useState<Array<Record<string, any>>>([]);
  const [registrations, setRegistrations] = React.useState<LeadRegistration[]>([]);
  const [builderOrgs, setBuilderOrgs] = React.useState<Organization[]>([]);
  const [authorizedProjects, setAuthorizedProjects] = React.useState<Project[]>([]);

  const [builderOrgId, setBuilderOrgId] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [custName, setCustName] = React.useState('');
  const [custPhone, setCustPhone] = React.useState('');
  const [banner, setBanner] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!activePartnerOrg) return;
    const orgIds = activePartnerOrg.authorizedOrgIds ?? [];
    const firstOrgId = orgIds[0] ?? '';
    setBuilderOrgId(firstOrgId);

    void Promise.all(orgIds.map((oid) => getDoc(doc(db, 'organizations', oid)))).then(
      (snaps) => {
        setBuilderOrgs(
          snaps.filter((s) => s.exists()).map((s) => s.data() as Organization)
        );
      }
    );

    const uReg = onSnapshot(
      query(collection(db, 'lead_registrations'), where('partnerOrgId', '==', activePartnerOrg.id)),
      (s) => setRegistrations(s.docs.map((d) => d.data() as LeadRegistration)),
      () => setRegistrations([])
    );

    return () => uReg();
  }, [activePartnerOrg]);

  // Load authorized projects for selected builder
  React.useEffect(() => {
    if (!activePartnerOrg || !builderOrgId) {
      setAuthorizedProjects([]);
      setProjectId('');
      return;
    }
    const scopedProjectIds =
      activePartnerOrg.builderScopes?.[builderOrgId]?.projectIds ?? [];

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

  if (!activePartnerOrg) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-6">
        <PageHeader
          eyebrow="Channel Partner Network"
          title="Partner Agency Portal"
          description="Sign in with an authorized Channel Partner account to browse permitted builder inventory, register protected leads, and track commissions."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link to="/app/dashboard">Back to Enterprise Workspace</Link>
            </Button>
          }
        />
        <EmptyState
          icon={Handshake}
          title="No active Channel Partner membership found for this account."
          description="Ask a Builder Admin or Sales Manager to onboard your agency email under Channel Partners."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <PageHeader
        eyebrow={`Authorized Agency • Regulatory ID: ${activePartnerOrg.reraNumber || 'Pending'}`}
        title={`${activePartnerOrg.companyName} — Partner Portal`}
        description="View authorized multi-builder inventory, ask the scoped AI Assistant about available units, register protected leads, and monitor commissions."
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            <Button variant="outline" size="sm" asChild>
              <Link to="/app/dashboard">Switch Workspace</Link>
            </Button>
          </div>
        }
      />

      {/* Multi-Builder & Authorized Project Scope Selector */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="w-64 space-y-1">
            <Label className="text-[11px] uppercase text-muted-foreground">
              Builder / Developer
            </Label>
            <Select value={builderOrgId} onValueChange={setBuilderOrgId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select Builder" />
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
                <Input required value={custName} onChange={(e) => setCustName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Customer Phone *</Label>
                <Input required value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Lead Protection &amp; Commission Status ({registrations.length})
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
                cell: ({ row }) => new Date(row.original.protectedUntil).toLocaleDateString(),
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
  );
}
