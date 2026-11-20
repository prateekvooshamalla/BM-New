import * as React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  ReceiptIndianRupee,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { formatInr, formatInrCompact, type Booking, type CollectionRecord } from '@bharat-makaan/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface IncomeMetricsCardsProps {
  bookings: Booking[];
  collections: CollectionRecord[];
}

export function IncomeMetricsCards({ bookings, collections }: IncomeMetricsCardsProps) {
  const activeBookings = React.useMemo(
    () => bookings.filter((b) => b.status !== 'CANCELLED'),
    [bookings]
  );

  // 1. Total Contracted / Booked Gross Value
  const totalBookedValue = React.useMemo(
    () =>
      activeBookings.reduce(
        (acc, b) => acc + (b.totalPayableInr || b.agreementValueInr || 0),
        0
      ),
    [activeBookings]
  );

  // 2. Total Realized / Verified Collections
  const totalRealizedIncome = React.useMemo(
    () => activeBookings.reduce((acc, b) => acc + (b.totalCollectedVerifiedInr || 0), 0),
    [activeBookings]
  );

  // 3. Outstanding Receivables (Yet to Pay)
  const totalPendingReceivables = React.useMemo(
    () => activeBookings.reduce((acc, b) => acc + (b.outstandingBalanceInr || 0), 0),
    [activeBookings]
  );

  const nowTime = Date.now();

  // 4. Overdue Demands (Crossed Deadline)
  const overdueDemands = React.useMemo(() => {
    return collections.filter((c) => {
      if (c.status !== 'DUE' && c.recordType !== 'MILESTONE_DEMAND') return false;
      const remaining = c.demandAmountInr - (c.paidAmountInr || 0);
      if (remaining <= 0) return false;
      if (!c.dueDate) return false;
      return new Date(c.dueDate).getTime() < nowTime;
    });
  }, [collections, nowTime]);

  const totalOverdueAmount = React.useMemo(
    () =>
      overdueDemands.reduce(
        (acc, c) => acc + Math.max(0, c.demandAmountInr - (c.paidAmountInr || 0)),
        0
      ),
    [overdueDemands]
  );

  // 5. Demands Due Soon (Next 15 days)
  const dueSoonDemands = React.useMemo(() => {
    return collections.filter((c) => {
      if (c.status !== 'DUE' && c.recordType !== 'MILESTONE_DEMAND') return false;
      const remaining = c.demandAmountInr - (c.paidAmountInr || 0);
      if (remaining <= 0) return false;
      if (!c.dueDate) return true; // Undated pending demands
      const dueMs = new Date(c.dueDate).getTime();
      return dueMs >= nowTime && dueMs <= nowTime + 15 * 86400000;
    });
  }, [collections, nowTime]);

  const totalDueSoonAmount = React.useMemo(
    () =>
      dueSoonDemands.reduce(
        (acc, c) => acc + Math.max(0, c.demandAmountInr - (c.paidAmountInr || 0)),
        0
      ),
    [dueSoonDemands]
  );

  // Realization rate
  const realizationPct =
    totalBookedValue > 0 ? Math.round((totalRealizedIncome / totalBookedValue) * 100) : 0;

  // Token collections vs Milestone collections breakdown
  const tokenCollectionsInr = React.useMemo(
    () =>
      collections
        .filter((c) => c.status === 'VERIFIED' && (c.recordType === 'TOKEN' || c.milestoneName.toLowerCase().includes('token')))
        .reduce((acc, c) => acc + (c.paidAmountInr || 0), 0),
    [collections]
  );

  const milestoneCollectionsInr = React.useMemo(
    () =>
      collections
        .filter((c) => c.status === 'VERIFIED' && c.recordType !== 'TOKEN' && !c.milestoneName.toLowerCase().includes('token'))
        .reduce((acc, c) => acc + (c.paidAmountInr || 0), 0),
    [collections]
  );

  return (
    <div className="space-y-3">
      {/* Top 4 Primary Financial Income Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Booked Income */}
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-primary" />
              Total Booked Income
            </CardTitle>
            <span className="text-[10px] rounded bg-secondary px-1.5 py-0.5 text-muted-foreground font-medium">
              Gross Value
            </span>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {formatInrCompact(totalBookedValue)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{activeBookings.length} Active Booking(s)</span>
              <span>Avg {activeBookings.length > 0 ? formatInrCompact(totalBookedValue / activeBookings.length) : '₹0'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Realized Income (Payments Collected) */}
        <Card className="border-emerald-500/30 bg-emerald-500/5 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Total Realized Income
            </CardTitle>
            <span className="text-[10px] rounded bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300 font-bold">
              {realizationPct}% Realized
            </span>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
              {formatInrCompact(totalRealizedIncome)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Verified Cash Flow</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {formatInr(totalRealizedIncome)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Pending Receivables (Yet to Pay) */}
        <Card className="border-amber-500/30 bg-amber-500/5 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Pending Receivables
            </CardTitle>
            <span className="text-[10px] rounded bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 text-amber-700 dark:text-amber-300 font-medium">
              Yet to Pay
            </span>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-400">
              {formatInrCompact(totalPendingReceivables)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Due in next 15d:</span>
              <span className="font-semibold text-foreground">
                {formatInrCompact(totalDueSoonAmount)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Crossed Deadline (Overdue Amount) */}
        <Card className="border-rose-500/30 bg-rose-500/5 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
              Crossed Deadline (Overdue)
            </CardTitle>
            <span className="text-[10px] rounded bg-rose-100 dark:bg-rose-950 px-1.5 py-0.5 text-rose-700 dark:text-rose-300 font-bold">
              {overdueDemands.length} Overdue
            </span>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold tracking-tight text-rose-700 dark:text-rose-400">
              {formatInrCompact(totalOverdueAmount)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-rose-600/90 dark:text-rose-400 font-medium">
              <span>Needs immediate reminder</span>
              <span>{formatInr(totalOverdueAmount)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress & Income Breakdown Strip */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-2">
          <span className="font-semibold text-foreground flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" />
            Financial Realization & Collection Efficiency: {realizationPct}%
          </span>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span>Tokens: <strong className="text-foreground">{formatInrCompact(tokenCollectionsInr)}</strong></span>
            <span>•</span>
            <span>Milestones: <strong className="text-foreground">{formatInrCompact(milestoneCollectionsInr)}</strong></span>
            <span>•</span>
            <span>Outstanding: <strong className="text-amber-700 dark:text-amber-400">{formatInrCompact(totalPendingReceivables)}</strong></span>
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-emerald-600 transition-all duration-500 rounded-full"
            style={{ width: `${Math.min(100, realizationPct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
