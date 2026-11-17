import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { where } from 'firebase/firestore';
import {
  Download,
  FileSpreadsheet,
  Kanban,
  List,
  MessageSquare,
  Plus,
  Sparkles,
  Upload,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  formatInrCompact,
  LEAD_PIPELINE_ORDER,
  type Lead,
  type LeadActivity,
  type LeadSource,
  type LeadStage,
  type OrganizationMember,
} from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PermissionGate } from '@/components/shared/PermissionGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
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

const SOURCES: LeadSource[] = [
  'WEBSITE',
  'PUBLIC_PORTAL',
  'FACEBOOK_ADS',
  'INSTAGRAM_ADS',
  'WHATSAPP',
  'GOOGLE_ADS',
  'CHANNEL_PARTNER',
  'CSV_IMPORT',
  'MANUAL',
  'HOSTED_FORM',
];

export function LeadsCrmPage() {
  const navigate = useNavigate();
  const { activeOrgId, projects } = useTenantStore();

  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [members, setMembers] = React.useState<OrganizationMember[]>([]);
  const [viewMode, setViewMode] = React.useState<'kanban' | 'table'>('kanban');
  const [customerFilter, setCustomerFilter] = React.useState<'PROSPECTS' | 'CUSTOMERS' | 'ALL'>('PROSPECTS');
  const [sourceFilter, setSourceFilter] = React.useState<string>('ALL');
  const [qualFilter, setQualFilter] = React.useState<string>('ALL');

  // Modals
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedLead, setSelectedLead] = React.useState<Lead | null>(null);
  const [leadActivities, setLeadActivities] = React.useState<LeadActivity[]>([]);
  const [bulkAgentUid, setBulkAgentUid] = React.useState('');
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Create Lead Form
  const [custName, setCustName] = React.useState('');
  const [custPhone, setCustPhone] = React.useState('');
  const [custEmail, setCustEmail] = React.useState('');
  const [leadSource, setLeadSource] = React.useState<LeadSource>('MANUAL');
  const [campaign, setCampaign] = React.useState('');
  const [budgetMax, setBudgetMax] = React.useState('25000000');
  const [prefProjectId, setPrefProjectId] = React.useState('');
  const [bhkPref, setBhkPref] = React.useState('3 BHK');
  const [timeline, setTimeline] = React.useState<'IMMEDIATE' | '1_TO_3_MONTHS' | '3_TO_6_MONTHS' | '6_PLUS_MONTHS'>('1_TO_3_MONTHS');
  const [notes, setNotes] = React.useState('');

  // Activity Form inside Lead 360 Drawer
  const [actType, setActType] = React.useState<'NOTE' | 'CALL' | 'TASK' | 'FOLLOW_UP'>('NOTE');
  const [actTitle, setActTitle] = React.useState('');
  const [actBody, setActBody] = React.useState('');
  const [actDue, setActDue] = React.useState('');
  const [lostReason, setLostReason] = React.useState('');

  React.useEffect(() => {
    if (!activeOrgId) return;

    const uLeads = subscribeTenantCollection<Lead>({
      orgId: activeOrgId,
      collectionName: 'leads',
      sort: sortDescByIso<Lead>('updatedAt'),
      onData: setLeads,
    });

    const uMembers = subscribeTenantCollection<OrganizationMember>({
      orgId: activeOrgId,
      collectionName: 'organization_members',
      onData: setMembers,
    });

    return () => {
      uLeads();
      uMembers();
    };
  }, [activeOrgId]);

  React.useEffect(() => {
    if (!activeOrgId || !selectedLead) {
      setLeadActivities([]);
      return;
    }
    return subscribeTenantCollection<LeadActivity>({
      orgId: activeOrgId,
      collectionName: 'lead_activities',
      extraConstraints: [where('leadId', '==', selectedLead.id)],
      filter: (a) => a.leadId === selectedLead.id,
      sort: sortDescByIso<LeadActivity>('createdAt'),
      onData: setLeadActivities,
    });
  }, [activeOrgId, selectedLead]);

  const filteredLeads = React.useMemo(() => {
    return leads.filter((l) => {
      const isCust = Boolean(l.isCustomer || l.stage === 'BOOKED' || l.stage === 'CLOSED');
      if (customerFilter === 'PROSPECTS' && isCust) return false;
      if (customerFilter === 'CUSTOMERS' && !isCust) return false;
      if (sourceFilter !== 'ALL' && l.source !== sourceFilter) return false;
      if (qualFilter !== 'ALL' && l.qualificationStatus !== qualFilter) return false;
      return true;
    });
  }, [leads, customerFilter, sourceFilter, qualFilter]);

  const handleConvertToCustomer = async (lead: Lead) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const updated = await callBackendFunction<any, Lead>('convertLeadToCustomer', {
        orgId: activeOrgId,
        leadId: lead.id,
        notes: `Converted to verified Customer from CRM.`,
      });
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      if (selectedLead?.id === updated.id) {
        setSelectedLead(updated);
      }
      setBanner(`Successfully converted "${lead.customerName}" from Prospect to Customer!`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to convert to customer.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<any, { lead: Lead; deduplicated: boolean }>(
        'createLead',
        {
          orgId: activeOrgId,
          customerName: custName,
          phone: custPhone,
          email: custEmail,
          source: leadSource,
          campaign: campaign || undefined,
          budgetMaxInr: Number(budgetMax) || undefined,
          preferredProjectIds: prefProjectId ? [prefProjectId] : [],
          bhkPreference: bhkPref,
          buyingTimeline: timeline,
          notes,
        }
      );
      setCreateOpen(false);
      setCustName('');
      setCustPhone('');
      setCustEmail('');
      setBanner(
        res.deduplicated
          ? `Existing lead matched (${res.lead.normalizedPhone}); merged enquiry without duplicating ownership.`
          : `Captured lead ${res.lead.customerName} (Score: ${res.lead.leadScore}/100).`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Lead creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleStageChange = async (lead: Lead, stage: LeadStage) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const updated = await callBackendFunction<any, Lead>('updateLeadStage', {
        orgId: activeOrgId,
        leadId: lead.id,
        stage,
        lostReason: lostReason || undefined,
      });
      setSelectedLead(updated);
      setBanner(`Moved ${lead.customerName} to ${stage}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Stage update failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !selectedLead) return;
    setBusy(true);
    try {
      await callBackendFunction('addLeadActivity', {
        orgId: activeOrgId,
        leadId: selectedLead.id,
        type: actType,
        title: actTitle,
        body: actBody,
        dueAt: actDue ? new Date(actDue).toISOString() : undefined,
      });
      setActTitle('');
      setActBody('');
      setActDue('');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to log activity.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = () => {
    const header = 'Name,Phone,Email,Source,Stage,Score,BudgetMax\n';
    const rows = filteredLeads
      .map(
        (l) =>
          `"${l.customerName}","${l.normalizedPhone}","${l.email ?? ''}","${l.source}","${l.stage}",${l.leadScore},${l.budgetMaxInr ?? 0}`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bharat_makaan_leads_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeOrgId) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean).slice(1);
    let imported = 0;
    for (const line of lines.slice(0, 50)) {
      const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      if (cols[0] && cols[1]) {
        try {
          await callBackendFunction('createLead', {
            orgId: activeOrgId,
            customerName: cols[0],
            phone: cols[1],
            email: cols[2] || '',
            source: 'CSV_IMPORT',
          });
          imported++;
        } catch {
          // Skip malformed rows
        }
      }
    }
    setBanner(`Processed ${imported} lead(s) from CSV import.`);
  };

  const handleBulkAssign = async () => {
    if (!activeOrgId || !bulkAgentUid || filteredLeads.length === 0) return;
    setBusy(true);
    try {
      await callBackendFunction('bulkAssignLeads', {
        orgId: activeOrgId,
        leadIds: filteredLeads.slice(0, 50).map((l) => l.id),
        targetAgentUid: bulkAgentUid,
      });
      setBanner(`Assigned ${Math.min(50, filteredLeads.length)} filtered leads.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Bulk assignment failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleStartWhatsApp = async (lead: Lead) => {
    if (!activeOrgId) return;
    try {
      await callBackendFunction('startOrGetWhatsappConversation', {
        orgId: activeOrgId,
        customerPhone: lead.normalizedPhone,
        customerName: lead.customerName,
        leadId: lead.id,
      });
      navigate('/app/inbox');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Unable to open WhatsApp thread.');
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={Users}
        title="No builder organization selected."
        description="Select or create a builder organization to manage your sales pipeline and omnichannel leads."
      />
    );
  }

  const bookedCount = leads.filter((l) => l.stage === 'BOOKED' || l.stage === 'CLOSED').length;
  const conversionPct = leads.length > 0 ? ((bookedCount / leads.length) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Omnichannel Sales Pipeline"
        title="Leads & CRM"
        description="Capture, deduplicate, qualify, score, and convert property buyers across Kanban and enterprise table views."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/app/forms">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Lead Form Builder
              </Link>
            </Button>
            <PermissionGate permission="leads:import_export">
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-secondary">
                <Upload className="h-3.5 w-3.5" />
                Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
              </label>
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={leads.length === 0}>
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </PermissionGate>
            <PermissionGate permission="leads:create">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Lead
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

      {/* Conversion & Pipeline Filter Bar */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>
              Total Leads: <strong>{leads.length}</strong>
            </span>
            <span>•</span>
            <span>
              Conversion Rate: <strong className="text-emerald-700">{conversionPct}%</strong>
            </span>

            {/* Prospects vs Customers Segment Toggle */}
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-secondary/60">
              <Button
                type="button"
                variant={customerFilter === 'PROSPECTS' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-2.5 font-medium"
                onClick={() => setCustomerFilter('PROSPECTS')}
              >
                Prospects ({leads.filter((l) => !l.isCustomer && l.stage !== 'BOOKED' && l.stage !== 'CLOSED').length})
              </Button>
              <Button
                type="button"
                variant={customerFilter === 'CUSTOMERS' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-2.5 font-medium"
                onClick={() => setCustomerFilter('CUSTOMERS')}
              >
                Customers ({leads.filter((l) => l.isCustomer || l.stage === 'BOOKED' || l.stage === 'CLOSED').length})
              </Button>
              <Button
                type="button"
                variant={customerFilter === 'ALL' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-2.5 font-medium"
                onClick={() => setCustomerFilter('ALL')}
              >
                All ({leads.length})
              </Button>
            </div>

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Sources</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={qualFilter} onValueChange={setQualFilter}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Qualification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Qualifications</SelectItem>
                <SelectItem value="HOT">HOT</SelectItem>
                <SelectItem value="WARM">WARM</SelectItem>
                <SelectItem value="COLD">COLD</SelectItem>
                <SelectItem value="UNREVIEWED">UNREVIEWED</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <PermissionGate permission="leads:assign">
              {members.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Select value={bulkAgentUid} onValueChange={setBulkAgentUid}>
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue placeholder="Bulk assign to..." />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.uid} value={m.uid}>{m.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" disabled={!bulkAgentUid || busy} onClick={handleBulkAssign}>
                    Assign
                  </Button>
                </div>
              )}
            </PermissionGate>

            <Button
              variant={viewMode === 'kanban' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('kanban')}
            >
              <Kanban className="h-3.5 w-3.5" />
              Kanban
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('table')}
            >
              <List className="h-3.5 w-3.5" />
              Table
            </Button>
          </div>
        </CardContent>
      </Card>

      {leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads received yet. Connect a lead source or create a form."
          description="Capture leads from Meta Lead Ads, Google Ads, Website Forms, Channel Partners, WhatsApp, or manual walk-ins."
          actionLabel="Register First Lead"
          onAction={() => setCreateOpen(true)}
          secondaryAction={
            <Button variant="outline" size="sm" onClick={() => navigate('/app/forms')}>
              Design Lead Form
            </Button>
          }
        />
      ) : viewMode === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {LEAD_PIPELINE_ORDER.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => l.stage === stage);
            return (
              <div
                key={stage}
                className="w-72 shrink-0 rounded-xl border border-border bg-secondary/40 p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {stage.replace(/_/g, ' ')}
                  </span>
                  <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-bold border border-border">
                    {stageLeads.length}
                  </span>
                </div>

                <div className="space-y-2 max-h-[560px] overflow-y-auto">
                  {stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="rounded-lg border border-border bg-card p-3 shadow-2xs hover:border-primary/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-semibold truncate">{lead.customerName}</span>
                          {lead.isCustomer || lead.stage === 'BOOKED' || lead.stage === 'CLOSED' ? (
                            <span className="shrink-0 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-1.5 py-0.2 text-[9px] font-bold">
                              Customer
                            </span>
                          ) : (
                            <span className="shrink-0 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 px-1.5 py-0.2 text-[9px] font-bold">
                              Prospect
                            </span>
                          )}
                        </div>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                          {lead.leadScore}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {lead.normalizedPhone} • {lead.bhkPreference || 'Any BHK'}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">
                          {lead.source.replace(/_/g, ' ')}
                        </span>
                        {lead.budgetMaxInr && (
                          <span className="font-semibold text-foreground">
                            {formatInrCompact(lead.budgetMaxInr)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <DataTable
          data={filteredLeads}
          searchPlaceholder="Search lead name, phone, email, or source..."
          columns={[
            {
              id: 'customerType',
              header: 'Status',
              cell: ({ row }) =>
                row.original.isCustomer || row.original.stage === 'BOOKED' || row.original.stage === 'CLOSED' ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Customer
                  </span>
                ) : (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                    Prospect
                  </span>
                ),
            },
            { accessorKey: 'customerName', header: 'Contact Name' },
            { accessorKey: 'normalizedPhone', header: 'Phone' },
            {
              accessorKey: 'source',
              header: 'Source',
              cell: ({ row }) => row.original.source.replace(/_/g, ' '),
            },
            { accessorKey: 'bhkPreference', header: 'BHK' },
            {
              accessorKey: 'budgetMaxInr',
              header: 'Budget',
              cell: ({ row }) =>
                row.original.budgetMaxInr ? formatInrCompact(row.original.budgetMaxInr) : '—',
            },
            { accessorKey: 'leadScore', header: 'Score' },
            {
              accessorKey: 'stage',
              header: 'Stage',
              cell: ({ row }) => <StatusBadge status={row.original.stage} />,
            },
            {
              id: 'actions',
              header: 'Actions',
              cell: ({ row }) => (
                <div className="flex items-center gap-1.5">
                  {!row.original.isCustomer && row.original.stage !== 'BOOKED' && row.original.stage !== 'CLOSED' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                      title="Convert to Customer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConvertToCustomer(row.original);
                      }}
                    >
                      <UserCheck className="h-3.5 w-3.5 mr-1" />
                      Convert
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelectedLead(row.original)}>
                    Open 360°
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Lead 360° Detail Dialog */}
      <Dialog open={Boolean(selectedLead)} onOpenChange={(o) => !o && setSelectedLead(null)}>
        <DialogContent className="sm:max-w-3xl">
          {selectedLead && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between pr-6 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-lg">
                      {selectedLead.customerName}
                    </DialogTitle>
                    {selectedLead.isCustomer || selectedLead.stage === 'BOOKED' || selectedLead.stage === 'CLOSED' ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Verified Customer
                      </span>
                    ) : (
                      <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                        Prospect
                      </span>
                    )}
                  </div>
                  <StatusBadge status={selectedLead.stage} />
                </div>
                <DialogDescription>
                  Phone: {selectedLead.normalizedPhone} • Source: {selectedLead.source} • Score: {selectedLead.leadScore}/100 •
                  Qualification: {selectedLead.qualificationStatus}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
                {!selectedLead.isCustomer && selectedLead.stage !== 'BOOKED' && selectedLead.stage !== 'CLOSED' && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    disabled={busy}
                    onClick={() => handleConvertToCustomer(selectedLead)}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Convert to Customer
                  </Button>
                )}
                <Select
                  value={selectedLead.stage}
                  onValueChange={(v) => handleStageChange(selectedLead, v as LeadStage)}
                >
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...LEAD_PIPELINE_ORDER, 'LOST', 'UNQUALIFIED'].map((st) => (
                      <SelectItem key={st} value={st}>
                        {st.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Lost/Unqualified reason (if applicable)"
                  className="h-8 w-56 text-xs"
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleStartWhatsApp(selectedLead)}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  WhatsApp Inbox
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedLead(null);
                    navigate('/app/visits');
                  }}
                >
                  Schedule Site Visit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await callBackendFunction<any, { text: string }>(
                        'runAiAssistant',
                        {
                          orgId: activeOrgId,
                          feature: 'LEAD_QUALIFICATION',
                          context: selectedLead,
                        }
                      );
                      setBanner(res.text);
                    } catch (err) {
                      setBanner(
                        err instanceof Error ? err.message : 'OpenAI not configured yet.'
                      );
                    }
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Qualify & Match
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <form onSubmit={handleAddActivity} className="space-y-2.5">
                  <div className="text-xs font-semibold">Log Note, Call, Task or Follow-Up</div>
                  <Select value={actType} onValueChange={(v: any) => setActType(v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NOTE">Note</SelectItem>
                      <SelectItem value="CALL">Call Log</SelectItem>
                      <SelectItem value="TASK">Task</SelectItem>
                      <SelectItem value="FOLLOW_UP">Follow-Up</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    required
                    placeholder="Summary *"
                    value={actTitle}
                    onChange={(e) => setActTitle(e.target.value)}
                  />
                  <Textarea
                    rows={2}
                    placeholder="Detailed conversation notes..."
                    value={actBody}
                    onChange={(e) => setActBody(e.target.value)}
                  />
                  <Input
                    type="datetime-local"
                    value={actDue}
                    onChange={(e) => setActDue(e.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={busy}>
                    Save Activity
                  </Button>
                </form>

                <div className="space-y-2">
                  <div className="text-xs font-semibold">
                    Activity Timeline ({leadActivities.length})
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2 rounded-md border border-border p-3 text-xs">
                    {leadActivities.map((act) => (
                      <div key={act.id} className="border-b border-border pb-2 last:border-0">
                        <div className="flex justify-between font-medium">
                          <span>
                            [{act.type}] {act.title}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(act.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {act.body && <p className="mt-0.5 text-muted-foreground">{act.body}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Lead Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Register New Buyer Lead</DialogTitle>
            <DialogDescription>
              Automatically normalizes phone numbers, checks duplicates, and calculates baseline
              qualification score.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateLead} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Customer Name *</Label>
                <Input required value={custName} onChange={(e) => setCustName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Phone Number *</Label>
                <Input required placeholder="+91 9876543210" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={custEmail} onChange={(e) => setCustEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Lead Source *</Label>
                <Select value={leadSource} onValueChange={(v: any) => setLeadSource(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Preferred Project</Label>
                <Select value={prefProjectId || '__NONE__'} onValueChange={(v) => setPrefProjectId(v === '__NONE__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">Any Project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Max Budget (INR)</Label>
                <Input type="number" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>BHK Preference</Label>
                <Input value={bhkPref} onChange={(e) => setBhkPref(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Buying Timeline</Label>
                <Select value={timeline} onValueChange={(v: any) => setTimeline(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMMEDIATE">Immediate</SelectItem>
                    <SelectItem value="1_TO_3_MONTHS">1–3 Months</SelectItem>
                    <SelectItem value="3_TO_6_MONTHS">3–6 Months</SelectItem>
                    <SelectItem value="6_PLUS_MONTHS">6+ Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Campaign / Notes</Label>
              <Input placeholder="Campaign UTM or buyer requirements" value={notes || campaign} onChange={(e) => { setNotes(e.target.value); setCampaign(e.target.value); }} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Create Lead</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
