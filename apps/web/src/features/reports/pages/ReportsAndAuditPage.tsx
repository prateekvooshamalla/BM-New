import * as React from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, ShieldAlert, Sparkles } from 'lucide-react';
import {
  formatInr,
  formatInrCompact,
  type AiUsageLog,
  type AuditEvent,
  type Booking,
  type CollectionRecord,
  type Conversation,
  type Lead,
  type LeadActivity,
  type PartnerOrganization,
  type PriceRevision,
  type Quotation,
  type SiteVisit,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const REPORT_VIEWS = [
  { id: 'projects', label: '1. Project Performance' },
  { id: 'inventory', label: '2. Inventory Availability' },
  { id: 'prices', label: '3. Price Changes' },
  { id: 'pipeline', label: '4. Sales Pipeline' },
  { id: 'sources', label: '5. Lead Sources' },
  { id: 'agents', label: '6. Agent Activity' },
  { id: 'partners', label: '7. Channel Partners' },
  { id: 'visits', label: '8. Site Visits' },
  { id: 'quotations', label: '9. Quotations' },
  { id: 'discounts', label: '10. Discounts' },
  { id: 'bookings', label: '11. Bookings' },
  { id: 'collections', label: '12. Collections' },
  { id: 'outstanding', label: '13. Outstanding Receivables' },
  { id: 'conversion', label: '14. Conversion Funnel' },
  { id: 'ai', label: '15. AI Usage Telemetry' },
  { id: 'whatsapp', label: '16. WhatsApp Activity' },
] as const;

export function ReportsAndAuditPage() {
  const { activeOrgId, projects } = useTenantStore();
  const [selectedReport, setSelectedReport] = React.useState<string>('projects');
  const [projectFilter, setProjectFilter] = React.useState<string>('ALL');
  const [auditCategory, setAuditCategory] = React.useState<string>('ALL');

  const [units, setUnits] = React.useState<Unit[]>([]);
  const [revisions, setRevisions] = React.useState<PriceRevision[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [activities, setActivities] = React.useState<LeadActivity[]>([]);
  const [partners, setPartners] = React.useState<PartnerOrganization[]>([]);
  const [visits, setVisits] = React.useState<SiteVisit[]>([]);
  const [quotations, setQuotations] = React.useState<Quotation[]>([]);
  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [collections, setCollections] = React.useState<CollectionRecord[]>([]);
  const [aiLogs, setAiLogs] = React.useState<AiUsageLog[]>([]);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [audits, setAudits] = React.useState<AuditEvent[]>([]);

  // Natural Language AI Report state
  const [nlPrompt, setNlPrompt] = React.useState('');
  const [nlAnswer, setNlAnswer] = React.useState<string | null>(null);
  const [nlBusy, setNlBusy] = React.useState(false);

  React.useEffect(() => {
    if (!activeOrgId) return;

    const subs = [
      onSnapshot(query(collection(db, 'units'), where('orgId', '==', activeOrgId)), (s) =>
        setUnits(s.docs.map((d) => d.data() as Unit))
      ),
      onSnapshot(query(collection(db, 'price_revisions'), where('orgId', '==', activeOrgId)), (s) =>
        setRevisions(s.docs.map((d) => d.data() as PriceRevision))
      ),
      onSnapshot(query(collection(db, 'leads'), where('orgId', '==', activeOrgId)), (s) =>
        setLeads(s.docs.map((d) => d.data() as Lead))
      ),
      onSnapshot(query(collection(db, 'lead_activities'), where('orgId', '==', activeOrgId)), (s) =>
        setActivities(s.docs.map((d) => d.data() as LeadActivity))
      ),
      onSnapshot(
        query(collection(db, 'partner_organizations'), where('authorizedOrgIds', 'array-contains', activeOrgId)),
        (s) => setPartners(s.docs.map((d) => d.data() as PartnerOrganization))
      ),
      onSnapshot(query(collection(db, 'site_visits'), where('orgId', '==', activeOrgId)), (s) =>
        setVisits(s.docs.map((d) => d.data() as SiteVisit))
      ),
      onSnapshot(query(collection(db, 'quotations'), where('orgId', '==', activeOrgId)), (s) =>
        setQuotations(s.docs.map((d) => d.data() as Quotation))
      ),
      onSnapshot(query(collection(db, 'bookings'), where('orgId', '==', activeOrgId)), (s) =>
        setBookings(s.docs.map((d) => d.data() as Booking))
      ),
      onSnapshot(query(collection(db, 'collection_records'), where('orgId', '==', activeOrgId)), (s) =>
        setCollections(s.docs.map((d) => d.data() as CollectionRecord))
      ),
      onSnapshot(query(collection(db, 'ai_usage_logs'), where('orgId', '==', activeOrgId)), (s) =>
        setAiLogs(s.docs.map((d) => d.data() as AiUsageLog))
      ),
      onSnapshot(query(collection(db, 'conversations'), where('orgId', '==', activeOrgId)), (s) =>
        setConversations(s.docs.map((d) => d.data() as Conversation))
      ),
      onSnapshot(
        query(
          collection(db, 'audit_events'),
          where('orgId', '==', activeOrgId),
          orderBy('createdAt', 'desc')
        ),
        (s) => setAudits(s.docs.map((d) => d.data() as AuditEvent)),
        () => setAudits([])
      ),
    ];

    return () => subs.forEach((u) => u());
  }, [activeOrgId]);

  const handleRunNlReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !nlPrompt.trim()) return;
    setNlBusy(true);
    try {
      const res = await callBackendFunction<any, { text: string }>('runAiAssistant', {
        orgId: activeOrgId,
        feature: 'ADMIN_NL_REPORT',
        context: {
          question: nlPrompt,
          projectsCount: projects.length,
          unitsCount: units.length,
          leadsCount: leads.length,
          visitsCount: visits.length,
          bookingsCount: bookings.length,
          verifiedCollectionsInr: collections
            .filter((c) => c.status === 'VERIFIED')
            .reduce((a, c) => a + c.paidAmountInr, 0),
        },
      });
      setNlAnswer(res.text);
    } catch (err) {
      setNlAnswer(
        err instanceof Error
          ? err.message
          : 'Configure OPENAI_API_KEY in backend secrets to run natural-language executive queries.'
      );
    } finally {
      setNlBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No builder organization selected."
        description="Select a builder organization to inspect live operational analytics and immutable audit records."
      />
    );
  }

  const scopedUnits = units.filter((u) => projectFilter === 'ALL' || u.projectId === projectFilter);
  const scopedBookings = bookings.filter(
    (b) => projectFilter === 'ALL' || b.projectId === projectFilter
  );

  const stageChart = Array.from(
    leads.reduce((map, l) => map.set(l.stage, (map.get(l.stage) ?? 0) + 1), new Map<string, number>())
  ).map(([stage, count]) => ({ stage, count }));

  const sourceChart = Array.from(
    leads.reduce((map, l) => map.set(l.source, (map.get(l.source) ?? 0) + 1), new Map<string, number>())
  ).map(([source, count]) => ({ source, count }));

  const filteredAudits = audits.filter(
    (a) => auditCategory === 'ALL' || a.category === auditCategory
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Enterprise Intelligence & Compliance"
        title="Reports & Immutable Audit Trail"
        description="16 real-time operational reports derived strictly from live database records, plus append-only governance logs."
        actions={
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Filter Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">16 Operational Reports</TabsTrigger>
          <TabsTrigger value="audit">Immutable Audit Explorer ({audits.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-5">
          {/* Natural Language Admin Report Box */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Executive Natural-Language Report Assistant
              </CardTitle>
              <CardDescription>
                Ask analytical questions grounded strictly in your organization's real Firestore metrics.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={handleRunNlReport} className="flex gap-2">
                <Input
                  placeholder="e.g., Summarize visit-to-booking conversion and outstanding collections across towers..."
                  value={nlPrompt}
                  onChange={(e) => setNlPrompt(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={nlBusy}>
                  {nlBusy ? 'Analyzing...' : 'Run Report'}
                </Button>
              </form>
              {nlAnswer && (
                <div className="rounded-md border border-border bg-secondary p-3 text-xs leading-relaxed">
                  {nlAnswer}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedReport} onValueChange={setSelectedReport}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_VIEWS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic Report Surface */}
          {selectedReport === 'projects' && (
            <DataTable
              data={projects}
              emptyMessage="No projects yet. Create your first project."
              columns={[
                { accessorKey: 'name', header: 'Project' },
                { accessorKey: 'city', header: 'City' },
                { id: 'u', header: 'Available / Total', cell: ({ row }) => `${row.original.stats.availableUnits} / ${row.original.stats.totalUnits}` },
                { id: 'b', header: 'Booked Units', cell: ({ row }) => row.original.stats.bookedUnits },
                { id: 'sv', header: 'Sales Value', cell: ({ row }) => formatInrCompact(row.original.stats.bookedSalesValueInr) },
                { id: 'col', header: 'Verified Collections', cell: ({ row }) => formatInrCompact(row.original.stats.collectionsVerifiedInr) },
              ]}
            />
          )}

          {selectedReport === 'inventory' && (
            <DataTable
              data={scopedUnits}
              emptyMessage="No units added."
              columns={[
                { accessorKey: 'unitNumber', header: 'Unit #' },
                { accessorKey: 'bhk', header: 'BHK' },
                { accessorKey: 'facing', header: 'Facing' },
                { accessorKey: 'calculatedTotalPrice', header: 'Price', cell: ({ row }) => formatInr(row.original.calculatedTotalPrice) },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            />
          )}

          {selectedReport === 'prices' && (
            <DataTable
              data={revisions}
              emptyMessage="No price revisions logged yet."
              columns={[
                { accessorKey: 'unitNumber', header: 'Unit' },
                { accessorKey: 'oldTotalValue', header: 'Old Total', cell: ({ row }) => formatInr(row.original.oldTotalValue) },
                { accessorKey: 'newTotalValue', header: 'New Total', cell: ({ row }) => formatInr(row.original.newTotalValue) },
                { accessorKey: 'changePct', header: 'Change %', cell: ({ row }) => `${row.original.changePct}%` },
                { accessorKey: 'reason', header: 'Reason' },
              ]}
            />
          )}

          {selectedReport === 'pipeline' && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Sales Pipeline Distribution</CardTitle></CardHeader>
              <CardContent className="h-64">
                {stageChart.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leads received yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stageChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="stage" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#0F265C" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          )}

          {selectedReport === 'sources' && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Lead Source Attribution</CardTitle></CardHeader>
              <CardContent className="h-64">
                {sourceChart.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leads received yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourceChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="source" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1D4ED8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          )}

          {selectedReport === 'agents' && (
            <DataTable
              data={activities}
              emptyMessage="No agent activities recorded yet."
              columns={[
                { accessorKey: 'performedByUid', header: 'Agent UID' },
                { accessorKey: 'type', header: 'Activity Type' },
                { accessorKey: 'title', header: 'Summary' },
                { accessorKey: 'createdAt', header: 'Timestamp', cell: ({ row }) => new Date(row.original.createdAt).toLocaleString() },
              ]}
            />
          )}

          {selectedReport === 'partners' && (
            <DataTable
              data={partners}
              emptyMessage="No channel partners onboarded yet."
              columns={[
                { accessorKey: 'companyName', header: 'Agency' },
                { id: 'l', header: 'Registered Leads', cell: ({ row }) => row.original.metrics.registeredLeadsCount },
                { id: 'b', header: 'Bookings', cell: ({ row }) => row.original.metrics.bookingsCount },
                { id: 'c', header: 'Eligible Commission', cell: ({ row }) => formatInr(row.original.metrics.eligibleCommissionInr) },
              ]}
            />
          )}

          {selectedReport === 'visits' && (
            <DataTable
              data={visits}
              emptyMessage="No site visits scheduled yet."
              columns={[
                { accessorKey: 'customerName', header: 'Visitor' },
                { accessorKey: 'scheduledStartAt', header: 'Date', cell: ({ row }) => new Date(row.original.scheduledStartAt).toLocaleString() },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
                { accessorKey: 'outcome', header: 'Outcome', cell: ({ row }) => row.original.outcome ?? '—' },
              ]}
            />
          )}

          {(selectedReport === 'quotations' || selectedReport === 'discounts') && (
            <DataTable
              data={
                selectedReport === 'discounts'
                  ? quotations.filter((q) => q.breakdown.discountAmountInr > 0)
                  : quotations
              }
              emptyMessage="No matching quotations."
              columns={[
                { accessorKey: 'quotationNumber', header: 'Quotation #' },
                { accessorKey: 'unitNumber', header: 'Unit' },
                { id: 'disc', header: 'Discount', cell: ({ row }) => formatInr(row.original.breakdown.discountAmountInr) },
                { accessorKey: 'totalPayableInr', header: 'Total Payable', cell: ({ row }) => formatInr(row.original.totalPayableInr) },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            />
          )}

          {(selectedReport === 'bookings' || selectedReport === 'outstanding') && (
            <DataTable
              data={
                selectedReport === 'outstanding'
                  ? scopedBookings.filter((b) => b.outstandingBalanceInr > 0 && b.status !== 'CANCELLED')
                  : scopedBookings
              }
              emptyMessage="No matching booking records."
              columns={[
                { accessorKey: 'bookingNumber', header: 'Booking #' },
                { accessorKey: 'unitNumber', header: 'Unit' },
                { accessorKey: 'totalPayableInr', header: 'Contract Value', cell: ({ row }) => formatInr(row.original.totalPayableInr) },
                { accessorKey: 'totalCollectedVerifiedInr', header: 'Collected', cell: ({ row }) => formatInr(row.original.totalCollectedVerifiedInr) },
                { accessorKey: 'outstandingBalanceInr', header: 'Outstanding', cell: ({ row }) => formatInr(row.original.outstandingBalanceInr) },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            />
          )}

          {selectedReport === 'collections' && (
            <DataTable
              data={collections}
              emptyMessage="No collection records yet."
              columns={[
                { accessorKey: 'milestoneName', header: 'Milestone' },
                { accessorKey: 'paymentMode', header: 'Mode' },
                { accessorKey: 'paidAmountInr', header: 'Amount', cell: ({ row }) => formatInr(row.original.paidAmountInr) },
                { accessorKey: 'receiptNumber', header: 'Receipt #' },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            />
          )}

          {selectedReport === 'conversion' && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total Leads</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{leads.length}</CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Completed Visits</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{visits.filter((v) => v.status === 'COMPLETED').length}</CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Issued Quotations</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{quotations.length}</CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Active Bookings</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-emerald-700">{bookings.filter((b) => b.status !== 'CANCELLED').length}</CardContent></Card>
            </div>
          )}

          {selectedReport === 'ai' && (
            <DataTable
              data={aiLogs}
              emptyMessage="No AI usage recorded yet."
              columns={[
                { accessorKey: 'feature', header: 'AI Capability' },
                { accessorKey: 'model', header: 'Model' },
                { id: 'tokens', header: 'Tokens', cell: ({ row }) => row.original.inputTokens + row.original.outputTokens },
                { accessorKey: 'creditsConsumed', header: 'Credits' },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            />
          )}

          {selectedReport === 'whatsapp' && (
            <DataTable
              data={conversations}
              emptyMessage="No WhatsApp conversations recorded yet."
              columns={[
                { accessorKey: 'customerName', header: 'Customer' },
                { accessorKey: 'customerPhone', header: 'Phone' },
                { accessorKey: 'optInStatus', header: 'Opt-In', cell: ({ row }) => <StatusBadge status={row.original.optInStatus} /> },
                { accessorKey: 'status', header: 'Thread Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            />
          )}
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Append-only server-written ledger. Audit records cannot be edited or deleted.
            </div>
            <Select value={auditCategory} onValueChange={setAuditCategory}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {[
                  'PRICING',
                  'INVENTORY',
                  'PARKING',
                  'DISCOUNT',
                  'APPROVAL',
                  'BOOKING',
                  'PAYMENT',
                  'DOCUMENT',
                  'PERMISSION',
                  'AUTH',
                  'BILLING',
                  'AI',
                ].map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DataTable
            data={filteredAudits}
            searchPlaceholder="Search actor, action, entity or summary..."
            emptyMessage="No audit events recorded for the selected category."
            columns={[
              {
                accessorKey: 'createdAt',
                header: 'Timestamp',
                cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
              },
              { accessorKey: 'category', header: 'Category' },
              { accessorKey: 'action', header: 'Operation' },
              {
                id: 'actor',
                header: 'Actor',
                cell: ({ row }) => row.original.actorEmail || row.original.actorUid,
              },
              { accessorKey: 'summary', header: 'Summary' },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
