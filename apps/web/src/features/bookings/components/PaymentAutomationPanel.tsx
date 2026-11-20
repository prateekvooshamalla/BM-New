import * as React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  User,
  Zap,
} from 'lucide-react';
import {
  formatInr,
  formatInrCompact,
  type Booking,
  type CollectionRecord,
  type PaymentReminderRecord,
} from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ReminderTargetItem {
  id: string; // unique key
  bookingId: string;
  collectionRecordId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  unitNumber: string;
  milestoneName: string;
  amountDueInr: number;
  dueDate?: string;
  category: 'OVERDUE' | 'DUE_SOON' | 'TOKEN_PENDING';
  daysOverdue?: number;
  daysUntilDue?: number;
  lastReminderSentAt?: string;
  reminderCount?: number;
}

interface PaymentAutomationPanelProps {
  orgId: string;
  projectId?: string | null;
  bookings: Booking[];
  collections: CollectionRecord[];
  reminders: PaymentReminderRecord[];
  onOpenRecordPayment: (booking: Booking, collection?: CollectionRecord) => void;
  onRefresh?: () => void;
}

export function PaymentAutomationPanel({
  orgId,
  projectId,
  bookings,
  collections,
  reminders,
  onOpenRecordPayment,
}: PaymentAutomationPanelProps) {
  const [subTab, setSubTab] = React.useState<'whom-to-remind' | 'overdue' | 'yet-to-pay' | 'activities'>('whom-to-remind');
  const [search, setSearch] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionBanner, setActionBanner] = React.useState<string | null>(null);

  const nowTime = Date.now();

  // Active (non-cancelled) bookings
  const activeBookings = React.useMemo(
    () => bookings.filter((b) => b.status !== 'CANCELLED'),
    [bookings]
  );

  // 1. Compute Overdue Targets (Crossed Deadline)
  const overdueTargets = React.useMemo<ReminderTargetItem[]>(() => {
    const list: ReminderTargetItem[] = [];
    for (const col of collections) {
      if (col.status !== 'DUE' && col.recordType !== 'MILESTONE_DEMAND') continue;
      const amountDue = col.demandAmountInr - (col.paidAmountInr || 0);
      if (amountDue <= 0) continue;
      if (!col.dueDate) continue;

      const dueMs = new Date(col.dueDate).getTime();
      if (dueMs < nowTime) {
        const bk = bookings.find((b) => b.id === col.bookingId);
        if (!bk || bk.status === 'CANCELLED') continue;

        const days = Math.max(1, Math.floor((nowTime - dueMs) / 86400000));
        list.push({
          id: col.id,
          bookingId: bk.id,
          collectionRecordId: col.id,
          customerName: bk.customer.fullName,
          customerPhone: bk.customer.phone,
          customerEmail: bk.customer.email,
          unitNumber: bk.unitNumber,
          milestoneName: col.milestoneName,
          amountDueInr: amountDue,
          dueDate: col.dueDate,
          category: 'OVERDUE',
          daysOverdue: days,
          lastReminderSentAt: (col as any).lastReminderSentAt,
          reminderCount: (col as any).reminderCount,
        });
      }
    }
    return list.sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
  }, [collections, bookings, nowTime]);

  // 2. Compute Yet to Pay Targets (Due in next 15 days, or pending initial token)
  const yetToPayTargets = React.useMemo<ReminderTargetItem[]>(() => {
    const list: ReminderTargetItem[] = [];

    // Milestone demands due soon
    for (const col of collections) {
      if (col.status !== 'DUE' && col.recordType !== 'MILESTONE_DEMAND') continue;
      const amountDue = col.demandAmountInr - (col.paidAmountInr || 0);
      if (amountDue <= 0) continue;

      const dueMs = col.dueDate ? new Date(col.dueDate).getTime() : 0;
      if (dueMs >= nowTime || !col.dueDate) {
        const bk = bookings.find((b) => b.id === col.bookingId);
        if (!bk || bk.status === 'CANCELLED') continue;

        const daysUntil = dueMs > 0 ? Math.max(0, Math.ceil((dueMs - nowTime) / 86400000)) : undefined;
        list.push({
          id: col.id,
          bookingId: bk.id,
          collectionRecordId: col.id,
          customerName: bk.customer.fullName,
          customerPhone: bk.customer.phone,
          customerEmail: bk.customer.email,
          unitNumber: bk.unitNumber,
          milestoneName: col.milestoneName,
          amountDueInr: amountDue,
          dueDate: col.dueDate,
          category: 'DUE_SOON',
          daysUntilDue: daysUntil,
          lastReminderSentAt: (col as any).lastReminderSentAt,
          reminderCount: (col as any).reminderCount,
        });
      }
    }

    // Bookings with pending token where no collection record exists yet
    for (const bk of activeBookings) {
      if (bk.totalCollectedVerifiedInr === 0 && bk.outstandingBalanceInr > 0) {
        const hasCol = collections.some((c) => c.bookingId === bk.id);
        if (!hasCol) {
          list.push({
            id: `bk_${bk.id}`,
            bookingId: bk.id,
            customerName: bk.customer.fullName,
            customerPhone: bk.customer.phone,
            customerEmail: bk.customer.email,
            unitNumber: bk.unitNumber,
            milestoneName: 'Booking Token Advance',
            amountDueInr: bk.tokenAmountExpectedInr || bk.outstandingBalanceInr,
            dueDate: bk.bookedAt || bk.createdAt,
            category: 'TOKEN_PENDING',
          });
        }
      }
    }

    return list.sort((a, b) => (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999));
  }, [collections, activeBookings, bookings, nowTime]);

  // 3. Whom Should We Remind (Aggregated Smart Priority Queue)
  const whomToRemindList = React.useMemo<ReminderTargetItem[]>(() => {
    // Top priority: Overdue, followed by Due Soon (< 7 days)
    return [...overdueTargets, ...yetToPayTargets];
  }, [overdueTargets, yetToPayTargets]);

  // Search filter
  const filterBySearch = (items: ReminderTargetItem[]) => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        item.customerName.toLowerCase().includes(q) ||
        item.unitNumber.toLowerCase().includes(q) ||
        item.customerPhone.includes(q) ||
        item.milestoneName.toLowerCase().includes(q)
    );
  };

  // Dispatch single reminder
  const handleSendReminder = async (item: ReminderTargetItem, channel: 'WHATSAPP' | 'EMAIL' = 'WHATSAPP') => {
    setBusy(true);
    setActionBanner(null);
    try {
      const res = await callBackendFunction<any, { success: boolean; message: string; customerPhone: string }>(
        'sendPaymentReminder',
        {
          orgId,
          bookingId: item.bookingId,
          collectionRecordId: item.collectionRecordId,
          channel,
        }
      );

      setActionBanner(`✓ Reminder dispatched to ${item.customerName} (${item.unitNumber}) via ${channel}!`);

      if (channel === 'WHATSAPP') {
        const text = encodeURIComponent(res.message);
        const cleanPhone = item.customerPhone.replace(/[^0-9]/g, '');
        window.open(`https://wa.me/${cleanPhone}?text=${text}`, '_blank');
      }
    } catch (err) {
      setActionBanner(err instanceof Error ? err.message : 'Failed to send payment reminder.');
    } finally {
      setBusy(false);
    }
  };

  // Dispatch batch reminders
  const handleBatchRemind = async (filterType: 'OVERDUE' | 'DUE_SOON') => {
    setBusy(true);
    setActionBanner(null);
    try {
      const res = await callBackendFunction<any, { sentCount: number }>(
        'sendBatchPaymentReminders',
        {
          orgId,
          projectId: projectId || undefined,
          filterType,
        }
      );
      setActionBanner(`✓ Successfully dispatched ${res.sentCount} automated reminder(s) to ${filterType === 'OVERDUE' ? 'overdue clients' : 'upcoming clients'}!`);
    } catch (err) {
      setActionBanner(err instanceof Error ? err.message : 'Batch reminder failed.');
    } finally {
      setBusy(false);
    }
  };

  // Upcoming Activities (Future deadlines)
  const upcomingActivities = React.useMemo(() => {
    const list: Array<{
      id: string;
      dueDate: string;
      customerName: string;
      unitNumber: string;
      milestoneName: string;
      amountDueInr: number;
      bookingId: string;
      collectionRecordId?: string;
    }> = [];

    for (const c of collections) {
      if (c.status === 'DUE' && c.dueDate && new Date(c.dueDate).getTime() >= nowTime) {
        const bk = bookings.find((b) => b.id === c.bookingId);
        if (bk && bk.status !== 'CANCELLED') {
          list.push({
            id: c.id,
            dueDate: c.dueDate,
            customerName: bk.customer.fullName,
            unitNumber: bk.unitNumber,
            milestoneName: c.milestoneName,
            amountDueInr: c.demandAmountInr - (c.paidAmountInr || 0),
            bookingId: bk.id,
            collectionRecordId: c.id,
          });
        }
      }
    }

    return list.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [collections, bookings, nowTime]);

  // Past Activities (Reminders sent + Collections received)
  const pastActivities = React.useMemo(() => {
    const combined: Array<{
      id: string;
      timestamp: string;
      type: 'REMINDER_SENT' | 'PAYMENT_RECEIVED' | 'BOOKING_CREATED';
      title: string;
      description: string;
      amountInr?: number;
      badge: string;
      badgeVariant: 'default' | 'success' | 'warning' | 'destructive';
    }> = [];

    // Historical reminders sent
    for (const rem of reminders) {
      combined.push({
        id: `rem_${rem.id}`,
        timestamp: rem.sentAt || rem.createdAt,
        type: 'REMINDER_SENT',
        title: `Payment Reminder sent to ${rem.customerName}`,
        description: `Unit ${rem.unitNumber} • ${rem.milestoneName} • Via ${rem.channel}`,
        amountInr: rem.amountDueInr,
        badge: rem.isOverdue ? 'Overdue Reminder' : 'Due Reminder',
        badgeVariant: rem.isOverdue ? 'destructive' : 'warning',
      });
    }

    // Historical payments collected
    for (const col of collections) {
      if (col.status === 'VERIFIED') {
        const bk = bookings.find((b) => b.id === col.bookingId);
        combined.push({
          id: `col_${col.id}`,
          timestamp: col.paidAt || col.createdAt,
          type: 'PAYMENT_RECEIVED',
          title: `Payment Received: ${col.receiptNumber ?? 'Receipt Verified'}`,
          description: `${bk?.customer.fullName ?? 'Customer'} • Unit ${col.unitId || bk?.unitNumber} • ${col.milestoneName} (${col.paymentMode})`,
          amountInr: col.paidAmountInr,
          badge: 'Payment Verified',
          badgeVariant: 'success',
        });
      }
    }

    return combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [reminders, collections, bookings]);

  return (
    <div className="space-y-4">
      {/* Automation Sub-Navigation & Quick Batch Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={subTab === 'whom-to-remind' ? 'default' : 'outline'}
            className="h-8 text-xs gap-1.5 font-semibold"
            onClick={() => setSubTab('whom-to-remind')}
          >
            <Bell className="h-3.5 w-3.5 text-primary" />
            Whom to Remind ({whomToRemindList.length})
          </Button>

          <Button
            type="button"
            size="sm"
            variant={subTab === 'overdue' ? 'default' : 'outline'}
            className={cn(
              "h-8 text-xs gap-1.5 font-semibold",
              subTab === 'overdue'
                ? "bg-rose-600 hover:bg-rose-700 text-white"
                : "border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            )}
            onClick={() => setSubTab('overdue')}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
            Crossed Deadline ({overdueTargets.length})
          </Button>

          <Button
            type="button"
            size="sm"
            variant={subTab === 'yet-to-pay' ? 'default' : 'outline'}
            className={cn(
              "h-8 text-xs gap-1.5 font-semibold",
              subTab === 'yet-to-pay'
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            )}
            onClick={() => setSubTab('yet-to-pay')}
          >
            <Clock className="h-3.5 w-3.5 text-amber-500" />
            Yet to Pay ({yetToPayTargets.length})
          </Button>

          <Button
            type="button"
            size="sm"
            variant={subTab === 'activities' ? 'default' : 'outline'}
            className="h-8 text-xs gap-1.5"
            onClick={() => setSubTab('activities')}
          >
            <History className="h-3.5 w-3.5 text-primary" />
            Activities & Timeline
          </Button>
        </div>

        {/* Batch Automation Action Buttons */}
        <div className="flex items-center gap-2">
          {overdueTargets.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-rose-500 text-rose-700 dark:text-rose-300 font-semibold gap-1 hover:bg-rose-50 dark:hover:bg-rose-950"
              disabled={busy}
              onClick={() => handleBatchRemind('OVERDUE')}
            >
              <Zap className="h-3.5 w-3.5 text-rose-600" />
              Remind All Overdue ({overdueTargets.length})
            </Button>
          )}

          {yetToPayTargets.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-amber-500 text-amber-700 dark:text-amber-300 font-semibold gap-1 hover:bg-amber-50 dark:hover:bg-amber-950"
              disabled={busy}
              onClick={() => handleBatchRemind('DUE_SOON')}
            >
              <Send className="h-3.5 w-3.5 text-amber-600" />
              Remind All Due Soon ({yetToPayTargets.length})
            </Button>
          )}
        </div>
      </div>

      {actionBanner && (
        <div className="rounded-lg border border-border bg-secondary p-3 text-xs flex items-center justify-between gap-3">
          <span>{actionBanner}</span>
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setActionBanner(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* SUB-VIEW 1: WHOM SHOULD WE REMIND */}
      {subTab === 'whom-to-remind' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              Smart automated reminder queue prioritizing overdue payments and upcoming milestone installments.
            </div>
            <Input
              placeholder="Search by customer, unit, or milestone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-64 text-xs"
            />
          </div>

          <DataTable
            data={filterBySearch(whomToRemindList)}
            emptyMessage="No pending reminders! All active customers are up to date."
            columns={[
              {
                id: 'priority',
                header: 'Urgency',
                cell: ({ row }) => {
                  const item = row.original;
                  if (item.category === 'OVERDUE') {
                    return (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 dark:bg-rose-950 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:text-rose-300">
                        <AlertTriangle className="h-2.5 w-2.5 text-rose-600" />
                        {item.daysOverdue}d Overdue
                      </span>
                    );
                  }
                  if (item.category === 'DUE_SOON') {
                    return (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                        <Clock className="h-2.5 w-2.5 text-amber-600" />
                        {item.daysUntilDue !== undefined ? `Due in ${item.daysUntilDue}d` : 'Due Soon'}
                      </span>
                    );
                  }
                  return (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-950 px-2 py-0.5 text-[10px] font-medium text-blue-800 dark:text-blue-300">
                      Token Pending
                    </span>
                  );
                },
              },
              {
                id: 'customer',
                header: 'Customer & Contact',
                cell: ({ row }) => (
                  <div>
                    <div className="font-semibold text-foreground">{row.original.customerName}</div>
                    <div className="text-xs text-muted-foreground">{row.original.customerPhone}</div>
                  </div>
                ),
              },
              {
                accessorKey: 'unitNumber',
                header: 'Unit',
                cell: ({ row }) => (
                  <strong className="text-foreground">Flat {row.original.unitNumber}</strong>
                ),
              },
              {
                accessorKey: 'milestoneName',
                header: 'Demand Particulars',
              },
              {
                accessorKey: 'amountDueInr',
                header: 'Amount Due',
                cell: ({ row }) => (
                  <span className={cn(
                    "font-bold",
                    row.original.category === 'OVERDUE' ? "text-rose-700 dark:text-rose-400" : "text-foreground"
                  )}>
                    {formatInr(row.original.amountDueInr)}
                  </span>
                ),
              },
              {
                id: 'dueDate',
                header: 'Deadline',
                cell: ({ row }) =>
                  row.original.dueDate ? (
                    <span className="text-xs text-muted-foreground">
                      {new Date(row.original.dueDate).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                id: 'actions',
                header: 'Action',
                cell: ({ row }) => {
                  const item = row.original;
                  const bk = bookings.find((b) => b.id === item.bookingId);
                  const col = collections.find((c) => c.id === item.collectionRecordId);
                  return (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1"
                        disabled={busy}
                        onClick={() => handleSendReminder(item, 'WHATSAPP')}
                      >
                        <MessageSquare className="h-3 w-3" />
                        Remind (WA)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={busy}
                        onClick={() => handleSendReminder(item, 'EMAIL')}
                      >
                        <Mail className="h-3 w-3" />
                        Email
                      </Button>
                      {bk && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          onClick={() => onOpenRecordPayment(bk, col)}
                        >
                          + Collect
                        </Button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {/* SUB-VIEW 2: WHO HAS ALREADY CROSSED THE DEADLINE (OVERDUE) */}
      {subTab === 'overdue' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs flex items-center justify-between">
            <span className="font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              {overdueTargets.length} customer(s) have crossed payment milestone deadlines. Immediate escalation recommended.
            </span>
            <span className="font-bold text-rose-700 dark:text-rose-400">
              Total Overdue: {formatInr(overdueTargets.reduce((a, b) => a + b.amountDueInr, 0))}
            </span>
          </div>

          <DataTable
            data={filterBySearch(overdueTargets)}
            emptyMessage="Zero overdue payments! All customers are within their payment deadlines."
            columns={[
              {
                id: 'daysOverdue',
                header: 'Deadline Crossed',
                cell: ({ row }) => (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-200 dark:bg-rose-950 px-2 py-0.5 text-[10px] font-bold text-rose-900 dark:text-rose-300">
                    🚨 {row.original.daysOverdue} Days Ago
                  </span>
                ),
              },
              {
                id: 'customer',
                header: 'Customer',
                cell: ({ row }) => (
                  <div>
                    <div className="font-semibold text-foreground">{row.original.customerName}</div>
                    <div className="text-xs text-muted-foreground">{row.original.customerPhone}</div>
                  </div>
                ),
              },
              {
                accessorKey: 'unitNumber',
                header: 'Unit',
                cell: ({ row }) => <strong>Flat {row.original.unitNumber}</strong>,
              },
              {
                accessorKey: 'milestoneName',
                header: 'Milestone',
              },
              {
                accessorKey: 'amountDueInr',
                header: 'Overdue Amount',
                cell: ({ row }) => (
                  <span className="font-bold text-rose-700 dark:text-rose-400">
                    {formatInr(row.original.amountDueInr)}
                  </span>
                ),
              },
              {
                id: 'dueDate',
                header: 'Due Date',
                cell: ({ row }) =>
                  row.original.dueDate ? new Date(row.original.dueDate).toLocaleDateString() : '—',
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => {
                  const item = row.original;
                  const bk = bookings.find((b) => b.id === item.bookingId);
                  const col = collections.find((c) => c.id === item.collectionRecordId);
                  return (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold gap-1"
                        disabled={busy}
                        onClick={() => handleSendReminder(item, 'WHATSAPP')}
                      >
                        <MessageSquare className="h-3 w-3" />
                        Send Overdue Notice
                      </Button>
                      {bk && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onOpenRecordPayment(bk, col)}
                        >
                          Record Payment
                        </Button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {/* SUB-VIEW 3: WHO IS YET TO PAY (DUE SOON) */}
      {subTab === 'yet-to-pay' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs flex items-center justify-between">
            <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-600" />
              {yetToPayTargets.length} customer(s) have upcoming installment deadlines within next 15 days or pending initial token.
            </span>
            <span className="font-bold text-amber-700 dark:text-amber-400">
              Total Pending: {formatInr(yetToPayTargets.reduce((a, b) => a + b.amountDueInr, 0))}
            </span>
          </div>

          <DataTable
            data={filterBySearch(yetToPayTargets)}
            emptyMessage="No upcoming demands due."
            columns={[
              {
                id: 'urgency',
                header: 'Status',
                cell: ({ row }) => (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                    <Clock className="h-2.5 w-2.5 text-amber-600" />
                    {row.original.daysUntilDue !== undefined ? `Due in ${row.original.daysUntilDue}d` : 'Pending Token'}
                  </span>
                ),
              },
              {
                id: 'customer',
                header: 'Customer',
                cell: ({ row }) => (
                  <div>
                    <div className="font-semibold text-foreground">{row.original.customerName}</div>
                    <div className="text-xs text-muted-foreground">{row.original.customerPhone}</div>
                  </div>
                ),
              },
              {
                accessorKey: 'unitNumber',
                header: 'Unit',
                cell: ({ row }) => <strong>Flat {row.original.unitNumber}</strong>,
              },
              {
                accessorKey: 'milestoneName',
                header: 'Milestone',
              },
              {
                accessorKey: 'amountDueInr',
                header: 'Amount Expected',
                cell: ({ row }) => (
                  <span className="font-bold text-amber-700 dark:text-amber-400">
                    {formatInr(row.original.amountDueInr)}
                  </span>
                ),
              },
              {
                id: 'dueDate',
                header: 'Due Date',
                cell: ({ row }) =>
                  row.original.dueDate ? new Date(row.original.dueDate).toLocaleDateString() : '—',
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => {
                  const item = row.original;
                  const bk = bookings.find((b) => b.id === item.bookingId);
                  const col = collections.find((c) => c.id === item.collectionRecordId);
                  return (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1"
                        disabled={busy}
                        onClick={() => handleSendReminder(item, 'WHATSAPP')}
                      >
                        <MessageSquare className="h-3 w-3" />
                        Send Due Reminder
                      </Button>
                      {bk && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onOpenRecordPayment(bk, col)}
                        >
                          Record Payment
                        </Button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {/* SUB-VIEW 4: UPCOMING & PAST ACTIVITIES TIMELINE */}
      {subTab === 'activities' && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Upcoming Activities */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-primary" />
                Upcoming Payment Activities ({upcomingActivities.length})
              </span>
              <span className="text-[11px] text-muted-foreground">Scheduled Milestones</span>
            </div>

            {upcomingActivities.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No upcoming scheduled payment deadlines in the next 30 days.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {upcomingActivities.map((act) => {
                  const dueMs = new Date(act.dueDate).getTime();
                  const days = Math.ceil((dueMs - nowTime) / 86400000);
                  return (
                    <div
                      key={act.id}
                      className="rounded-lg border border-border bg-background p-3 text-xs space-y-1 hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-center justify-between font-semibold text-foreground">
                        <span>{act.customerName} · Flat {act.unitNumber}</span>
                        <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                          {formatInr(act.amountDueInr)}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                        <span>{act.milestoneName}</span>
                        <span className="font-medium text-amber-700 dark:text-amber-400">
                          Due in {days} day(s) ({new Date(act.dueDate).toLocaleDateString()})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Past Activities */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                <History className="h-4 w-4 text-primary" />
                Past Activities & Audit Trail ({pastActivities.length})
              </span>
              <span className="text-[11px] text-muted-foreground">Recent Actions</span>
            </div>

            {pastActivities.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No activities recorded yet. Reminders and verified payments will appear here.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {pastActivities.map((act) => (
                  <div
                    key={act.id}
                    className="rounded-lg border border-border bg-background p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-semibold text-foreground">
                      <span className="truncate pr-2">{act.title}</span>
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0",
                        act.badgeVariant === 'success' && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
                        act.badgeVariant === 'destructive' && "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
                        act.badgeVariant === 'warning' && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      )}>
                        {act.badge}
                      </span>
                    </div>
                    <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                      <span>{act.description}</span>
                      <span>{new Date(act.timestamp).toLocaleDateString()}</span>
                    </div>
                    {act.amountInr ? (
                      <div className="font-semibold text-foreground text-[11px]">
                        Amount: {formatInr(act.amountInr)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
