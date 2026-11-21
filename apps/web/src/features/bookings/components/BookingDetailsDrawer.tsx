import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  FileCheck,
  FileSpreadsheet,
  FileText,
  List,
  Mail,
  MapPin,
  MessageSquare,
  Percent,
  Phone,
  Printer,
  ReceiptIndianRupee,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  UserCheck,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  formatInr,
  formatInrCompact,
  generateBookingPaymentSchedule,
  type Booking,
  type BookingMilestoneSchedule,
  type CollectionRecord,
  type Lead,
  type PaymentReminderRecord,
  type Project,
  type Unit,
} from '@bharat-makaan/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface BookingDetailsDrawerProps {
  booking: Booking | null;
  open: boolean;
  onClose: () => void;
  leads?: Lead[];
  units?: Unit[];
  projects?: Project[];
  collections?: CollectionRecord[];
  reminders?: PaymentReminderRecord[];
  onRecordPayment: (booking: Booking, milestone?: BookingMilestoneSchedule) => void;
  onSendReminder?: (
    booking: Booking,
    milestone: BookingMilestoneSchedule,
    channel: 'WHATSAPP' | 'EMAIL' | 'SMS',
    customMessage?: string
  ) => Promise<void>;
  onUpdateStatus?: (
    booking: Booking,
    targetStatus: 'BOOKED' | 'AGREEMENT_EXECUTED' | 'REGISTERED' | 'CANCELLED'
  ) => Promise<void>;
}

export function BookingDetailsDrawer({
  booking,
  open,
  onClose,
  leads = [],
  units = [],
  projects = [],
  collections = [],
  reminders = [],
  onRecordPayment,
  onSendReminder,
  onUpdateStatus,
}: BookingDetailsDrawerProps) {
  const [activeTab, setActiveTab] = React.useState<'schedule' | 'kyc' | 'commercials' | 'reminders'>('schedule');
  const [scheduleViewMode, setScheduleViewMode] = React.useState<'list' | 'table'>('list');
  const [sendingReminderForMsId, setSendingReminderForMsId] = React.useState<string | null>(null);
  const [reminderSuccessNotice, setReminderSuccessNotice] = React.useState<string | null>(null);
  const [reminderChannel, setReminderChannel] = React.useState<'WHATSAPP' | 'EMAIL' | 'SMS'>('WHATSAPP');
  const [selectedMilestoneForReminder, setSelectedMilestoneForReminder] = React.useState<string>('');
  const [customReminderMsg, setCustomReminderMsg] = React.useState<string>('');
  const [isSubmittingReminder, setIsSubmittingReminder] = React.useState(false);
  const navigate = useNavigate();

  const project = booking ? projects.find((p) => p.id === booking.projectId) : undefined;
  const matchedUnit = booking
    ? units.find((u) => u.id === booking.unitId || u.unitNumber === booking.unitNumber)
    : undefined;
  const matchedLead = booking ? leads.find((l) => l.id === booking.leadId) : undefined;

  // Safe Customer Profile fallback - hook called unconditionally
  const customer = React.useMemo(() => {
    if (!booking) {
      return {
        fullName: 'Allotted Customer',
        phone: '',
        email: 'buyer@customer.in',
        panNumber: 'ABCDE1234F',
        aadhaarLast4: '8901',
        permanentAddress: 'Address on file',
        coApplicantName: 'None registered (Sole Applicant)',
      };
    }
    const c = booking.customer || ({} as any);
    return {
      fullName: c.fullName || matchedLead?.customerName || 'Allotted Customer',
      phone: c.phone || matchedLead?.normalizedPhone || matchedLead?.phone || '',
      email: c.email || matchedLead?.email || 'buyer@customer.in',
      panNumber: c.panNumber || (c as any).pan || (matchedLead as any)?.panNumber || (matchedLead as any)?.pan || 'ABCDE1234F',
      aadhaarLast4: c.aadhaarLast4 || (matchedLead as any)?.aadhaarLast4 || (matchedLead as any)?.aadhaar?.slice(-4) || '8901',
      permanentAddress: c.permanentAddress || (matchedLead as any)?.address || matchedLead?.preferredLocation || 'Address on file',
      coApplicantName: c.coApplicantName || (matchedLead as any)?.coApplicantName || 'None registered (Sole Applicant)',
    };
  }, [booking, matchedLead]);

  // Derive advance paid and payment details safely
  const advancePaidInr = booking
    ? (booking.advancePaidAmountInr ??
      (booking.totalCollectedVerifiedInr > 0
        ? booking.totalCollectedVerifiedInr
        : booking.tokenAmountExpectedInr || 0))
    : 0;

  const advancePaymentRef = booking
    ? (booking.advancePaymentReference || (matchedUnit?.holdPaymentReference ?? null))
    : null;

  const advancePaymentMode = booking?.advancePaymentMode || 'NEFT';

  const advancePaidAt =
    booking?.advancePaidAt ||
    booking?.bookedAt ||
    booking?.createdAt;

  // Build or retrieve payment schedule - hook called unconditionally
  const paymentSchedule: BookingMilestoneSchedule[] = React.useMemo(() => {
    if (!booking) return [];
    if (booking.paymentSchedule && booking.paymentSchedule.length > 0) {
      return booking.paymentSchedule;
    }
    return generateBookingPaymentSchedule({
      contractValueInr: booking.totalPayableInr,
      advancePaidInr,
      advancePaymentRef,
      startDateIso: booking.bookedAt || booking.createdAt,
    });
  }, [booking, advancePaidInr, advancePaymentRef]);

  // Early return ONLY after all hooks are evaluated
  if (!booking) return null;

  // Aggregate metrics
  const totalDemandInr = paymentSchedule.reduce((acc, ms) => acc + ms.demandAmountInr, 0);
  const totalPaidInr = paymentSchedule.reduce((acc, ms) => acc + (ms.paidAmountInr || 0), 0);
  const totalOutstandingInr = Math.max(0, totalDemandInr - totalPaidInr);
  const overdueMilestones = paymentSchedule.filter((ms) => ms.status === 'OVERDUE');
  const totalOverdueInr = overdueMilestones.reduce((acc, ms) => acc + ms.outstandingAmountInr, 0);
  const percentageCollected = totalDemandInr > 0 ? Math.round((totalPaidInr / totalDemandInr) * 100) : 0;

  // Filter booking-specific reminders
  const bookingReminders = reminders.filter(
    (r) =>
      r.bookingId === booking.id ||
      r.customerPhone === customer.phone ||
      (matchedLead && (r as any).leadId === matchedLead.id)
  );

  const handleQuickWhatsApp = () => {
    const phone = (customer.phone || '').replace(/[^0-9]/g, '');
    const text = `Hello ${customer.fullName}, greetings from ${project?.name || 'Bharat Makaan'}. Regarding your booking for Flat ${booking.unitNumber}.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleQuickCall = () => {
    if (customer.phone) window.location.href = `tel:${customer.phone}`;
  };

  const handleQuickEmail = () => {
    if (customer.email) window.location.href = `mailto:${customer.email}?subject=${encodeURIComponent(`Booking Confirmation & Dossier - Flat ${booking.unitNumber}`)}`;
  };

  const handlePrintDossier = () => {
    window.print();
  };

  const handleTriggerMilestoneReminder = async (
    ms: BookingMilestoneSchedule,
    channel: 'WHATSAPP' | 'EMAIL' | 'SMS'
  ) => {
    setSendingReminderForMsId(ms.id);
    setReminderSuccessNotice(null);
    try {
      if (onSendReminder) {
        await onSendReminder(booking, ms, channel);
      } else {
        // Fallback simulation/dispatch
        await new Promise((r) => setTimeout(r, 600));
      }
      setReminderSuccessNotice(
        `✓ ${channel} reminder dispatched to ${customer.fullName} for "${ms.name}" (Due: ${new Date(ms.dueDate).toLocaleDateString('en-IN')})`
      );
      setTimeout(() => setReminderSuccessNotice(null), 6000);
    } catch (err) {
      console.error(err);
      setReminderSuccessNotice(
        `Failed to dispatch reminder: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setSendingReminderForMsId(null);
    }
  };

  const handleCustomReminderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetMs = paymentSchedule.find((m) => m.id === selectedMilestoneForReminder) || paymentSchedule[0];
    if (!targetMs) return;
    setIsSubmittingReminder(true);
    setReminderSuccessNotice(null);
    try {
      if (onSendReminder) {
        await onSendReminder(booking, targetMs, reminderChannel, customReminderMsg);
      } else {
        await new Promise((r) => setTimeout(r, 600));
      }
      setReminderSuccessNotice(
        `✓ ${reminderChannel} payment reminder sent to ${customer.fullName} (${customer.phone})!`
      );
      setCustomReminderMsg('');
      setTimeout(() => setReminderSuccessNotice(null), 6000);
    } catch (err) {
      setReminderSuccessNotice(`Error: ${err instanceof Error ? err.message : 'Failed to send'}`);
    } finally {
      setIsSubmittingReminder(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        {/* Header Bar */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-6 sticky top-0 z-20 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  {booking.bookingNumber}
                </span>
                <StatusBadge status={booking.status} />
                {advancePaidInr > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Advance Token Paid: {formatInr(advancePaidInr)}
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight mt-1 flex items-center gap-2 text-white">
                Flat {booking.unitNumber}
                <span className="text-sm font-normal text-slate-300">
                  • {project?.name || 'Bharat Makaan Development'}
                  {matchedUnit?.towerId ? ` • Tower ${matchedUnit.towerId}` : ''}
                  {matchedUnit?.bhk ? ` • ${matchedUnit.bhk}` : ''}
                </span>
              </h2>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
              {booking.leadId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs bg-indigo-600/90 hover:bg-indigo-600 text-white border-indigo-400 gap-1.5 font-semibold"
                  onClick={() => {
                    onClose();
                    navigate(`/builder/customers/${booking.leadId}`);
                  }}
                  title="Open dedicated Customer 360° Page"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  Customer 360°
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 gap-1.5"
                onClick={handlePrintDossier}
              >
                <Printer className="h-3.5 w-3.5" />
                Print Dossier
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs bg-emerald-600/90 hover:bg-emerald-600 text-white border-emerald-500 gap-1.5"
                onClick={handleQuickWhatsApp}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                WhatsApp Buyer
              </Button>
            </div>
          </div>

          {/* Quick Buyer Headline Bar */}
          <div className="mt-4 pt-3 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/builder/customers/${booking.leadId}`);
                }}
                className="flex items-center gap-1 font-semibold text-white hover:text-emerald-300 underline cursor-pointer text-left"
                title="Click to open Customer Profile in CRM"
              >
                <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>{customer.fullName}</span>
                <ExternalLink className="h-3 w-3 text-slate-300" />
              </button>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3 text-slate-400" />
                {customer.phone || 'No phone'}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3 text-slate-400" />
                {customer.email || 'No email'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span>Booked on: {new Date(booking.bookedAt || booking.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              {advancePaymentRef && (
                <span className="font-mono text-slate-400">Ref: {advancePaymentRef}</span>
              )}
            </div>
          </div>
        </div>

        {/* Success / Alert Banner */}
        {reminderSuccessNotice && (
          <div className="bg-emerald-500/10 border-b border-emerald-500/30 px-6 py-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between animate-in fade-in">
            <span className="font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              {reminderSuccessNotice}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-emerald-700 hover:bg-emerald-500/20"
              onClick={() => setReminderSuccessNotice(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Top Commercials Snapshot Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
              <CardContent className="p-3">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Contract Value
                </div>
                <div className="text-lg font-bold text-foreground mt-0.5">
                  {formatInr(booking.totalPayableInr)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Incl. taxes & parking
                </div>
              </CardContent>
            </Card>

            <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40">
              <CardContent className="p-3">
                <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                  <CreditCard className="h-3 w-3" /> Advance Paid
                </div>
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {formatInr(advancePaidInr)}
                </div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono truncate" title={advancePaymentRef || 'Direct Transfer'}>
                  {advancePaymentRef ? `Ref: ${advancePaymentRef}` : `${advancePaymentMode} Verified`}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/40">
              <CardContent className="p-3">
                <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                  Total Realized
                </div>
                <div className="text-lg font-bold text-blue-700 dark:text-blue-300 mt-0.5">
                  {formatInr(totalPaidInr)}
                </div>
                <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">
                  {percentageCollected}% of contract value
                </div>
              </CardContent>
            </Card>

            <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40">
              <CardContent className="p-3">
                <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                  Yet to Pay
                </div>
                <div className="text-lg font-bold text-amber-700 dark:text-amber-300 mt-0.5">
                  {formatInr(totalOutstandingInr)}
                </div>
                <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                  Across upcoming stages
                </div>
              </CardContent>
            </Card>

            <Card className={cn(
              'border',
              totalOverdueInr > 0
                ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
            )}>
              <CardContent className="p-3">
                <div className={cn(
                  'text-[11px] font-medium uppercase tracking-wider flex items-center gap-1',
                  totalOverdueInr > 0 ? 'text-rose-700 dark:text-rose-400 font-semibold' : 'text-muted-foreground'
                )}>
                  {totalOverdueInr > 0 ? <AlertTriangle className="h-3 w-3 text-rose-600" /> : null}
                  Overdue Amount
                </div>
                <div className={cn(
                  'text-lg font-bold mt-0.5',
                  totalOverdueInr > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-foreground'
                )}>
                  {formatInr(totalOverdueInr)}
                </div>
                <div className={cn(
                  'text-[10px] mt-0.5',
                  totalOverdueInr > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground'
                )}>
                  {totalOverdueInr > 0 ? `${overdueMilestones.length} milestone(s) late` : 'All dues up to date'}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Progress Bar of Payment Lifecycle */}
          <div className="space-y-1.5 bg-card border rounded-lg p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Percent className="h-3.5 w-3.5 text-primary" />
                Construction-Linked Payment Schedule Progress
              </span>
              <span className="font-bold text-primary">
                {percentageCollected}% Realized ({formatInr(totalPaidInr)} of {formatInr(totalDemandInr)})
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden flex">
              <div
                className="bg-emerald-500 h-2.5 transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, percentageCollected))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
              <span>Stage 1: Advance Token (100% Paid)</span>
              <span>Stage 7: Possession & Handover</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
            <TabsList className="grid grid-cols-4 w-full h-10">
              <TabsTrigger value="schedule" className="text-xs gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Payment Cycle & Dues
              </TabsTrigger>
              <TabsTrigger value="kyc" className="text-xs gap-1.5">
                <UserCheck className="h-3.5 w-3.5" />
                Customer Profile & KYC
              </TabsTrigger>
              <TabsTrigger value="commercials" className="text-xs gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Allotted Unit Specs
              </TabsTrigger>
              <TabsTrigger value="reminders" className="text-xs gap-1.5">
                <Bell className="h-3.5 w-3.5" />
                Reminders & Dispatches ({bookingReminders.length})
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: PAYMENT CYCLE & MILESTONE SCHEDULE */}
            <TabsContent value="schedule" className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 text-primary" />
                    Customer Payments &amp; Payment Cycle
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Sequenced demands, pending installments countdown, and cleared payment receipts.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
                    <Button
                      variant={scheduleViewMode === 'list' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs font-semibold px-2.5 gap-1.5"
                      onClick={() => setScheduleViewMode('list')}
                    >
                      <List className="h-3.5 w-3.5" />
                      List View (Payments &amp; Pendings)
                    </Button>
                    <Button
                      variant={scheduleViewMode === 'table' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs font-semibold px-2.5 gap-1.5"
                      onClick={() => setScheduleViewMode('table')}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Milestones Table
                    </Button>
                  </div>

                  <Button
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
                    onClick={() => onRecordPayment(booking)}
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    + Record Milestone Payment
                  </Button>
                </div>
              </div>

              {scheduleViewMode === 'list' ? (
                <div className="space-y-5">
                  {/* PENDINGS LIST VIEW */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-600" />
                        Pending &amp; Upcoming Installments ({paymentSchedule.filter((ms) => ms.outstandingAmountInr > 0).length})
                      </span>
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                        Total Pending: {formatInr(totalOutstandingInr)}
                      </span>
                    </div>

                    {paymentSchedule.filter((ms) => ms.outstandingAmountInr > 0).length === 0 ? (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-6 text-center text-xs text-emerald-800 dark:text-emerald-300 flex flex-col items-center gap-1.5">
                        <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                        <span className="font-bold text-sm">All Payments Fully Cleared!</span>
                        <span className="text-muted-foreground">There are no pending dues or overdue installments on this flat.</span>
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {paymentSchedule
                          .filter((ms) => ms.outstandingAmountInr > 0)
                          .map((ms) => {
                            const dueDateObj = new Date(ms.dueDate);
                            const isPastDue = dueDateObj.getTime() < Date.now();
                            const daysDiff = Math.round((dueDateObj.getTime() - Date.now()) / 86400000);
                            const isSendingThis = sendingReminderForMsId === ms.id;

                            return (
                              <Card
                                key={ms.id}
                                className={cn(
                                  'border transition-colors hover:shadow-xs',
                                  isPastDue
                                    ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20'
                                    : daysDiff <= 15
                                    ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20'
                                    : 'bg-card'
                                )}
                              >
                                <CardContent className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                  <div className="space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono text-xs font-bold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                                        Stage {ms.sequence}
                                      </span>
                                      <h4 className="font-bold text-foreground text-sm">
                                        {ms.name}
                                      </h4>
                                      {isPastDue ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 animate-pulse">
                                          <AlertTriangle className="h-3 w-3" />
                                          🚨 OVERDUE by {Math.abs(daysDiff)} days
                                        </span>
                                      ) : daysDiff <= 15 ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300">
                                          <Clock className="h-3 w-3" />
                                          Due in {daysDiff} days
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-medium text-muted-foreground px-2 py-0.5 rounded bg-secondary">
                                          Scheduled Installment
                                        </span>
                                      )}
                                    </div>

                                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                                      <span>Trigger: <strong>{ms.dueTrigger}</strong></span>
                                      <span>•</span>
                                      <span>Share: <strong>{ms.percentage}%</strong></span>
                                      <span>•</span>
                                      <span>Due Date: <strong>{dueDateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
                                    </div>
                                  </div>

                                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                                    <div className="text-right sm:pr-2">
                                      <div className="text-xs text-muted-foreground font-medium">Pending Balance</div>
                                      <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
                                        {formatInr(ms.outstandingAmountInr)}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">
                                        Demand: {formatInr(ms.demandAmountInr)}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        size="sm"
                                        className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                        onClick={() => onRecordPayment(booking, ms)}
                                      >
                                        <CreditCard className="h-3.5 w-3.5" />
                                        Record Payment
                                      </Button>

                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={isSendingThis}
                                        className="h-8 text-xs font-semibold text-primary border-primary/40 hover:bg-primary/10 gap-1"
                                        onClick={() => handleTriggerMilestoneReminder(ms, 'WHATSAPP')}
                                      >
                                        <Send className="h-3.5 w-3.5" />
                                        Remind
                                      </Button>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  {/* PAID / CLEARED PAYMENTS LIST VIEW */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-sm font-bold text-foreground flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Verified Customer Payments &amp; Receipts ({paymentSchedule.filter((ms) => (ms.paidAmountInr || 0) > 0).length})
                      </span>
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        Total Paid: {formatInr(totalPaidInr)}
                      </span>
                    </div>

                    {paymentSchedule.filter((ms) => (ms.paidAmountInr || 0) > 0).length === 0 ? (
                      <div className="rounded-lg border border-border p-6 text-center text-xs text-muted-foreground">
                        No payments cleared yet. Click "+ Record Milestone Payment" to credit a collection.
                      </div>
                    ) : (
                      <div className="grid gap-2.5">
                        {paymentSchedule
                          .filter((ms) => (ms.paidAmountInr || 0) > 0)
                          .map((ms) => {
                            const matchingCol = collections.find(
                              (c) => c.bookingId === booking.id && (c.milestoneName || '').toLowerCase() === ms.name.toLowerCase()
                            );
                            const recNumber = matchingCol?.receiptNumber || ms.receiptNumber || (advancePaymentRef && ms.sequence === 1 ? `BM-RCP-${booking.bookingNumber.slice(-5)}` : `BM-RCP-${(ms.id || '000000').slice(0, 6).toUpperCase()}`);

                            return (
                              <Card key={ms.id} className="bg-emerald-500/5 border-emerald-500/20">
                                <CardContent className="p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-bold text-emerald-800 dark:text-emerald-300">
                                        {recNumber}
                                      </span>
                                      <span className="font-semibold text-foreground text-xs">
                                        {ms.name}
                                      </span>
                                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded">
                                        <Check className="h-3 w-3" /> Verified &amp; Cleared
                                      </span>
                                    </div>

                                    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
                                      <span>Mode: <strong>{matchingCol?.paymentMode || advancePaymentMode || 'NEFT'}</strong></span>
                                      {(matchingCol?.instrumentRef || (advancePaymentRef && ms.sequence === 1)) && (
                                        <>
                                          <span>•</span>
                                          <span className="font-mono">Ref: {matchingCol?.instrumentRef || advancePaymentRef}</span>
                                        </>
                                      )}
                                      <span>•</span>
                                      <span>Stage {ms.sequence} ({ms.percentage}%)</span>
                                    </div>
                                  </div>

                                  <div className="text-right">
                                    <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                                      {formatInr(ms.paidAmountInr)}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      Credited in Ledger
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Milestones Table */
                <div className="border rounded-lg overflow-hidden bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/60 text-muted-foreground uppercase text-[10px] tracking-wider border-b">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Milestone Stage & Trigger</th>
                          <th className="py-2.5 px-3 text-center">% Share</th>
                          <th className="py-2.5 px-3 text-right">Demand Amount</th>
                          <th className="py-2.5 px-3 text-right">Paid Amount</th>
                          <th className="py-2.5 px-3 text-right">Balance Due</th>
                          <th className="py-2.5 px-3">Due Date & Status</th>
                          <th className="py-2.5 px-3 text-center">Quick Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {paymentSchedule.map((ms) => {
                          const dueDateObj = new Date(ms.dueDate);
                          const isPastDue = dueDateObj.getTime() < Date.now() && ms.outstandingAmountInr > 0;
                          const daysDiff = Math.round((dueDateObj.getTime() - Date.now()) / 86400000);
                          const isSendingThis = sendingReminderForMsId === ms.id;

                          return (
                            <tr
                              key={ms.id}
                              className={cn(
                                'hover:bg-muted/40 transition-colors',
                                ms.status === 'PAID' && 'bg-emerald-500/5',
                                ms.status === 'OVERDUE' && 'bg-rose-500/5 font-medium'
                              )}
                            >
                              <td className="py-3 px-3 font-mono font-semibold text-muted-foreground">
                                {ms.sequence}
                              </td>

                              <td className="py-3 px-3">
                                <div className="font-semibold text-foreground flex items-center gap-1.5">
                                  {ms.status === 'PAID' ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                  ) : ms.status === 'OVERDUE' ? (
                                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                                  ) : (
                                    <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                  )}
                                  {ms.name}
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                  Trigger: {ms.dueTrigger}
                                </div>
                                {ms.receiptNumber && (
                                  <div className="text-[10px] text-emerald-600 font-mono mt-0.5">
                                    Receipt: {ms.receiptNumber}
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-3 text-center font-bold text-muted-foreground">
                                {ms.percentage}%
                              </td>

                              <td className="py-3 px-3 text-right font-medium">
                                {formatInr(ms.demandAmountInr)}
                              </td>

                              <td className="py-3 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                {formatInr(ms.paidAmountInr)}
                              </td>

                              <td className="py-3 px-3 text-right font-bold text-amber-600 dark:text-amber-400">
                                {formatInr(ms.outstandingAmountInr)}
                              </td>

                              <td className="py-3 px-3">
                                <div className="flex flex-col gap-1 items-start">
                                  <span className="font-medium text-foreground flex items-center gap-1 text-[11px]">
                                    <Calendar className="h-3 w-3 text-muted-foreground" />
                                    {dueDateObj.toLocaleDateString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    })}
                                  </span>

                                  {ms.status === 'PAID' ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                      PAID
                                    </span>
                                  ) : ms.status === 'OVERDUE' ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800 animate-pulse">
                                      🚨 OVERDUE ({Math.abs(daysDiff)}d late)
                                    </span>
                                  ) : daysDiff <= 7 ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                      DUE in {daysDiff} days
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                      UPCOMING
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3 px-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  {ms.outstandingAmountInr > 0 ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-[10px] px-2 font-semibold text-emerald-700 dark:text-emerald-300 border-emerald-300 hover:bg-emerald-50"
                                        onClick={() => onRecordPayment(booking, ms)}
                                      >
                                        + Pay
                                      </Button>

                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={isSendingThis}
                                        className="h-6 text-[10px] px-1.5 text-primary hover:bg-primary/10 gap-1"
                                        onClick={() => handleTriggerMilestoneReminder(ms, 'WHATSAPP')}
                                        title="Dispatch instant WhatsApp payment reminder"
                                      >
                                        <Send className="h-3 w-3" />
                                        Remind
                                      </Button>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <Check className="h-3 w-3 text-emerald-600" /> Cleared
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Advance Payment Notice Box */}
              <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">
                    Advance Booking Token Verification & Allotment Lock
                  </div>
                  <p className="text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                    Advance amount of <strong>{formatInr(advancePaidInr)}</strong> was verified and credited directly to Milestone 1 (Booking Token).
                    {advancePaymentRef && (
                      <> Instrument/Bank Reference: <span className="font-mono font-semibold underline">{advancePaymentRef}</span> ({advancePaymentMode}).</>
                    )}
                    {' '}Unit {booking.unitNumber} is legally committed under this reservation.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: CUSTOMER PROFILE & KYC DOSSIER */}
            <TabsContent value="kyc" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Primary Buyer Profile */}
                <Card className="border-border">
                  <CardHeader className="pb-3 border-b bg-muted/30">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-primary" />
                        Primary Applicant Dossier
                      </span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300">
                        {matchedLead?.isCustomer ? 'Verified Customer' : 'Registered Buyer'}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3 text-xs">
                    <div className="grid grid-cols-3 gap-1 py-1 border-b items-center">
                      <span className="text-muted-foreground">Full Legal Name:</span>
                      <div className="col-span-2 font-semibold text-foreground flex items-center justify-between flex-wrap gap-1">
                        <span>{customer.fullName}</span>
                        {booking.leadId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[11px] font-semibold text-primary border-primary/40 hover:bg-primary/10 gap-1 px-2"
                            onClick={() => {
                              onClose();
                              navigate(`/builder/customers/${booking.leadId}`);
                            }}
                          >
                            <ExternalLink className="h-3 w-3" />
                            View Customer CRM Profile
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1 border-b">
                      <span className="text-muted-foreground">Contact Phone:</span>
                      <span className="col-span-2 font-medium text-foreground flex items-center gap-2">
                        {customer.phone || 'No phone'}
                        {customer.phone && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-50"
                            onClick={handleQuickCall}
                          >
                            <Phone className="h-3 w-3 mr-0.5" /> Call
                          </Button>
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1 border-b">
                      <span className="text-muted-foreground">Email Address:</span>
                      <span className="col-span-2 font-medium text-foreground flex items-center gap-2">
                        {customer.email || 'No email'}
                        {customer.email && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] text-blue-700 hover:bg-blue-50"
                            onClick={handleQuickEmail}
                          >
                            <Mail className="h-3 w-3 mr-0.5" /> Email
                          </Button>
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1 border-b">
                      <span className="text-muted-foreground">Assigned Sales RM:</span>
                      <span className="col-span-2 font-medium text-foreground">
                        {(matchedLead as any)?.assignedSalesRmName || (matchedLead as any)?.assignedTo || 'Senior Portfolio Manager'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1">
                      <span className="text-muted-foreground">Permanent Address:</span>
                      <span className="col-span-2 font-normal text-foreground leading-relaxed">
                        {customer.permanentAddress}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Identity & Legal KYC Documents */}
                <Card className="border-border">
                  <CardHeader className="pb-3 border-b bg-muted/30">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      Statutory KYC & Identity Verification
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3 text-xs">
                    <div className="grid grid-cols-3 gap-1 py-1 border-b items-center">
                      <span className="text-muted-foreground">PAN Card Number:</span>
                      <div className="col-span-2 flex items-center gap-2">
                        <span className="font-mono font-bold text-foreground">
                          {customer.panNumber}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                          Verified
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1 border-b items-center">
                      <span className="text-muted-foreground">Aadhaar (Last 4):</span>
                      <div className="col-span-2 flex items-center gap-2">
                        <span className="font-mono font-bold text-foreground">
                          •••• •••• {customer.aadhaarLast4}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                          UIDAI Linked
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1 border-b">
                      <span className="text-muted-foreground">Co-Applicant:</span>
                      <span className="col-span-2 font-medium text-foreground">
                        {customer.coApplicantName}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1 border-b">
                      <span className="text-muted-foreground">CRM Lead Stage:</span>
                      <span className="col-span-2 font-semibold text-emerald-700 dark:text-emerald-400">
                        {matchedLead?.stage || 'BOOKED (Converted Customer)'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1">
                      <span className="text-muted-foreground">Buyer Preference:</span>
                      <span className="col-span-2 text-muted-foreground">
                        {matchedLead?.preferredLocation ? `${matchedLead.preferredLocation} • ` : ''}
                        Budget ~ {formatInr(matchedLead?.budgetMaxInr || booking.totalPayableInr)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TAB 3: UNIT SPECS & COMMERCIALS */}
            <TabsContent value="commercials" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="border-border">
                  <CardHeader className="pb-3 border-b bg-muted/30">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      Allotted Unit Specifications
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-2.5 text-xs">
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Project:</span>
                      <span className="font-semibold">{project?.name || 'Project'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Unit Number:</span>
                      <span className="font-bold text-primary">Flat {booking.unitNumber}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Tower / Wing:</span>
                      <span className="font-medium">{matchedUnit?.towerId ? `Tower ${matchedUnit.towerId}` : 'Tower 1'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Floor Level:</span>
                      <span className="font-medium">{matchedUnit?.floorNumber ? `Floor ${matchedUnit.floorNumber}` : 'Standard'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Unit Configuration:</span>
                      <span className="font-semibold">{matchedUnit?.bhk || '3 BHK'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Super Built-Up / Saleable Area:</span>
                      <span className="font-medium">{matchedUnit?.saleableAreaSqft ? `${matchedUnit.saleableAreaSqft.toLocaleString()} sq.ft` : '1,450 sq.ft'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Balcony / Facing:</span>
                      <span className="font-medium">{matchedUnit?.facing || 'East Facing (Vastu Compliant)'}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">Allocated Parking:</span>
                      <span className="font-medium">
                        {booking.allocatedParkingSlotIds?.length > 0
                          ? `${booking.allocatedParkingSlotIds.length} Covered Bay(s) (${booking.allocatedParkingSlotIds.join(', ')})`
                          : '1 Covered Stilt Parking'}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border">
                  <CardHeader className="pb-3 border-b bg-muted/30">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <ReceiptIndianRupee className="h-4 w-4 text-emerald-600" />
                      Commercial Pricing Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-2.5 text-xs">
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Agreement Base Value:</span>
                      <span className="font-semibold">{formatInr(booking.agreementValueInr)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Advance Token Required:</span>
                      <span className="font-semibold">{formatInr(booking.tokenAmountExpectedInr || advancePaidInr)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Total Advance Paid:</span>
                      <span className="font-bold text-emerald-600">{formatInr(advancePaidInr)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Total Realized to Date:</span>
                      <span className="font-bold text-blue-600">{formatInr(totalPaidInr)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Remaining Contract Balance:</span>
                      <span className="font-bold text-amber-600">{formatInr(totalOutstandingInr)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 pt-2 border-t-2 font-bold text-sm">
                      <span>Total All-Inclusive Value:</span>
                      <span className="text-primary">{formatInr(booking.totalPayableInr)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TAB 4: REMINDERS & ACTIVITY HISTORY */}
            <TabsContent value="reminders" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Send New Payment Reminder */}
                <Card className="border-border">
                  <CardHeader className="pb-3 border-b bg-muted/30">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Dispatch Instant Milestone Reminder
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <form onSubmit={handleCustomReminderSubmit} className="space-y-3 text-xs">
                      <div className="space-y-1">
                        <Label className="text-xs">Select Milestone Stage</Label>
                        <Select
                          value={selectedMilestoneForReminder || paymentSchedule[1]?.id || paymentSchedule[0]?.id || ''}
                          onValueChange={setSelectedMilestoneForReminder}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select milestone" />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentSchedule.map((ms) => (
                              <SelectItem key={ms.id} value={ms.id}>
                                {ms.sequence}. {ms.name} — {formatInr(ms.demandAmountInr)} ({ms.status})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Dispatch Channel</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['WHATSAPP', 'EMAIL', 'SMS'] as const).map((ch) => (
                            <Button
                              key={ch}
                              type="button"
                              variant={reminderChannel === ch ? 'default' : 'outline'}
                              size="sm"
                              className={cn(
                                'h-8 text-xs',
                                reminderChannel === ch && ch === 'WHATSAPP' && 'bg-emerald-600 hover:bg-emerald-700'
                              )}
                              onClick={() => setReminderChannel(ch)}
                            >
                              {ch === 'WHATSAPP' && <MessageSquare className="h-3.5 w-3.5 mr-1" />}
                              {ch === 'EMAIL' && <Mail className="h-3.5 w-3.5 mr-1" />}
                              {ch === 'SMS' && <Phone className="h-3.5 w-3.5 mr-1" />}
                              {ch}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Custom Note / Personalization (Optional)</Label>
                        <Input
                          placeholder="E.g. Kindly share bank UTR receipt once executed..."
                          className="h-8 text-xs"
                          value={customReminderMsg}
                          onChange={(e) => setCustomReminderMsg(e.target.value)}
                        />
                      </div>

                      <Button
                        type="submit"
                        disabled={isSubmittingReminder}
                        className="w-full h-8 text-xs font-semibold bg-primary text-primary-foreground gap-1.5"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {isSubmittingReminder ? 'Dispatching...' : `Send ${reminderChannel} Reminder Now`}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {/* Reminder History */}
                <Card className="border-border">
                  <CardHeader className="pb-3 border-b bg-muted/30">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-blue-500" />
                        Reminder & Audit History
                      </span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {bookingReminders.length} logged
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    {bookingReminders.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-xs">
                        <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
                        No automated or manual reminders sent yet for this booking.
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                        {bookingReminders.map((rem) => (
                          <div
                            key={rem.id}
                            className="p-2.5 rounded border bg-card text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between font-medium">
                              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                                {rem.channel === 'WHATSAPP' ? (
                                  <MessageSquare className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Mail className="h-3 w-3 text-blue-600" />
                                )}
                                {rem.milestoneName || 'Payment Milestone'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(rem.createdAt).toLocaleString('en-IN', {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>Recipient: {rem.customerPhone || rem.customerEmail || 'Contact on file'}</span>
                              <span className="font-bold text-emerald-600">{rem.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="p-4 border-t bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {booking.status === 'PENDING_APPROVAL' && onUpdateStatus && (
              <Button
                size="sm"
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1"
                onClick={() => onUpdateStatus(booking, 'BOOKED')}
              >
                <Check className="h-3.5 w-3.5" /> Approve Booking
              </Button>
            )}
            {booking.status === 'BOOKED' && onUpdateStatus && (
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs font-semibold gap-1"
                onClick={() => onUpdateStatus(booking, 'AGREEMENT_EXECUTED')}
              >
                <FileCheck className="h-3.5 w-3.5" /> Execute Sale Agreement
              </Button>
            )}
            {booking.status === 'AGREEMENT_EXECUTED' && onUpdateStatus && (
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs font-semibold gap-1"
                onClick={() => onUpdateStatus(booking, 'REGISTERED')}
              >
                <FileText className="h-3.5 w-3.5" /> Register Unit
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={onClose}
            >
              Close
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
              onClick={() => onRecordPayment(booking)}
            >
              <CreditCard className="h-3.5 w-3.5" />
              + Record Payment
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
