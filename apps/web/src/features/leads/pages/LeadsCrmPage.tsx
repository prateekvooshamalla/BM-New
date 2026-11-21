import * as React from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Kanban,
  List,
  MessageSquare,
  Plus,
  ReceiptIndianRupee,
  Search,
  Sparkles,
  Star,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  formatInrCompact,
  hasPermission,
  type Booking,
  type Lead,
  type LeadActivity,
  type LeadSource,
  type LeadStage,
  type OrganizationMember,
  type SiteVisit,
  type Unit,
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
import { cn } from '@/lib/utils';
import { isCustomer, LEAD_STAGES, LeadsKanban, stageLabel } from '../components/LeadsKanban';
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

export interface LeadsCrmPageProps {
  defaultTab?: 'leads' | 'customers';
}

export function LeadsCrmPage({ defaultTab }: LeadsCrmPageProps = {}) {
  const orgId = useTenantStore((state) => state.activeOrgId);
  return <LeadWorkspace key={orgId} defaultTab={defaultTab} />;
}

function LeadWorkspace({ defaultTab }: LeadsCrmPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeOrgId, projects, activeMember, isSuperAdmin } = useTenantStore();

  const isCustomerRoute =
    location.pathname.includes('/customers') ||
    searchParams.get('tab') === 'customers' ||
    defaultTab === 'customers';

  const [activeTab, setActiveTab] = React.useState<'leads' | 'customers'>(
    isCustomerRoute ? 'customers' : 'leads'
  );

  React.useEffect(() => {
    if (
      location.pathname.includes('/customers') ||
      searchParams.get('tab') === 'customers' ||
      defaultTab === 'customers'
    ) {
      setActiveTab('customers');
    } else if (searchParams.get('tab') === 'leads' || defaultTab === 'leads') {
      setActiveTab('leads');
    }
  }, [location.pathname, searchParams, defaultTab]);

  const handleTabChange = (tab: 'leads' | 'customers') => {
    setActiveTab(tab);
    setQuery('');
    if (tab === 'customers') {
      if (location.pathname.includes('/builder/')) {
        navigate('/builder/customers');
      } else if (location.pathname.includes('/app/')) {
        navigate('/app/customers');
      } else {
        setSearchParams({ tab: 'customers' });
      }
    } else {
      if (location.pathname.includes('/builder/')) {
        navigate('/builder/leads');
      } else if (location.pathname.includes('/app/')) {
        navigate('/app/leads');
      } else {
        setSearchParams({ tab: 'leads' });
      }
    }
  };

  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [members, setMembers] = React.useState<OrganizationMember[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [allVisits, setAllVisits] = React.useState<SiteVisit[]>([]);

  const [viewMode, setViewMode] = React.useState<'kanban' | 'table'>('kanban');
  const [customerProjectFilter, setCustomerProjectFilter] = React.useState<string>('ALL');
  const [stageFilter, setStageFilter] = React.useState<LeadStage | 'ALL'>('ALL');
  const [query, setQuery] = React.useState('');
  const [stageError, setStageError] = React.useState<string | null>(null);
  const [pendingStageId, setPendingStageId] = React.useState<string | null>(null);
  const pendingMove = React.useRef(false);
  const [reasonMove, setReasonMove] = React.useState<{ lead: Lead; stage: LeadStage } | null>(null);
  const canMove = () => isSuperAdmin || hasPermission(activeMember, 'leads:edit');
  const [sourceFilter, setSourceFilter] = React.useState<string>('ALL');
  const [qualFilter, setQualFilter] = React.useState<string>('ALL');

  // Modals
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedLead, setSelectedLead] = React.useState<Lead | null>(null);
  const [leadActivities, setLeadActivities] = React.useState<LeadActivity[]>([]);
  const [leadVisits, setLeadVisits] = React.useState<SiteVisit[]>([]);
  const [bulkAgentUid, setBulkAgentUid] = React.useState('');
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Convert to Customer Modal
  const [convertModalOpen, setConvertModalOpen] = React.useState(false);
  const [convertTargetLead, setConvertTargetLead] = React.useState<Lead | null>(null);
  const [convertNotes, setConvertNotes] = React.useState('');
  const [convertFlat, setConvertFlat] = React.useState('');

  // Create Lead Form
  const [custName, setCustName] = React.useState('');
  const [custPhone, setCustPhone] = React.useState('');
  const [custEmail, setCustEmail] = React.useState('');
  const [leadSource, setLeadSource] = React.useState<LeadSource>('MANUAL');
  const [campaign, setCampaign] = React.useState('');
  const [budgetMax, setBudgetMax] = React.useState('');
  const [prefProjectId, setPrefProjectId] = React.useState('');
  const [bhkPref, setBhkPref] = React.useState('');
  const [timeline, setTimeline] = React.useState<
    'IMMEDIATE' | '1_TO_3_MONTHS' | '3_TO_6_MONTHS' | '6_PLUS_MONTHS' | ''
  >('');
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

    const uUnits = subscribeTenantCollection<Unit>({
      orgId: activeOrgId,
      collectionName: 'units',
      onData: setUnits,
    });

    const uBookings = subscribeTenantCollection<Booking>({
      orgId: activeOrgId,
      collectionName: 'bookings',
      onData: setBookings,
    });

    const uVisits = subscribeTenantCollection<SiteVisit>({
      orgId: activeOrgId,
      collectionName: 'site_visits',
      onData: setAllVisits,
    });

    return () => {
      uLeads();
      uMembers();
      uUnits();
      uBookings();
      uVisits();
    };
  }, [activeOrgId]);

  const selectedLeadId = selectedLead?.id;
  React.useEffect(() => {
    setSelectedLead((current) =>
      current ? leads.find((lead) => lead.id === current.id) ?? current : null
    );
  }, [leads]);

  const leadIdParam = searchParams.get('leadId');
  React.useEffect(() => {
    if (leadIdParam && leads.length > 0) {
      const match = leads.find((l) => l.id === leadIdParam);
      if (match) {
        setSelectedLead(match);
        if (isCustomer(match) || searchParams.get('tab') === 'customers' || location.pathname.includes('/customers')) {
          setActiveTab('customers');
        }
      }
    }
  }, [leadIdParam, leads, location.pathname, searchParams]);

  React.useEffect(() => {
    setLeadActivities([]);
    if (!activeOrgId || !selectedLeadId) {
      setLeadActivities([]);
      return;
    }
    return subscribeTenantCollection<LeadActivity>({
      orgId: activeOrgId,
      collectionName: 'lead_activities',
      extraConstraints: [where('leadId', '==', selectedLeadId)],
      filter: (a) => a.leadId === selectedLeadId,
      sort: sortDescByIso<LeadActivity>('createdAt'),
      onData: setLeadActivities,
    });
  }, [activeOrgId, selectedLeadId]);

  // Load site visits for selected contact
  React.useEffect(() => {
    setLeadVisits([]);
    if (!activeOrgId || !selectedLeadId) return;
    return subscribeTenantCollection<SiteVisit>({
      orgId: activeOrgId,
      collectionName: 'site_visits',
      extraConstraints: [where('leadId', '==', selectedLeadId)],
      filter: (v) => v.leadId === selectedLeadId,
      sort: sortDescByIso<SiteVisit>('scheduledStartAt'),
      onData: setLeadVisits,
    });
  }, [activeOrgId, selectedLeadId]);

  // STRICT SEPARATION: Leads vs Customers
  const prospectLeads = React.useMemo(() => leads.filter((l) => !isCustomer(l)), [leads]);
  const verifiedCustomers = React.useMemo(() => leads.filter((l) => isCustomer(l)), [leads]);

  const prospectsCount = prospectLeads.length;
  const customersCount = verifiedCustomers.length;
  const conversionRate = leads.length > 0 ? Math.round((customersCount / leads.length) * 100) : 0;

  // 1. LEADS CRM FILTERED LIST (Only unconverted leads!)
  const matchingLeads = React.useMemo(() => {
    const search = query.trim().toLowerCase();
    return prospectLeads.filter((lead) => {
      if (sourceFilter !== 'ALL' && lead.source !== sourceFilter) return false;
      if (qualFilter !== 'ALL' && lead.qualificationStatus !== qualFilter) return false;
      return (
        !search ||
        [lead.customerName, lead.phone, lead.normalizedPhone, lead.email, stageLabel(lead.source)].some(
          (value) => value?.toLowerCase().includes(search)
        )
      );
    });
  }, [prospectLeads, query, sourceFilter, qualFilter]);

  const stageCounts = new Map<LeadStage, number>();
  for (const lead of matchingLeads) stageCounts.set(lead.stage, (stageCounts.get(lead.stage) ?? 0) + 1);
  const filteredLeads =
    stageFilter === 'ALL' ? matchingLeads : matchingLeads.filter((lead) => lead.stage === stageFilter);
  const sources = [...new Set(prospectLeads.map((lead) => lead.source))].sort();
  const qualificationOptions = [
    ...new Set(prospectLeads.map((lead) => lead.qualificationStatus).filter(Boolean)),
  ].sort();
  const hasLeadFilters = Boolean(
    query || stageFilter !== 'ALL' || sourceFilter !== 'ALL' || qualFilter !== 'ALL'
  );
  const clearLeadFilters = () => {
    setQuery('');
    setStageFilter('ALL');
    setSourceFilter('ALL');
    setQualFilter('ALL');
  };

  // 2. CUSTOMERS FILTERED DIRECTORY (Only flat buyers!)
  const matchingCustomers = React.useMemo(() => {
    const search = query.trim().toLowerCase();
    return verifiedCustomers.filter((cust) => {
      if (customerProjectFilter !== 'ALL' && cust.projectId !== customerProjectFilter) {
        return false;
      }
      if (!search) return true;
      const b = bookings.find((bk) => bk.leadId === cust.id);
      const u = units.find((un) => un.heldForLeadId === cust.id || (b && un.id === b.unitId));
      return [
        cust.customerName,
        cust.phone,
        cust.normalizedPhone,
        cust.email,
        b?.unitNumber,
        u?.unitNumber,
        u?.towerName,
      ].some((value) => value?.toLowerCase().includes(search));
    });
  }, [verifiedCustomers, customerProjectFilter, query, bookings, units]);

  const getCustomerFlat = (cust: Lead) => {
    const b = bookings.find((bk) => bk.leadId === cust.id);
    const u = units.find((un) => un.heldForLeadId === cust.id || (b && un.id === b.unitId));
    if (u) {
      return {
        unitNumber: u.unitNumber,
        towerName: u.towerName,
        bhk: u.bhk,
        priceInr: b?.agreementValueInr || u.calculatedTotalPrice,
        status: b?.status || u.status,
      };
    }
    if (b) {
      return {
        unitNumber: b.unitNumber,
        towerName: undefined,
        bhk: undefined,
        priceInr: b.agreementValueInr,
        status: b.status,
      };
    }
    return null;
  };

  const handleOpenConvertModal = (lead: Lead) => {
    setConvertTargetLead(lead);
    setConvertNotes('Purchased flat and converted to verified buyer customer.');
    setConvertFlat('');
    setConvertModalOpen(true);
  };

  const handleConfirmConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !convertTargetLead) return;
    setBusy(true);
    try {
      const noteText = convertFlat.trim()
        ? `${convertNotes.trim()} (Purchased Flat: ${convertFlat.trim()})`
        : convertNotes.trim();

      const matchedUnit = units.find(
        (u) =>
          u.heldForLeadId === convertTargetLead.id ||
          (convertFlat && u.unitNumber.toLowerCase() === convertFlat.trim().toLowerCase())
      );

      const updated = await callBackendFunction<any, Lead>('convertLeadToCustomer', {
        orgId: activeOrgId,
        leadId: convertTargetLead.id,
        unitId: matchedUnit?.id,
        flatNumber: convertFlat.trim() || undefined,
        notes: noteText || 'Converted from Prospect to verified Customer.',
      });

      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      if (selectedLead?.id === updated.id) {
        setSelectedLead(updated);
      }
      setConvertModalOpen(false);
      setConvertTargetLead(null);
      setConvertNotes('');
      setConvertFlat('');
      setBanner(
        `Successfully converted "${convertTargetLead.customerName}" from Prospect to verified Customer! They are now in the Customers tab.`
      );
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
          bhkPreference: bhkPref.trim() || undefined,
          buyingTimeline: timeline || undefined,
          notes,
        }
      );
      setLeads((current) => [res.lead, ...current.filter((lead) => lead.id !== res.lead.id)]);
      setCreateOpen(false);
      setCustName('');
      setCustPhone('');
      setCustEmail('');
      setLeadSource('MANUAL');
      setCampaign('');
      setBudgetMax('');
      setPrefProjectId('');
      setBhkPref('');
      setTimeline('');
      setNotes('');
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

  const saveStage = async (lead: Lead, stage: LeadStage, reason?: string) => {
    if (!activeOrgId || !canMove() || pendingMove.current || lead.stage === stage) return;
    pendingMove.current = true;
    setPendingStageId(lead.id);
    setStageError(null);
    setBanner(null);
    try {
      const updated = await callBackendFunction<unknown, Lead>('updateLeadStage', {
        orgId: activeOrgId,
        leadId: lead.id,
        stage,
        expectedStage: lead.stage,
        lostReason: reason,
      });
      setLeads((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedLead((current) => (current?.id === updated.id ? updated : current));
      setReasonMove(null);
      setLostReason('');
      setBanner(`Moved ${lead.customerName} to ${stageLabel(stage)}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not move the lead.';
      setStageError(message);
      setBanner(message);
    } finally {
      pendingMove.current = false;
      setPendingStageId(null);
    }
  };

  const requestStageMove = (lead: Lead, stage: LeadStage) => {
    if (!canMove() || pendingMove.current || lead.stage === stage) return;
    if (stage === 'LOST' || stage === 'UNQUALIFIED') {
      setBanner(null);
      setLostReason('');
      setStageError(null);
      setReasonMove({ lead, stage });
      return;
    }
    void saveStage(lead, stage);
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

  const handleExportCustomersCsv = () => {
    const header = 'CustomerName,Phone,Email,FlatNumber,Tower,Project,Status,ConvertedAt\n';
    const rows = matchingCustomers
      .map((c) => {
        const flat = getCustomerFlat(c);
        const p = projects.find((proj) => proj.id === c.projectId)?.name || '';
        return `"${c.customerName}","${c.normalizedPhone || c.phone}","${c.email ?? ''}","${flat?.unitNumber ?? ''}","${flat?.towerName ?? ''}","${p}","${flat?.status ?? 'BOOKED'}","${c.customerConvertedAt ?? c.updatedAt}"`;
      })
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bharat_makaan_customers_${new Date().toISOString().slice(0, 10)}.csv`;
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

  return (
    <div className="min-w-0 space-y-5">
      {/* Dynamic Page Header */}
      {activeTab === 'leads' ? (
        <PageHeader
          title="Leads CRM"
          description="Capture, qualify, and track prospective buyer enquiries before flat purchase."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/app/forms">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Lead Forms
                </Link>
              </Button>
              <PermissionGate permission="leads:import_export">
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-secondary">
                  <Upload className="h-3.5 w-3.5" />
                  Import CSV
                  <input type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCsv}
                  disabled={filteredLeads.length === 0}
                >
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
      ) : (
        <PageHeader
          title="Verified Customers"
          description="Directory of verified flat buyers who have purchased or booked units."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCustomersCsv}
                disabled={matchingCustomers.length === 0}
              >
                <Download className="h-3.5 w-3.5" />
                Export Customers CSV
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleTabChange('leads')}>
                <Users className="h-4 w-4 mr-1 text-primary" />
                View Leads Pipeline
              </Button>
            </div>
          }
        />
      )}

      {/* Primary Top Tab Switcher: Separate Leads vs Customers */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleTabChange('leads')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all border',
              activeTab === 'leads'
                ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                : 'bg-card text-muted-foreground border-border hover:bg-secondary hover:text-foreground'
            )}
          >
            <Users className="h-4 w-4" />
            <span>Leads CRM</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded-full font-bold',
                activeTab === 'leads'
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {prospectsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('customers')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all border',
              activeTab === 'customers'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-card text-muted-foreground border-border hover:bg-secondary hover:text-foreground'
            )}
          >
            <UserCheck className="h-4 w-4" />
            <span>Customers (Flat Buyers)</span>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded-full font-bold',
                activeTab === 'customers' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
              )}
            >
              {customersCount}
            </span>
          </button>
        </div>

        {activeTab === 'leads' && (
          <div
            className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1"
            aria-label="Lead view"
          >
            <Button
              variant={viewMode === 'kanban' ? 'default' : 'ghost'}
              aria-pressed={viewMode === 'kanban'}
              size="sm"
              onClick={() => setViewMode('kanban')}
            >
              <Kanban className="size-4" />
              Board
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              aria-pressed={viewMode === 'table'}
              size="sm"
              onClick={() => setViewMode('table')}
            >
              <List className="size-4" />
              List
            </Button>
          </div>
        )}
      </div>

      {banner && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm flex items-center justify-between gap-3"
        >
          <span>{banner}</span>
          {banner.includes('Customers tab') && activeTab === 'leads' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-emerald-500 text-emerald-700 dark:text-emerald-300 font-semibold"
              onClick={() => handleTabChange('customers')}
            >
              View in Customers Tab →
            </Button>
          )}
        </div>
      )}

      {/* KPI Overview: Leads CRM vs Customers */}
      {activeTab === 'leads' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
            <span className="text-[11px] text-sky-700 dark:text-sky-400 block flex items-center gap-1 font-medium">
              <UserPlus className="h-3 w-3 text-sky-500" />
              Active Prospect Leads
            </span>
            <span className="text-xl font-bold text-sky-700 dark:text-sky-300">{prospectsCount}</span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <span className="text-[11px] text-muted-foreground block flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-500" />
              New Enquiries
            </span>
            <span className="text-xl font-bold text-foreground">
              {prospectLeads.filter((l) => l.stage === 'NEW').length}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <span className="text-[11px] text-muted-foreground block flex items-center gap-1">
              <CalendarClock className="h-3 w-3 text-primary" />
              Site Visited
            </span>
            <span className="text-xl font-bold text-foreground">
              {
                prospectLeads.filter((l) => l.stage === 'VISITED' || l.stage === 'VISIT_SCHEDULED')
                  .length
              }
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <span className="text-[11px] text-muted-foreground block flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              In Negotiation
            </span>
            <span className="text-xl font-bold text-foreground">
              {prospectLeads.filter((l) => l.stage === 'NEGOTIATION').length}
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block flex items-center gap-1 font-medium">
              <Star className="h-3 w-3 fill-emerald-500 text-emerald-500" />
              Verified Customers (Flat Buyers)
            </span>
            <span className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
              {customersCount}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <span className="text-[11px] text-muted-foreground block flex items-center gap-1">
              <Building2 className="h-3 w-3 text-primary" />
              Flats Sold / Booked
            </span>
            <span className="text-xl font-bold text-foreground">
              {bookings.filter(
                (b) =>
                  b.status === 'APPROVED' ||
                  b.status === 'BOOKED' ||
                  b.status === 'AGREEMENT_EXECUTED' ||
                  b.status === 'REGISTERED'
              ).length || customersCount}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <span className="text-[11px] text-muted-foreground block flex items-center gap-1">
              <CalendarClock className="h-3 w-3 text-primary" />
              Customer Visits Completed
            </span>
            <span className="text-xl font-bold text-foreground">
              {
                allVisits.filter(
                  (v) => verifiedCustomers.some((c) => c.id === v.leadId) && v.status === 'COMPLETED'
                ).length
              }
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <span className="text-[11px] text-muted-foreground block flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              Conversion Rate
            </span>
            <span className="text-xl font-bold text-foreground">{conversionRate}%</span>
          </div>
        </div>
      )}

      {/* VIEW A: LEADS CRM (ONLY LEADS) */}
      {activeTab === 'leads' ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative min-w-0 flex-1 sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  aria-label="Search leads"
                  placeholder="Search leads by name, phone, or email"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={stageFilter}
                onValueChange={(value) => setStageFilter(value as LeadStage | 'ALL')}
              >
                <SelectTrigger aria-label="Filter by stage" className="h-8 w-auto min-w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Lead Stages ({matchingLeads.length})</SelectItem>
                  {LEAD_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {stageLabel(stage)} ({stageCounts.get(stage) ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger aria-label="Filter by source" className="h-8 w-auto min-w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Sources</SelectItem>
                  {[...new Set([...sources, ...(sourceFilter === 'ALL' ? [] : [sourceFilter])])].map(
                    (source) => (
                      <SelectItem key={source} value={source}>
                        {stageLabel(source)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>

              <Select value={qualFilter} onValueChange={setQualFilter}>
                <SelectTrigger
                  aria-label="Filter by qualification"
                  className="h-8 w-auto min-w-36 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Qualifications</SelectItem>
                  {[
                    ...new Set([...qualificationOptions, ...(qualFilter === 'ALL' ? [] : [qualFilter])]),
                  ].map((status) => (
                    <SelectItem key={status} value={status}>
                      {stageLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasLeadFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={clearLeadFilters}>
                  Clear filters
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p role="status" className="text-xs text-muted-foreground">
                Showing {filteredLeads.length} of {prospectsCount} active leads (customers excluded)
              </p>
              <PermissionGate permission="leads:assign">
                {members.some((member) => member.status === 'ACTIVE') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={bulkAgentUid} onValueChange={setBulkAgentUid}>
                      <SelectTrigger aria-label="Choose assignee" className="h-8 w-36 text-xs">
                        <SelectValue placeholder="Choose assignee" />
                      </SelectTrigger>
                      <SelectContent>
                        {members
                          .filter((member) => member.status === 'ACTIVE')
                          .map((member) => (
                            <SelectItem key={member.uid} value={member.uid}>
                              {member.displayName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!bulkAgentUid || busy || !filteredLeads.length}
                      onClick={handleBulkAssign}
                    >
                      Assign shown ({Math.min(50, filteredLeads.length)})
                    </Button>
                  </div>
                )}
              </PermissionGate>
            </div>
          </div>

          {prospectLeads.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No prospect leads in pipeline"
              description="Add an enquiry or share a lead capture form to start filling your pipeline. Converted buyers are in the Customers tab."
              secondaryAction={
                <PermissionGate permission="leads:create">
                  <Button onClick={() => setCreateOpen(true)}>Add Lead</Button>
                </PermissionGate>
              }
            />
          ) : viewMode === 'kanban' ? (
            <LeadsKanban
              stages={stageFilter === 'ALL' ? LEAD_STAGES : [stageFilter]}
              leads={filteredLeads}
              pending={pendingStageId}
              canMove={canMove}
              onOpen={(lead) => {
                setStageError(null);
                setSelectedLead(lead);
              }}
              onMove={requestStageMove}
            />
          ) : (
            <DataTable
              data={filteredLeads}
              showSearch={false}
              emptyMessage="No prospect leads match these filters."
              columns={[
                {
                  id: 'customerType',
                  header: 'Type',
                  cell: () => (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-950 px-2 py-0.5 text-[9px] font-bold text-sky-800 dark:text-sky-300">
                      <UserPlus className="h-2.5 w-2.5 text-sky-600" />
                      Prospect
                    </span>
                  ),
                },
                { accessorKey: 'customerName', header: 'Lead Name' },
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
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1"
                        title="Convert to verified Flat Buyer Customer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenConvertModal(row.original);
                        }}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Convert to Customer
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setStageError(null);
                          setSelectedLead(row.original);
                        }}
                      >
                        Open Details
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      ) : (
        /* VIEW B: DEDICATED CUSTOMERS DIRECTORY (ONLY FLAT BUYERS) */
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative min-w-0 flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  aria-label="Search customers"
                  placeholder="Search by customer name, phone, email, flat number..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={customerProjectFilter}
                  onValueChange={setCustomerProjectFilter}
                >
                  <SelectTrigger className="h-9 w-44 text-xs">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {query && (
                  <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
            <div className="border-t border-border pt-2 text-xs text-muted-foreground flex items-center justify-between">
              <span>
                Showing {matchingCustomers.length} of {customersCount} verified buyer customer(s)
              </span>
              <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                ★ All contacts here have purchased or booked a flat
              </span>
            </div>
          </div>

          {verifiedCustomers.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title="No verified customers yet"
              description="Customers are individuals who have purchased or booked a flat. Convert leads from the Leads CRM tab or book a unit to list them here."
              secondaryAction={
                <Button onClick={() => handleTabChange('leads')}>
                  Go to Leads CRM to Convert Prospects
                </Button>
              }
            />
          ) : (
            <DataTable
              data={matchingCustomers}
              showSearch={false}
              emptyMessage="No customers match your search criteria."
              columns={[
                {
                  id: 'customer',
                  header: 'Customer (Flat Buyer)',
                  cell: ({ row }) => {
                    const c = row.original;
                    return (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/builder/customers/${c.id}`)}
                            className="font-semibold text-primary hover:underline text-left cursor-pointer flex items-center gap-1 group"
                            title="Click to view Customer 360° Page"
                          >
                            <span>{c.customerName}</span>
                            <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                          </button>
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[9px] font-bold text-emerald-800 dark:text-emerald-300">
                            <Star className="h-2.5 w-2.5 fill-emerald-600 text-emerald-600" />
                            Flat Buyer
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.normalizedPhone || c.phone}
                          {c.email ? ` • ${c.email}` : ''}
                        </div>
                      </div>
                    );
                  },
                },
                {
                  id: 'purchasedFlat',
                  header: 'Purchased Flat / Unit',
                  cell: ({ row }) => {
                    const flat = getCustomerFlat(row.original);
                    const proj = projects.find((p) => p.id === row.original.projectId);
                    if (flat) {
                      return (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                            Flat {flat.unitNumber}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {flat.towerName} {flat.bhk ? `• ${flat.bhk}` : ''}{' '}
                            {proj ? `• ${proj.name}` : ''}
                          </div>
                          {flat.priceInr ? (
                            <div className="text-[11px] font-medium text-foreground">
                              {formatInrCompact(flat.priceInr)}
                            </div>
                          ) : null}
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <div className="italic">Booking token confirmed</div>
                        {proj ? <div>{proj.name}</div> : null}
                      </div>
                    );
                  },
                },
                {
                  id: 'status',
                  header: 'Status',
                  cell: ({ row }) => {
                    const flat = getCustomerFlat(row.original);
                    return <StatusBadge status={flat?.status || 'BOOKED'} />;
                  },
                },
                {
                  id: 'convertedAt',
                  header: 'Customer Since',
                  cell: ({ row }) => {
                    const dt = row.original.customerConvertedAt || row.original.updatedAt;
                    return (
                      <div className="text-xs text-muted-foreground">
                        {new Date(dt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    );
                  },
                },
                {
                  id: 'rm',
                  header: 'Assigned RM',
                  cell: ({ row }) => {
                    const mem = members.find((m) => m.uid === row.original.assignedAgentUid);
                    return (
                      <div className="text-xs text-muted-foreground">
                        {mem?.displayName || 'Unassigned'}
                      </div>
                    );
                  },
                },
                {
                  id: 'visits',
                  header: 'Site Visits',
                  cell: ({ row }) => {
                    const vCount = allVisits.filter((v) => v.leadId === row.original.id).length;
                    return (
                      <div className="text-xs font-medium text-foreground flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5 text-primary" />
                        {vCount} {vCount === 1 ? 'visit' : 'visits'}
                      </div>
                    );
                  },
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  cell: ({ row }) => {
                    const cust = row.original;
                    return (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1"
                          onClick={() => navigate(`/builder/customers/${cust.id}`)}
                          title="View customer payment details, list view and pendings"
                        >
                          <ReceiptIndianRupee className="h-3 w-3" />
                          Payments &amp; Cycle
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs font-semibold text-primary border-primary/40 hover:bg-primary/10 gap-1"
                          onClick={() => navigate(`/builder/customers/${cust.id}`)}
                          title="Open complete Customer 360° Page"
                        >
                          <UserCheck className="h-3 w-3" />
                          Customer 360°
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => {
                            const n = encodeURIComponent(cust.customerName);
                            const p = encodeURIComponent(cust.phone || cust.normalizedPhone);
                            navigate(
                              `/builder/visits?leadId=${cust.id}&name=${n}&phone=${p}`
                            );
                          }}
                        >
                          <CalendarClock className="h-3 w-3 text-primary" />
                          Visit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="Open WhatsApp"
                          onClick={() => handleStartWhatsApp(cust)}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      )}

      {/* Lead / Customer 360° Detail Dialog */}
      <Dialog
        open={Boolean(selectedLead)}
        onOpenChange={(o) => {
          if (!o) {
            setSelectedLead(null);
            if (searchParams.has('leadId')) {
              const next = new URLSearchParams(searchParams);
              next.delete('leadId');
              setSearchParams(next, { replace: true });
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          {selectedLead && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between pr-6 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-lg">{selectedLead.customerName}</DialogTitle>
                    {isCustomer(selectedLead) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                        <Star className="h-3 w-3 fill-emerald-600 text-emerald-600" />
                        Verified Customer (Flat Buyer)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-950 px-2.5 py-0.5 text-[10px] font-bold text-sky-800 dark:text-sky-300">
                        <UserPlus className="h-3 w-3 text-sky-600" />
                        Prospect Enquiry
                      </span>
                    )}
                  </div>
                  <StatusBadge status={selectedLead.stage} />
                </div>
                <DialogDescription>
                  Phone: {selectedLead.normalizedPhone || selectedLead.phone} • Source:{' '}
                  {selectedLead.source} • Score: {selectedLead.leadScore}/100 • Qualification:{' '}
                  {selectedLead.qualificationStatus}
                  {selectedLead.customerConvertedAt && (
                    <span className="block mt-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      ✓ Converted to Customer on{' '}
                      {new Date(selectedLead.customerConvertedAt).toLocaleDateString()}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              {/* If customer, show their purchased flat details */}
              {isCustomer(selectedLead) &&
                (() => {
                  const flat = getCustomerFlat(selectedLead);
                  const proj = projects.find((p) => p.id === selectedLead.projectId);
                  return (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-1 text-xs">
                      <div className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-emerald-600" />
                          Purchased Flat / Unit Record
                        </span>
                        <span className="rounded bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-bold">
                          Verified Flat Buyer
                        </span>
                      </div>
                      {flat ? (
                        <div className="grid grid-cols-2 gap-2 pt-1 text-foreground">
                          <div>
                            <span className="text-muted-foreground">Unit:</span>{' '}
                            <strong className="text-emerald-700 dark:text-emerald-400">
                              Flat {flat.unitNumber}
                            </strong>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Tower:</span> {flat.towerName}
                          </div>
                          {flat.bhk && (
                            <div>
                              <span className="text-muted-foreground">Configuration:</span>{' '}
                              {flat.bhk}
                            </div>
                          )}
                          {flat.priceInr ? (
                            <div>
                              <span className="text-muted-foreground">Value:</span>{' '}
                              {formatInrCompact(flat.priceInr)}
                            </div>
                          ) : null}
                          {proj ? (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Project:</span> {proj.name}
                            </div>
                          ) : null}
                          <div className="col-span-2 pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full h-7 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1.5"
                              onClick={() => navigate('/builder/bookings?tab=bookings')}
                            >
                              <ReceiptIndianRupee className="h-3.5 w-3.5" />
                              View Complete Booking Dossier, Payments & Milestones
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-muted-foreground pt-1">
                          {selectedLead.campaign ||
                            'Customer conversion recorded; booking advance confirmed.'}
                        </div>
                      )}
                    </div>
                  );
                })()}

              <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
                {!isCustomer(selectedLead) && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    disabled={busy}
                    onClick={() => handleOpenConvertModal(selectedLead)}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Convert to Customer
                  </Button>
                )}
                {canMove() && (
                  <Select
                    value={selectedLead.stage}
                    disabled={pendingStageId !== null}
                    onValueChange={(value) => requestStageMove(selectedLead, value as LeadStage)}
                  >
                    <SelectTrigger aria-label="Change lead stage" className="h-8 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STAGES.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {stageLabel(stage)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleStartWhatsApp(selectedLead)}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    const n = encodeURIComponent(selectedLead.customerName);
                    const p = encodeURIComponent(
                      selectedLead.phone || selectedLead.normalizedPhone
                    );
                    navigate(`/builder/visits?leadId=${selectedLead.id}&name=${n}&phone=${p}`);
                    setSelectedLead(null);
                  }}
                >
                  <CalendarClock className="h-3.5 w-3.5 text-primary" />
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
                  AI Qualify
                </Button>
              </div>

              {/* Linked Site Visits History */}
              {leadVisits.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  <div className="text-xs font-semibold text-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 text-primary" />
                      Scheduled Site Visits ({leadVisits.length})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-primary"
                      onClick={() => {
                        const n = encodeURIComponent(selectedLead.customerName);
                        const p = encodeURIComponent(
                          selectedLead.phone || selectedLead.normalizedPhone
                        );
                        navigate(`/builder/visits?leadId=${selectedLead.id}&name=${n}&phone=${p}`);
                        setSelectedLead(null);
                      }}
                    >
                      + Book Another Visit
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    {leadVisits.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between rounded bg-background p-2 border border-border text-xs"
                      >
                        <div>
                          <div className="font-medium text-foreground">
                            {new Date(v.scheduledStartAt).toLocaleString([], {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </div>
                          {v.notes && <div className="text-[11px] text-muted-foreground">{v.notes}</div>}
                        </div>
                        <StatusBadge status={v.status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stageError && <p role="alert" className="text-sm text-destructive">{stageError}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <form onSubmit={handleAddActivity} className="space-y-2.5">
                  <div className="text-xs font-semibold">Log Note, Call, Task or Follow-Up</div>
                  <Select value={actType} onValueChange={(v: any) => setActType(v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
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
                <Input
                  required
                  placeholder="+91 9876543210"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Lead Source *</Label>
                <Select value={leadSource} onValueChange={(v: any) => setLeadSource(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Preferred Project</Label>
                <Select
                  value={prefProjectId || '__NONE__'}
                  onValueChange={(v) => setPrefProjectId(v === '__NONE__' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">Any Project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Max Budget (INR)</Label>
                <Input
                  type="number"
                  min={0}
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>BHK Preference</Label>
                <Input value={bhkPref} onChange={(e) => setBhkPref(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Buying Timeline</Label>
                <Select
                  value={timeline || 'UNSPECIFIED'}
                  onValueChange={(value) =>
                    setTimeline(value === 'UNSPECIFIED' ? '' : (value as typeof timeline))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNSPECIFIED">Not specified</SelectItem>
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
              <Input
                placeholder="Campaign UTM or buyer requirements"
                value={notes || campaign}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setCampaign(e.target.value);
                }}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Create Lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(reasonMove)}
        onOpenChange={(open) => {
          if (!open && !pendingStageId) setReasonMove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as {reasonMove && stageLabel(reasonMove.stage)}</DialogTitle>
            <DialogDescription>
              Add a reason for moving {reasonMove?.lead.customerName}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reasonMove && lostReason.trim().length >= 2)
                void saveStage(reasonMove.lead, reasonMove.stage, lostReason.trim());
            }}
          >
            <Label htmlFor="stage-reason">Reason</Label>
            <Textarea
              id="stage-reason"
              required
              minLength={2}
              maxLength={500}
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value)}
            />
            {stageError && (
              <p role="alert" className="text-sm text-destructive">
                {stageError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(pendingStageId)}
                onClick={() => setReasonMove(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={Boolean(pendingStageId) || lostReason.trim().length < 2}
              >
                Move lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Convert to Customer Modal */}
      <Dialog open={convertModalOpen} onOpenChange={setConvertModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <UserCheck className="h-5 w-5" />
              Convert Lead to Customer
            </DialogTitle>
            <DialogDescription>
              Customers are individuals who purchase a flat. This converts{' '}
              {convertTargetLead?.customerName} from an enquiry prospect to an authorized flat buyer
              customer.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmConvert} className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1">
              <div className="font-bold text-foreground flex items-center justify-between">
                <span>{convertTargetLead?.customerName}</span>
                <span className="text-[10px] rounded bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 font-medium">
                  Ready to Convert
                </span>
              </div>
              <div className="text-muted-foreground">
                Phone: {convertTargetLead?.normalizedPhone || convertTargetLead?.phone}
                {convertTargetLead?.email ? ` • ${convertTargetLead.email}` : ''}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Purchased Flat / Unit Number (Optional)</Label>
              <Input
                placeholder="e.g. Tower 1 - Flat 402"
                value={convertFlat}
                onChange={(e) => setConvertFlat(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Purchase / Conversion Notes</Label>
              <Input
                placeholder="e.g. Booking token received, agreement signing scheduled"
                value={convertNotes}
                onChange={(e) => setConvertNotes(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConvertModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                {busy ? 'Converting...' : 'Confirm Customer Conversion'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
