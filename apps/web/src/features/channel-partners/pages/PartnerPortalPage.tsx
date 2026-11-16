import * as React from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Building2, Handshake, ShieldCheck } from 'lucide-react';
import {
  formatAreaSqft,
  formatInr,
  type LeadRegistration,
  type Unit,
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

export function PartnerPortalPage() {
  const { activePartnerOrg } = useTenantStore();
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [registrations, setRegistrations] = React.useState<LeadRegistration[]>([]);

  const [builderOrgId, setBuilderOrgId] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [custName, setCustName] = React.useState('');
  const [custPhone, setCustPhone] = React.useState('');
  const [banner, setBanner] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!activePartnerOrg) return;
    const firstOrgId = activePartnerOrg.authorizedOrgIds[0] ?? '';
    setBuilderOrgId(firstOrgId);
    const firstProj = activePartnerOrg.builderScopes?.[firstOrgId]?.projectIds[0] ?? '';
    setProjectId(firstProj);

    const uReg = onSnapshot(
      query(collection(db, 'lead_registrations'), where('partnerOrgId', '==', activePartnerOrg.id)),
      (s) => setRegistrations(s.docs.map((d) => d.data() as LeadRegistration)),
      () => setRegistrations([])
    );

    return () => uReg();
  }, [activePartnerOrg]);

  React.useEffect(() => {
    if (!builderOrgId || !projectId) {
      setUnits([]);
      return;
    }
    const uUnits = onSnapshot(
      query(
        collection(db, 'units'),
        where('orgId', '==', builderOrgId),
        where('projectId', '==', projectId)
      ),
      (s) => setUnits(s.docs.map((d) => d.data() as Unit)),
      () => setUnits([])
    );
    return () => uUnits();
  }, [builderOrgId, projectId]);

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
        eyebrow={`Authorized Agency • RERA: ${activePartnerOrg.reraNumber || 'Pending'}`}
        title={`${activePartnerOrg.companyName} — Partner Portal`}
        description="View authorized multi-builder inventory, register protected leads, and monitor commission eligibility."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/dashboard">Switch Workspace</Link>
          </Button>
        }
      />

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
              <Button type="submit" className="w-full" size="sm">
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
                  cell: ({ row }) => formatAreaSqft(row.original.saleableAreaSqft),
                },
                {
                  accessorKey: 'calculatedTotalPrice',
                  header: 'Indicative Price',
                  cell: ({ row }) => formatInr(row.original.calculatedTotalPrice),
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
          <CardTitle className="text-sm">Lead Protection & Commission Status ({registrations.length})</CardTitle>
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
    </div>
  );
}
