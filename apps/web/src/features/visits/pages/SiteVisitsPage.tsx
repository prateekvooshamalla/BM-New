import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Filter,
  List,
  Plus,
  Search,
  Star,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Lead, SiteVisit } from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { sortAscByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Calendar } from '@/components/ui/calendar';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function isLeadCustomer(lead?: Lead | null): boolean {
  if (!lead) return false;
  return Boolean(lead.isCustomer || lead.stage === 'BOOKED' || lead.stage === 'CLOSED');
}

export function SiteVisitsPage() {
  const { activeOrgId, projects } = useTenantStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [visits, setVisits] = React.useState<SiteVisit[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [viewMode, setViewMode] = React.useState<'list' | 'calendar'>('list');
  const [selectedDay, setSelectedDay] = React.useState<Date | undefined>(new Date());
  const [filterContactType, setFilterContactType] = React.useState<'ALL' | 'CUSTOMERS' | 'PROSPECTS'>('ALL');

  // Schedule Modal State
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [contactMode, setContactMode] = React.useState<'EXISTING' | 'NEW'>('EXISTING');
  const [selectedLeadId, setSelectedLeadId] = React.useState<string>('NEW');
  const [contactSearchQuery, setContactSearchQuery] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [custName, setCustName] = React.useState('');
  const [custPhone, setCustPhone] = React.useState('');
  const [custEmail, setCustEmail] = React.useState('');
  const [unitOfInterest, setUnitOfInterest] = React.useState('');
  const [startAt, setStartAt] = React.useState('');
  const [endAt, setEndAt] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Convert to Customer Modal
  const [convertModalOpen, setConvertModalOpen] = React.useState(false);
  const [convertTargetLead, setConvertTargetLead] = React.useState<Lead | null>(null);
  const [convertNotes, setConvertNotes] = React.useState('');
  const [convertFlat, setConvertFlat] = React.useState('');

  // Subscribe to site visits and leads
  React.useEffect(() => {
    if (!activeOrgId) return;
    if (!projectId && projects[0]) setProjectId(projects[0].id);

    const unsubVisits = subscribeTenantCollection<SiteVisit>({
      orgId: activeOrgId,
      collectionName: 'site_visits',
      sort: sortAscByIso<SiteVisit>('scheduledStartAt'),
      onData: setVisits,
    });

    const unsubLeads = subscribeTenantCollection<Lead>({
      orgId: activeOrgId,
      collectionName: 'leads',
      onData: setLeads,
    });

    return () => {
      unsubVisits();
      unsubLeads();
    };
  }, [activeOrgId, projectId, projects]);

  // Handle incoming query parameters (e.g. from Leads CRM "Schedule Site Visit")
  React.useEffect(() => {
    const qLeadId = searchParams.get('leadId');
    const qName = searchParams.get('name');
    const qPhone = searchParams.get('phone');

    if (qLeadId || qName) {
      if (qLeadId && leads.length > 0) {
        const found = leads.find((l) => l.id === qLeadId);
        if (found) {
          setSelectedLeadId(found.id);
          setContactMode('EXISTING');
          setCustName(found.customerName);
          setCustPhone(found.phone || found.normalizedPhone);
          setCustEmail(found.email ?? '');
          if (found.projectId && projects.some((p) => p.id === found.projectId)) {
            setProjectId(found.projectId);
          } else if (found.preferredProjectIds?.[0] && projects.some((p) => p.id === found.preferredProjectIds[0])) {
            setProjectId(found.preferredProjectIds[0]);
          }
        }
      } else if (qName) {
        setContactMode('NEW');
        setSelectedLeadId('NEW');
        setCustName(qName);
        if (qPhone) setCustPhone(qPhone);
      }
      setScheduleOpen(true);
      // Clean query params after opening modal
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, leads, projects, setSearchParams]);

  // Map visit to corresponding lead/customer
  const getMatchedLead = React.useCallback(
    (visit: SiteVisit): Lead | undefined => {
      if (visit.leadId) {
        const byId = leads.find((l) => l.id === visit.leadId);
        if (byId) return byId;
      }
      return leads.find(
        (l) => l.normalizedPhone === visit.customerPhone || l.phone === visit.customerPhone
      );
    },
    [leads]
  );

  // Group contacts into Verified Customers (Flat Buyers) and Prospects (Enquiries)
  const customers = React.useMemo(() => leads.filter(isLeadCustomer), [leads]);
  const prospects = React.useMemo(() => leads.filter((l) => !isLeadCustomer(l)), [leads]);

  const filteredContacts = React.useMemo(() => {
    if (!contactSearchQuery.trim()) return leads;
    const q = contactSearchQuery.trim().toLowerCase();
    return leads.filter(
      (l) =>
        l.customerName.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.normalizedPhone?.includes(q) ||
        (l.email && l.email.toLowerCase().includes(q))
    );
  }, [leads, contactSearchQuery]);

  const handleSelectContact = (leadId: string) => {
    setSelectedLeadId(leadId);
    if (leadId === 'NEW') {
      setContactMode('NEW');
      setCustName('');
      setCustPhone('');
      setCustEmail('');
    } else {
      setContactMode('EXISTING');
      const lead = leads.find((l) => l.id === leadId);
      if (lead) {
        setCustName(lead.customerName);
        setCustPhone(lead.phone || lead.normalizedPhone);
        setCustEmail(lead.email ?? '');
        if (lead.projectId && projects.some((p) => p.id === lead.projectId)) {
          setProjectId(lead.projectId);
        } else if (lead.preferredProjectIds?.[0] && projects.some((p) => p.id === lead.preferredProjectIds[0])) {
          setProjectId(lead.preferredProjectIds[0]);
        }
      }
    }
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !projectId) return;
    setBusy(true);
    try {
      const fullNotes = [
        unitOfInterest ? `Visiting Flat: ${unitOfInterest.trim()}` : '',
        notes.trim(),
      ]
        .filter(Boolean)
        .join(' | ');

      await callBackendFunction('scheduleSiteVisit', {
        orgId: activeOrgId,
        projectId,
        leadId: selectedLeadId !== 'NEW' ? selectedLeadId : undefined,
        customerName: custName.trim(),
        customerPhone: custPhone.trim(),
        customerEmail: custEmail.trim() || undefined,
        scheduledStartAt: new Date(startAt).toISOString(),
        scheduledEndAt: new Date(endAt).toISOString(),
        timezone: 'Asia/Kolkata',
        notes: fullNotes || undefined,
      });

      setScheduleOpen(false);
      setCustName('');
      setCustPhone('');
      setCustEmail('');
      setUnitOfInterest('');
      setNotes('');
      setSelectedLeadId('NEW');
      setBanner('Site visit scheduled successfully with calendar & WhatsApp tracking.');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to schedule visit.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateVisit = async (
    visit: SiteVisit,
    status: SiteVisit['status'],
    outcome?: SiteVisit['outcome']
  ) => {
    if (!activeOrgId) return;
    try {
      await callBackendFunction('updateSiteVisitOutcome', {
        orgId: activeOrgId,
        visitId: visit.id,
        status,
        outcome,
      });
      setBanner(`Updated visit for ${visit.customerName} to ${status}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  const handleConvertToCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !convertTargetLead) return;
    setBusy(true);
    try {
      const noteText = convertFlat.trim()
        ? `${convertNotes.trim()} (Purchased Flat: ${convertFlat.trim()})`
        : convertNotes.trim();

      const updated = await callBackendFunction<any, Lead>('convertLeadToCustomer', {
        orgId: activeOrgId,
        leadId: convertTargetLead.id,
        notes: noteText || 'Converted from Prospect to verified Flat Buyer Customer after Site Visit.',
      });

      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setConvertModalOpen(false);
      setConvertTargetLead(null);
      setConvertNotes('');
      setConvertFlat('');
      setBanner(`Successfully converted "${convertTargetLead.customerName}" to a verified Flat Buyer Customer!`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to convert lead to customer.');
    } finally {
      setBusy(false);
    }
  };

  // Filtered visits based on Contact Type (All, Customers, Prospects)
  const filteredVisits = React.useMemo(() => {
    return visits.filter((v) => {
      if (filterContactType === 'ALL') return true;
      const matched = getMatchedLead(v);
      const isCust = isLeadCustomer(matched);
      if (filterContactType === 'CUSTOMERS') return isCust;
      if (filterContactType === 'PROSPECTS') return !isCust;
      return true;
    });
  }, [visits, filterContactType, getMatchedLead]);

  const customerVisitsCount = React.useMemo(
    () => visits.filter((v) => isLeadCustomer(getMatchedLead(v))).length,
    [visits, getMatchedLead]
  );
  const prospectVisitsCount = React.useMemo(
    () => visits.filter((v) => !isLeadCustomer(getMatchedLead(v))).length,
    [visits, getMatchedLead]
  );
  const completedVisitsCount = React.useMemo(
    () => visits.filter((v) => v.status === 'COMPLETED').length,
    [visits]
  );

  const dayVisits = selectedDay
    ? filteredVisits.filter(
        (v) => new Date(v.scheduledStartAt).toDateString() === selectedDay.toDateString()
      )
    : filteredVisits;

  if (!activeOrgId || projects.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No site visits scheduled yet. Book a customer visit to get started."
        description="Create a project first to schedule timezone-aware site visits and automated WhatsApp reminders."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Field Sales & Experience Center"
        title="Site Visit Management"
        description="Schedule and track visits from existing leads and buyer customers, and record outcomes."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('list')}
            >
              <List className="h-3.5 w-3.5" />
              List View
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('calendar')}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Calendar View
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSelectedLeadId('NEW');
                setContactMode('EXISTING');
                setCustName('');
                setCustPhone('');
                setCustEmail('');
                setScheduleOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Book Site Visit
            </Button>
          </div>
        }
      />

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs text-foreground">
          {banner}
        </div>
      )}

      {/* Summary KPI Cards & Contact Differentiation Filter */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3 bg-card border-border">
          <span className="text-[11px] text-muted-foreground block">Total Scheduled Visits</span>
          <span className="text-xl font-bold text-foreground">{visits.length}</span>
        </Card>
        <Card className="p-3 bg-emerald-500/5 border-emerald-500/20">
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block flex items-center gap-1 font-medium">
            <Star className="h-3 w-3 fill-emerald-500 text-emerald-500" />
            Customer Visits (Buyers)
          </span>
          <span className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
            {customerVisitsCount}
          </span>
        </Card>
        <Card className="p-3 bg-sky-500/5 border-sky-500/20">
          <span className="text-[11px] text-sky-700 dark:text-sky-400 block flex items-center gap-1 font-medium">
            <Users className="h-3 w-3 text-sky-500" />
            Prospect Visits (Leads)
          </span>
          <span className="text-xl font-bold text-sky-700 dark:text-sky-300">
            {prospectVisitsCount}
          </span>
        </Card>
        <Card className="p-3 bg-card border-border">
          <span className="text-[11px] text-muted-foreground block flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-primary" />
            Completed Tours
          </span>
          <span className="text-xl font-bold text-foreground">{completedVisitsCount}</span>
        </Card>
      </div>

      {/* Contact Type Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mr-1">
            <Filter className="h-3.5 w-3.5" /> Filter by:
          </span>
          <Button
            variant={filterContactType === 'ALL' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilterContactType('ALL')}
          >
            All Visits ({visits.length})
          </Button>
          <Button
            variant={filterContactType === 'CUSTOMERS' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs gap-1 text-emerald-800 dark:text-emerald-300"
            onClick={() => setFilterContactType('CUSTOMERS')}
          >
            <Star className="h-3 w-3 fill-emerald-500 text-emerald-500" />
            Customers Only ({customerVisitsCount})
          </Button>
          <Button
            variant={filterContactType === 'PROSPECTS' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs gap-1 text-sky-800 dark:text-sky-300"
            onClick={() => setFilterContactType('PROSPECTS')}
          >
            <Users className="h-3 w-3 text-sky-500" />
            Prospect Leads ({prospectVisitsCount})
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          Showing <strong>{filteredVisits.length}</strong> site visits
        </div>
      </div>

      {visits.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No site visits scheduled yet. Book a customer visit to get started."
          description="Assign relationship managers, track confirmations, and log post-visit outcomes."
          actionLabel="Book First Site Visit"
          onAction={() => setScheduleOpen(true)}
        />
      ) : viewMode === 'calendar' ? (
        <div className="grid gap-6 md:grid-cols-12">
          <div className="md:col-span-5">
            <Calendar mode="single" selected={selectedDay} onSelect={setSelectedDay} />
          </div>
          <Card className="md:col-span-7">
            <CardHeader>
              <CardTitle className="text-sm">
                Visits on {selectedDay?.toDateString() ?? 'Selected Date'} ({dayVisits.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {dayVisits.length === 0 ? (
                <p className="text-xs text-muted-foreground">No visits scheduled on this date.</p>
              ) : (
                dayVisits.map((v) => {
                  const matched = getMatchedLead(v);
                  const isCust = isLeadCustomer(matched);
                  return (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-md border border-border p-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{v.customerName}</span>
                          {isCust ? (
                            <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[9px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-0.5">
                              <Star className="h-2.5 w-2.5 fill-emerald-600 text-emerald-600" />
                              Customer (Buyer)
                            </span>
                          ) : matched ? (
                            <span className="rounded-full bg-sky-100 dark:bg-sky-950 px-2 py-0.5 text-[9px] font-bold text-sky-800 dark:text-sky-300">
                              Prospect
                            </span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                              Walk-in
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {new Date(v.scheduledStartAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          • {v.customerPhone}
                          {v.notes ? ` • ${v.notes}` : ''}
                        </div>
                      </div>
                      <StatusBadge status={v.status} />
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <DataTable
          data={filteredVisits}
          searchPlaceholder="Search visitor name or phone..."
          columns={[
            {
              id: 'visitorType',
              header: 'Visitor Type',
              cell: ({ row }) => {
                const matched = getMatchedLead(row.original);
                const isCust = isLeadCustomer(matched);
                if (isCust) {
                  return (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                      <Star className="h-3 w-3 fill-emerald-600 text-emerald-600 shrink-0" />
                      Customer (Flat Buyer)
                    </span>
                  );
                }
                if (matched) {
                  return (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-950 px-2.5 py-0.5 text-[10px] font-bold text-sky-800 dark:text-sky-300">
                      <Users className="h-3 w-3 text-sky-600 shrink-0" />
                      Prospect Lead
                    </span>
                  );
                }
                return (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Walk-in Visitor
                  </span>
                );
              },
            },
            {
              accessorKey: 'customerName',
              header: 'Customer / Lead Name',
              cell: ({ row }) => (
                <div className="font-semibold text-foreground">
                  {row.original.customerName}
                </div>
              ),
            },
            { accessorKey: 'customerPhone', header: 'Phone Number' },
            {
              accessorKey: 'scheduledStartAt',
              header: 'Scheduled Slot',
              cell: ({ row }) => (
                <span className="font-mono text-xs">
                  {new Date(row.original.scheduledStartAt).toLocaleString([], {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              ),
            },
            {
              accessorKey: 'status',
              header: 'Status',
              cell: ({ row }) => <StatusBadge status={row.original.status} />,
            },
            {
              accessorKey: 'outcome',
              header: 'Outcome',
              cell: ({ row }) => row.original.outcome?.replace(/_/g, ' ') || '—',
            },
            {
              id: 'actions',
              header: 'Actions',
              cell: ({ row }) => {
                const v = row.original;
                const matched = getMatchedLead(v);
                const isCust = isLeadCustomer(matched);

                return (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Option to convert prospect to customer right from site visit! */}
                    {matched && !isCust && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1 font-semibold"
                        title="Convert prospect to verified buyer Customer"
                        onClick={() => {
                          setConvertTargetLead(matched);
                          setConvertNotes(
                            `Site visit conducted on ${new Date(v.scheduledStartAt).toLocaleDateString()}. Converted to buyer customer.`
                          );
                          setConvertFlat('');
                          setConvertModalOpen(true);
                        }}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Convert to Customer
                      </Button>
                    )}

                    {v.status === 'SCHEDULED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleUpdateVisit(v, 'CONFIRMED')}
                      >
                        Confirm
                      </Button>
                    )}
                    {(v.status === 'SCHEDULED' || v.status === 'CONFIRMED') && (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-primary text-primary-foreground font-semibold"
                          onClick={() => handleUpdateVisit(v, 'COMPLETED', 'VERY_INTERESTED')}
                        >
                          Mark Visited
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => handleUpdateVisit(v, 'CANCELLED')}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      )}

      {/* Book Site Visit Modal with Existing Leads & Customers selection */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              Schedule Site Visit
            </DialogTitle>
            <DialogDescription>
              Select from existing buyer customers or prospect leads, or register a new walk-in visitor.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSchedule} className="space-y-4">
            {/* Step 1: Select Visitor Source (Existing Leads/Customers vs New) */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  Select Contact Source *
                </Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={contactMode === 'EXISTING' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => {
                      setContactMode('EXISTING');
                      if (leads[0]) handleSelectContact(leads[0].id);
                    }}
                  >
                    Existing Contact
                  </Button>
                  <Button
                    type="button"
                    variant={contactMode === 'NEW' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => {
                      setContactMode('NEW');
                      setSelectedLeadId('NEW');
                      setCustName('');
                      setCustPhone('');
                      setCustEmail('');
                    }}
                  >
                    + Walk-in Visitor
                  </Button>
                </div>
              </div>

              {contactMode === 'EXISTING' && (
                <div className="space-y-2 pt-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search existing customer or prospect by name / phone..."
                      value={contactSearchQuery}
                      onChange={(e) => setContactSearchQuery(e.target.value)}
                      className="pl-8 h-8 text-xs"
                    />
                  </div>

                  <Select value={selectedLeadId} onValueChange={handleSelectContact}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Choose Customer or Prospect" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="NEW">+ Register as New Walk-in</SelectItem>

                      {filteredContacts.filter(isLeadCustomer).length > 0 && (
                        <div className="px-2 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 rounded-sm my-1">
                          ⭐ VERIFIED CUSTOMERS (FLAT BUYERS)
                        </div>
                      )}
                      {filteredContacts
                        .filter(isLeadCustomer)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            ⭐ {c.customerName} ({c.phone || c.normalizedPhone})
                          </SelectItem>
                        ))}

                      {filteredContacts.filter((l) => !isLeadCustomer(l)).length > 0 && (
                        <div className="px-2 py-1 text-[10px] font-bold text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 rounded-sm my-1">
                          👥 PROSPECT LEADS (ENQUIRIES)
                        </div>
                      )}
                      {filteredContacts
                        .filter((l) => !isLeadCustomer(l))
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            👥 {p.customerName} ({p.phone || p.normalizedPhone})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {/* Selected Contact Status Card */}
                  {selectedLeadId !== 'NEW' && (
                    <div className="rounded border border-border bg-background p-2.5 text-xs flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                          {custName}
                          {isLeadCustomer(leads.find((l) => l.id === selectedLeadId)) ? (
                            <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[9px] font-bold text-emerald-800 dark:text-emerald-300">
                              ⭐ Verified Customer
                            </span>
                          ) : (
                            <span className="rounded-full bg-sky-100 dark:bg-sky-950 px-2 py-0.5 text-[9px] font-bold text-sky-800 dark:text-sky-300">
                              Prospect Lead
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground text-[11px] mt-0.5">
                          Phone: {custPhone} {custEmail ? `• Email: ${custEmail}` : ''}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px]"
                        onClick={() => {
                          setContactMode('NEW');
                          setSelectedLeadId('NEW');
                        }}
                      >
                        Edit / Change
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Project Selection */}
            <div className="space-y-1">
              <Label className="text-xs">Project Site *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select Project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.city})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Visitor Details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Visitor Name *</Label>
                <Input
                  required
                  placeholder="e.g., Rajesh Kumar"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Visitor Mobile Number *</Label>
                <Input
                  required
                  placeholder="+91 9876543210"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email Address (Optional)</Label>
                <Input
                  type="email"
                  placeholder="client@example.com"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Specific Flat / Unit of Interest</Label>
                <Input
                  placeholder="e.g., Tower 1 Flat 304 or 3 BHK"
                  value={unitOfInterest}
                  onChange={(e) => setUnitOfInterest(e.target.value)}
                />
              </div>
            </div>

            {/* Visit Time Slot */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Visit Start Date & Time *</Label>
                <Input
                  type="datetime-local"
                  required
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Visit End Date & Time *</Label>
                <Input
                  type="datetime-local"
                  required
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Visit Notes / Logistics</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Pick-up needed, sample flat walkthrough, pricing negotiation"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="font-semibold">
                {busy ? 'Scheduling...' : 'Confirm Visit Slot'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Convert Prospect to Customer Dialog */}
      <Dialog open={convertModalOpen} onOpenChange={setConvertModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <UserCheck className="h-5 w-5" />
              Convert Lead to Customer
            </DialogTitle>
            <DialogDescription>
              Customers are buyers who purchase a flat. This converts {convertTargetLead?.customerName} from an enquiry prospect to a verified flat buyer.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConvertToCustomer} className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1">
              <div className="font-bold text-foreground">{convertTargetLead?.customerName}</div>
              <div className="text-muted-foreground">
                Phone: {convertTargetLead?.normalizedPhone || convertTargetLead?.phone}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Purchased Flat / Unit Number (Optional)</Label>
              <Input
                placeholder="e.g. Tower 1 - Flat 502"
                value={convertFlat}
                onChange={(e) => setConvertFlat(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Conversion / Booking Notes</Label>
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
