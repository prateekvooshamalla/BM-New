import * as React from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { AlertTriangle, Handshake, Plus, ShieldCheck } from 'lucide-react';
import {
  formatInr,
  type LeadRegistration,
  type PartnerOrganization,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PermissionGate } from '@/components/shared/PermissionGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

export function ChannelPartnersPage() {
  const { activeOrgId, projects } = useTenantStore();
  const [partners, setPartners] = React.useState<PartnerOrganization[]>([]);
  const [registrations, setRegistrations] = React.useState<LeadRegistration[]>([]);

  const [onboardOpen, setOnboardOpen] = React.useState(false);
  const [regLeadOpen, setRegLeadOpen] = React.useState(false);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Onboard Partner Form
  const [companyName, setCompanyName] = React.useState('');
  const [contactName, setContactName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [reraNumber, setReraNumber] = React.useState('');
  const [officeCity, setOfficeCity] = React.useState('');
  const [commissionPct, setCommissionPct] = React.useState('2.5');
  const [commissionTerms, setCommissionTerms] = React.useState('Payable upon 20% customer collection & Sale Agreement execution');
  const [scopedProjects, setScopedProjects] = React.useState<string[]>([]);

  // Register Partner Lead Form
  const [regPartnerId, setRegPartnerId] = React.useState('');
  const [regProjectId, setRegProjectId] = React.useState('');
  const [regCustName, setRegCustName] = React.useState('');
  const [regCustPhone, setRegCustPhone] = React.useState('');

  React.useEffect(() => {
    if (!activeOrgId) return;

    const uPartners = onSnapshot(
      query(
        collection(db, 'partner_organizations'),
        where('authorizedOrgIds', 'array-contains', activeOrgId)
      ),
      (s) => setPartners(s.docs.map((d) => d.data() as PartnerOrganization)),
      () => {
        void callBackendFunction<any, { items: PartnerOrganization[] }>(
          'getOrganizationCollectionSnapshot',
          { orgId: activeOrgId, collectionName: 'partner_organizations' }
        )
          .then((res) => setPartners(res.items ?? []))
          .catch(() => setPartners([]));
      }
    );

    const uRegs = subscribeTenantCollection<LeadRegistration>({
      orgId: activeOrgId,
      collectionName: 'lead_registrations',
      onData: setRegistrations,
    });

    return () => {
      uPartners();
      uRegs();
    };
  }, [activeOrgId]);

  const disputedRegistrations = registrations.filter((r) => r.status === 'DISPUTED');

  const handleOnboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setBusy(true);
    try {
      await callBackendFunction('onboardPartnerOrganization', {
        orgId: activeOrgId,
        companyName,
        contactName,
        email,
        phone,
        reraNumber,
        officeCity,
        projectIds: scopedProjects.length > 0 ? scopedProjects : projects.map((p) => p.id),
        commissionPct: Number(commissionPct),
        commissionTerms,
      });
      setOnboardOpen(false);
      setCompanyName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setBanner(`Onboarded channel partner "${companyName}".`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Onboarding failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<
        any,
        { conflictDetected: boolean; registration: LeadRegistration }
      >('registerPartnerLead', {
        orgId: activeOrgId,
        projectId: regProjectId,
        partnerOrgId: regPartnerId,
        customerName: regCustName,
        phone: regCustPhone,
      });
      setRegLeadOpen(false);
      setRegCustName('');
      setRegCustPhone('');
      setBanner(
        res.conflictDetected
          ? `Lead protection conflict detected! Flagged as DISPUTED without overriding existing ownership.`
          : `Protected lead registered until ${res.registration.protectedUntil.slice(0, 10)}.`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleResolveConflict = async (reg: LeadRegistration, winnerPartnerId: string | null) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      await callBackendFunction('resolvePartnerLeadConflict', {
        orgId: activeOrgId,
        registrationId: reg.id,
        winningPartnerOrgId: winnerPartnerId,
        resolutionNotes: 'Verified call/walk-in attribution timestamps',
      });
      setBanner('Resolved lead registration dispute and updated attribution.');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Resolution failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={Handshake}
        title="No builder organization selected."
        description="Select a builder organization to manage channel partner agencies, RERA scopes, and lead protection."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Broker & Agency Ecosystem"
        title="Channel Partners & Lead Protection"
        description="Onboard RERA-registered agencies, scope project inventory access, enforce lead-protection windows, and track commissions."
        actions={
          <div className="flex items-center gap-2">
            {partners.length > 0 && projects.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setRegLeadOpen(true)}>
                <ShieldCheck className="h-3.5 w-3.5" />
                Register Partner Lead
              </Button>
            )}
            <PermissionGate permission="partners:manage">
              <Button size="sm" onClick={() => setOnboardOpen(true)} disabled={projects.length === 0}>
                <Plus className="h-4 w-4" />
                Onboard Agency
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
          {banner}
        </div>
      )}

      {disputedRegistrations.length > 0 && (
        <PermissionGate permission="partners:resolve_conflict">
          <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                Disputed Lead Registrations Requiring Conflict Resolution ({disputedRegistrations.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {disputedRegistrations.map((reg) => (
                <div
                  key={reg.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-xs"
                >
                  <div>
                    <div className="font-semibold">
                      {reg.customerName} ({reg.normalizedPhone})
                    </div>
                    <div className="text-muted-foreground">{reg.conflictReason}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => handleResolveConflict(reg, reg.partnerOrgId)}
                    >
                      Keep Original Owner
                    </Button>
                    {reg.disputedByPartnerOrgId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleResolveConflict(reg, reg.disputedByPartnerOrgId!)
                        }
                      >
                        Award Challenging Partner
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </PermissionGate>
      )}

      <Tabs defaultValue="partners">
        <TabsList>
          <TabsTrigger value="partners">Partner Agencies ({partners.length})</TabsTrigger>
          <TabsTrigger value="registrations">
            Protected Lead Registrations ({registrations.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="partners">
          {partners.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title="No channel partners onboarded yet. Invite or register a partner agency."
              description="Assign permitted projects, commission percentages, and RERA verification to external real estate agencies."
              actionLabel={projects.length > 0 ? 'Onboard First Agency' : undefined}
              onAction={projects.length > 0 ? () => setOnboardOpen(true) : undefined}
            />
          ) : (
            <DataTable
              data={partners}
              searchPlaceholder="Search agency name, RERA or city..."
              columns={[
                { accessorKey: 'companyName', header: 'Agency Name' },
                { accessorKey: 'contactName', header: 'Principal Contact' },
                { accessorKey: 'reraNumber', header: 'RERA #' },
                { accessorKey: 'officeCity', header: 'City' },
                {
                  id: 'commission',
                  header: 'Commission Terms',
                  cell: ({ row }) => {
                    const sc = row.original.builderScopes?.[activeOrgId];
                    return sc ? `${sc.commissionPct}%` : '—';
                  },
                },
                {
                  id: 'leads',
                  header: 'Leads / Bookings',
                  cell: ({ row }) =>
                    `${row.original.metrics.registeredLeadsCount} Leads / ${row.original.metrics.bookingsCount} Bookings`,
                },
                {
                  id: 'eligible',
                  header: 'Commission Eligible',
                  cell: ({ row }) => formatInr(row.original.metrics.eligibleCommissionInr),
                },
                {
                  accessorKey: 'status',
                  header: 'Status',
                  cell: ({ row }) => <StatusBadge status={row.original.status} />,
                },
              ]}
            />
          )}
        </TabsContent>

        <TabsContent value="registrations">
          <DataTable
            data={registrations}
            searchPlaceholder="Search registered customer or phone..."
            emptyMessage="No partner leads registered yet."
            columns={[
              { accessorKey: 'customerName', header: 'Customer' },
              { accessorKey: 'normalizedPhone', header: 'Phone' },
              { accessorKey: 'partnerOrgId', header: 'Partner ID' },
              {
                accessorKey: 'protectedUntil',
                header: 'Protected Until',
                cell: ({ row }) => new Date(row.original.protectedUntil).toLocaleDateString(),
              },
              {
                accessorKey: 'status',
                header: 'Protection Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* Onboard Partner Modal */}
      <Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Onboard Channel Partner Agency</DialogTitle>
            <DialogDescription>
              Grant scoped access to selected projects and define commission eligibility terms.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleOnboard} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Agency / Company Name *</Label>
                <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Principal Contact Name *</Label>
                <Input required value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Official Email *</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Phone *</Label>
                <Input required value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Agency RERA #</Label>
                <Input value={reraNumber} onChange={(e) => setReraNumber(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Office City *</Label>
                <Input required value={officeCity} onChange={(e) => setOfficeCity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Commission (%) *</Label>
                <Input type="number" step="0.1" required value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Commission Terms *</Label>
                <Input required value={commissionTerms} onChange={(e) => setCommissionTerms(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Authorized Projects</Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 max-h-28 overflow-y-auto">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={scopedProjects.includes(p.id)}
                      onCheckedChange={() =>
                        setScopedProjects((prev) =>
                          prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                        )
                      }
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Authorize Partner</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Register Partner Lead Modal */}
      <Dialog open={regLeadOpen} onOpenChange={setRegLeadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Protected Partner Lead</DialogTitle>
            <DialogDescription>
              Duplicate submissions never silently override existing lead ownership.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegisterLead} className="space-y-3">
            <div className="space-y-1">
              <Label>Channel Partner Agency *</Label>
              <Select value={regPartnerId} onValueChange={setRegPartnerId}>
                <SelectTrigger><SelectValue placeholder="Choose agency" /></SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Project *</Label>
              <Select value={regProjectId} onValueChange={setRegProjectId}>
                <SelectTrigger><SelectValue placeholder="Choose project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Customer Name *</Label>
              <Input required value={regCustName} onChange={(e) => setRegCustName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Customer Phone *</Label>
              <Input required value={regCustPhone} onChange={(e) => setRegCustPhone(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !regPartnerId || !regProjectId}>
                Register & Lock Lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
