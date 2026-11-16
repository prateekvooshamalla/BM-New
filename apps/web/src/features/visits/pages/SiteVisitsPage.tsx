import * as React from 'react';
import { CalendarClock, List, Plus } from 'lucide-react';
import type { SiteVisit } from '@bharat-makaan/shared';
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

export function SiteVisitsPage() {
  const { activeOrgId, projects } = useTenantStore();
  const [visits, setVisits] = React.useState<SiteVisit[]>([]);
  const [viewMode, setViewMode] = React.useState<'list' | 'calendar'>('list');
  const [selectedDay, setSelectedDay] = React.useState<Date | undefined>(new Date());

  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [projectId, setProjectId] = React.useState('');
  const [custName, setCustName] = React.useState('');
  const [custPhone, setCustPhone] = React.useState('');
  const [startAt, setStartAt] = React.useState('');
  const [endAt, setEndAt] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!activeOrgId) return;
    if (!projectId && projects[0]) setProjectId(projects[0].id);

    return subscribeTenantCollection<SiteVisit>({
      orgId: activeOrgId,
      collectionName: 'site_visits',
      sort: sortAscByIso<SiteVisit>('scheduledStartAt'),
      onData: setVisits,
    });
  }, [activeOrgId, projectId, projects]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !projectId) return;
    setBusy(true);
    try {
      await callBackendFunction('scheduleSiteVisit', {
        orgId: activeOrgId,
        projectId,
        customerName: custName,
        customerPhone: custPhone,
        scheduledStartAt: new Date(startAt).toISOString(),
        scheduledEndAt: new Date(endAt).toISOString(),
        timezone: 'Asia/Kolkata',
        notes,
      });
      setScheduleOpen(false);
      setCustName('');
      setCustPhone('');
      setBanner('Site visit scheduled with timezone-aware reminder tracking.');
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

  if (!activeOrgId || projects.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No site visits scheduled yet. Book a customer visit to get started."
        description="Create a project first to schedule timezone-aware site visits and automated WhatsApp reminders."
      />
    );
  }

  const dayVisits = selectedDay
    ? visits.filter(
        (v) =>
          new Date(v.scheduledStartAt).toDateString() === selectedDay.toDateString()
      )
    : visits;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Field Sales & Experience Center"
        title="Site Visit Management"
        description="Schedule, confirm, reschedule, and record buyer outcomes across calendar and list views."
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
            <Button size="sm" onClick={() => setScheduleOpen(true)}>
              <Plus className="h-4 w-4" />
              Book Site Visit
            </Button>
          </div>
        }
      />

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
          {banner}
        </div>
      )}

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
                dayVisits.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded-md border border-border p-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold">{v.customerName}</div>
                      <div className="text-muted-foreground">
                        {new Date(v.scheduledStartAt).toLocaleTimeString()} • {v.customerPhone}
                      </div>
                    </div>
                    <StatusBadge status={v.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <DataTable
          data={visits}
          searchPlaceholder="Search visitor name or phone..."
          columns={[
            { accessorKey: 'customerName', header: 'Customer' },
            { accessorKey: 'customerPhone', header: 'Phone' },
            {
              accessorKey: 'scheduledStartAt',
              header: 'Scheduled Slot',
              cell: ({ row }) => new Date(row.original.scheduledStartAt).toLocaleString(),
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
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {v.status === 'SCHEDULED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdateVisit(v, 'CONFIRMED')}
                      >
                        Confirm
                      </Button>
                    )}
                    {(v.status === 'SCHEDULED' || v.status === 'CONFIRMED') && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleUpdateVisit(v, 'COMPLETED', 'VERY_INTERESTED')}
                        >
                          Mark Visited
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
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

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Customer Site Visit</DialogTitle>
            <DialogDescription>
              Stored in UTC with Asia/Kolkata timezone awareness and idempotent reminder dispatch.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSchedule} className="space-y-3">
            <div className="space-y-1">
              <Label>Project *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Visitor Name *</Label>
                <Input required value={custName} onChange={(e) => setCustName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Visitor Phone *</Label>
                <Input required value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Start Time *</Label>
                <Input type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End Time *</Label>
                <Input type="datetime-local" required value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pick-up or model flat preference" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Confirm Visit Slot</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
