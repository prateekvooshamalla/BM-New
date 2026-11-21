import * as React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { where, doc, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
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
  Star,
  User,
  UserCheck,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  formatInr,
  formatInrCompact,
  formatAreaSqft,
  generateBookingPaymentSchedule,
  type Booking,
  type BookingMilestoneSchedule,
  type CollectionRecord,
  type Lead,
  type LeadActivity,
  type PaymentReminderRecord,
  type Project,
  type SiteVisit,
  type Unit,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PermissionGate } from '@/components/shared/PermissionGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';
import { isCustomer } from '../components/LeadsKanban';

export function CustomerViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeOrgId, projects, organizations } = useTenantStore();

  const [lead, setLead] = React.useState<Lead | null>(null);
  const [allLeads, setAllLeads] = React.useState<Lead[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [collections, setCollections] = React.useState<CollectionRecord[]>([]);
  const [reminders, setReminders] = React.useState<PaymentReminderRecord[]>([]);
  const [siteVisits, setSiteVisits] = React.useState<SiteVisit[]>([]);
  const [activities, setActivities] = React.useState<LeadActivity[]>([]);

  // Modals & form state
  const [recordPaymentOpen, setRecordPaymentOpen] = React.useState(false);
  const [selectedMilestoneForPayment, setSelectedMilestoneForPayment] = React.useState<BookingMilestoneSchedule | null>(null);
  const [payRecType, setPayRecType] = React.useState<'RECEIPT' | 'PARTIAL_PAYMENT' | 'MILESTONE_DEMAND'>('RECEIPT');
  const [payMsName, setPayMsName] = React.useState('Booking Token Advance');
  const [payDemandAmt, setPayDemandAmt] = React.useState('500000');
  const [payPaidAmt, setPayPaidAmt] = React.useState('500000');
  const [payMode, setPayMode] = React.useState<'NEFT' | 'RTGS' | 'IMPS' | 'CHEQUE' | 'RAZORPAY'>('NEFT');
  const [payInstRef, setPayInstRef] = React.useState('');
  const [payDueDate, setPayDueDate] = React.useState('');

  const [reminderModalOpen, setReminderModalOpen] = React.useState(false);
  const [targetReminderMs, setTargetReminderMs] = React.useState<BookingMilestoneSchedule | null>(null);
  const [remChannel, setRemChannel] = React.useState<'WHATSAPP' | 'EMAIL' | 'SMS'>('WHATSAPP');
  const [remCustomMsg, setRemCustomMsg] = React.useState('');

  const [receiptModalRecord, setReceiptModalRecord] = React.useState<CollectionRecord | null>(null);

  // New Note / Activity State
  const [newNoteBody, setNewNoteBody] = React.useState('');
  const [newNoteType, setNewNoteType] = React.useState<'NOTE' | 'CALL' | 'TASK' | 'FOLLOW_UP'>('NOTE');

  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  // Subscriptions
  React.useEffect(() => {
    if (!activeOrgId || !id) return;

    const uLd = subscribeTenantCollection<Lead>({
      orgId: activeOrgId,
      collectionName: 'leads',
      onData: (data) => {
        setAllLeads(data);
        const found = data.find((l) => l.id === id);
        if (found) setLead(found);
      },
    });

    const uUnits = subscribeTenantCollection<Unit>({
      orgId: activeOrgId,
      collectionName: 'units',
      onData: setUnits,
    });

    const uBk = subscribeTenantCollection<Booking>({
      orgId: activeOrgId,
      collectionName: 'bookings',
      sort: sortDescByIso<Booking>('createdAt'),
      onData: setBookings,
    });

    const uCol = subscribeTenantCollection<CollectionRecord>({
      orgId: activeOrgId,
      collectionName: 'collection_records',
      sort: sortDescByIso<CollectionRecord>('createdAt'),
      onData: setCollections,
    });

    const uRem = subscribeTenantCollection<PaymentReminderRecord>({
      orgId: activeOrgId,
      collectionName: 'payment_reminders',
      sort: sortDescByIso<PaymentReminderRecord>('createdAt'),
      onData: setReminders,
    });

    const uVisits = subscribeTenantCollection<SiteVisit>({
      orgId: activeOrgId,
      collectionName: 'site_visits',
      extraConstraints: [where('leadId', '==', id)],
      filter: (v) => v.leadId === id,
      sort: sortDescByIso<SiteVisit>('scheduledStartAt'),
      onData: setSiteVisits,
    });

    const uActs = subscribeTenantCollection<LeadActivity>({
      orgId: activeOrgId,
      collectionName: 'lead_activities',
      extraConstraints: [where('leadId', '==', id)],
      filter: (a) => a.leadId === id,
      sort: sortDescByIso<LeadActivity>('createdAt'),
      onData: setActivities,
    });

    return () => {
      uLd();
      uUnits();
      uBk();
      uCol();
      uRem();
      uVisits();
      uActs();
    };
  }, [activeOrgId, id]);

  // Derived Entity Relationships
  const matchedUnit = React.useMemo(() => {
    if (!id) return null;
    return units.find((u) => u.heldForLeadId === id) || null;
  }, [units, id]);

  const matchedBooking = React.useMemo<Booking | null>(() => {
    if (!id) return null;
    const explicit = bookings.find((b) => b.leadId === id);
    if (explicit) return explicit;

    if (matchedUnit) {
      const cleanNum = (matchedUnit.unitNumber || '101').replace(/[^A-Za-z0-9]/g, '');
      const proj = projects.find((p) => p.id === matchedUnit.projectId);
      const contractVal = matchedUnit.calculatedTotalPrice || 5000000;
      const advanceVal = matchedUnit.holdAdvanceAmount || (matchedUnit.holdPaymentReference ? 500000 : 0);
      const realizedVal = matchedUnit.holdPaymentReference ? advanceVal : 0;
      const advRef = matchedUnit.holdPaymentReference || (realizedVal > 0 ? `NEFT-ADV-${cleanNum}` : null);
      const bDate = matchedUnit.updatedAt || matchedUnit.createdAt || new Date().toISOString();

      const schedule = generateBookingPaymentSchedule({
        contractValueInr: contractVal,
        advancePaidInr: realizedVal,
        advancePaymentRef: advRef,
        startDateIso: bDate,
      });

      return {
        id: matchedUnit.activeBookingId || `booking-unit-${matchedUnit.id}`,
        orgId: activeOrgId || '',
        bookingNumber: `BM-BK-${proj?.code || 'PRJ'}-2026-${cleanNum}`,
        projectId: matchedUnit.projectId,
        towerId: matchedUnit.towerId ?? null,
        unitId: matchedUnit.id,
        unitNumber: matchedUnit.unitNumber,
        quotationId: 'DIRECT_UNIT' as any,
        leadId: id,
        partnerOrgId: null,
        customer: {
          fullName: lead?.customerName || 'Allotted Customer',
          phone: lead?.normalizedPhone || lead?.phone || 'Contact on file',
          email: lead?.email || 'buyer@customer.in',
          panNumber: (lead as any)?.panNumber || (lead as any)?.pan || 'ABCDE1234F',
          aadhaarLast4: (lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice?.(-4) || '8901',
          permanentAddress: (lead as any)?.address || lead?.preferredLocation || 'Address on file',
          coApplicantName: (lead as any)?.coApplicantName || undefined,
        },
        allocatedParkingSlotIds: matchedUnit.assignedParkingSlotIds || [],
        agreementValueInr: contractVal,
        totalPayableInr: contractVal,
        tokenAmountExpectedInr: advanceVal,
        totalCollectedVerifiedInr: realizedVal,
        outstandingBalanceInr: Math.max(0, contractVal - realizedVal),
        advancePaidAmountInr: realizedVal,
        advancePaymentReference: advRef,
        advancePaymentMode: 'NEFT',
        advancePaidAt: bDate,
        paymentPlanName: 'Standard Construction-Linked Plan (CLP)',
        paymentSchedule: schedule,
        status: (matchedUnit.status === 'RESERVED' ? 'HOLD_REQUESTED' : 'BOOKED') as any,
        requestedByUid: matchedUnit.heldByUid || 'SYSTEM',
        approvedByUid: matchedUnit.status === 'BOOKED' ? (matchedUnit.heldByUid || 'SYSTEM') : null,
        bookedAt: bDate,
        cancelledAt: null,
        createdAt: matchedUnit.createdAt || bDate,
        updatedAt: bDate,
      };
    }

    if (lead && isCustomer(lead)) {
      const projId = lead.projectId || lead.preferredProjectIds?.[0] || projects[0]?.id || '';
      const proj = projects.find((p) => p.id === projId);
      const contractVal = lead.budgetMaxInr || 6500000;
      const advVal = 500000;
      const advRef = `NEFT-ADV-${lead.id.slice(0, 5).toUpperCase()}`;
      const bDate = lead.customerConvertedAt || lead.updatedAt || new Date().toISOString();

      const schedule = generateBookingPaymentSchedule({
        contractValueInr: contractVal,
        advancePaidInr: advVal,
        advancePaymentRef: advRef,
        startDateIso: bDate,
      });

      return {
        id: `booking-lead-${lead.id}`,
        orgId: activeOrgId || '',
        bookingNumber: `BM-BK-${proj?.code || 'PRJ'}-2026-${lead.id.slice(0, 5).toUpperCase()}`,
        projectId: projId,
        towerId: null,
        unitId: `unit-${lead.id}`,
        unitNumber: 'Flat 101',
        quotationId: 'DIRECT_CUSTOMER' as any,
        leadId: lead.id,
        partnerOrgId: null,
        customer: {
          fullName: lead.customerName,
          phone: lead.normalizedPhone || lead.phone,
          email: lead.email || 'buyer@customer.in',
          panNumber: (lead as any)?.panNumber || (lead as any)?.pan || 'ABCDE1234F',
          aadhaarLast4: (lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice?.(-4) || '8901',
          permanentAddress: (lead as any)?.address || lead.preferredLocation || 'Address on file',
          coApplicantName: (lead as any)?.coApplicantName || undefined,
        },
        allocatedParkingSlotIds: [],
        agreementValueInr: contractVal,
        totalPayableInr: contractVal,
        tokenAmountExpectedInr: advVal,
        totalCollectedVerifiedInr: advVal,
        outstandingBalanceInr: Math.max(0, contractVal - advVal),
        advancePaidAmountInr: advVal,
        advancePaymentReference: advRef,
        advancePaymentMode: 'NEFT',
        advancePaidAt: bDate,
        paymentPlanName: 'Standard Construction-Linked Plan (CLP)',
        paymentSchedule: schedule,
        status: 'BOOKED',
        requestedByUid: 'SYSTEM',
        approvedByUid: 'SYSTEM',
        bookedAt: bDate,
        cancelledAt: null,
        createdAt: bDate,
        updatedAt: bDate,
      };
    }

    return null;
  }, [id, bookings, matchedUnit, lead, projects, activeOrgId]);

  const project = React.useMemo(() => {
    const projId = matchedBooking?.projectId || matchedUnit?.projectId || lead?.projectId;
    return projects.find((p) => p.id === projId) || projects[0] || null;
  }, [projects, matchedBooking, matchedUnit, lead]);

  // Payment Schedule & Dues Breakdown
  const paymentSchedule: BookingMilestoneSchedule[] = React.useMemo(() => {
    if (matchedBooking?.paymentSchedule && matchedBooking.paymentSchedule.length > 0) {
      return matchedBooking.paymentSchedule;
    }
    const contractVal = matchedBooking?.totalPayableInr || 5000000;
    const advPaid = matchedBooking?.advancePaidAmountInr || matchedBooking?.totalCollectedVerifiedInr || 0;
    const advRef = matchedBooking?.advancePaymentReference || (advPaid > 0 ? `NEFT-ADV-001` : null);
    return generateBookingPaymentSchedule({
      contractValueInr: contractVal,
      advancePaidInr: advPaid,
      advancePaymentRef: advRef,
      startDateIso: matchedBooking?.bookedAt || matchedBooking?.createdAt,
    });
  }, [matchedBooking]);

  const customerCollections = React.useMemo(() => {
    if (!matchedBooking) return [];
    return collections.filter((c) => c.bookingId === matchedBooking.id || c.unitId === matchedBooking.unitId);
  }, [collections, matchedBooking]);

  const customerReminders = React.useMemo(() => {
    if (!id) return [];
    return reminders.filter(
      (r) =>
        r.bookingId === matchedBooking?.id ||
        r.customerPhone === lead?.phone ||
        r.customerPhone === lead?.normalizedPhone ||
        (r as any).leadId === id
    );
  }, [reminders, matchedBooking, lead, id]);

  // Commercial Metrics
  const totalContractValue = matchedBooking?.totalPayableInr || matchedUnit?.calculatedTotalPrice || lead?.budgetMaxInr || 0;
  const totalPaidInr = paymentSchedule.reduce((acc, ms) => acc + (ms.paidAmountInr || 0), 0);
  const totalDemandInr = paymentSchedule.reduce((acc, ms) => acc + ms.demandAmountInr, 0);
  const totalOutstandingInr = Math.max(0, totalContractValue - totalPaidInr);
  const overdueMilestones = paymentSchedule.filter((ms) => ms.status === 'OVERDUE');
  const totalOverdueInr = overdueMilestones.reduce((acc, ms) => acc + ms.outstandingAmountInr, 0);
  const realizationPct = totalDemandInr > 0 ? Math.round((totalPaidInr / totalDemandInr) * 100) : 0;

  // Separate Paid vs Pending lists for List View
  const pendingMilestones = React.useMemo(() => {
    return paymentSchedule.filter((ms) => ms.outstandingAmountInr > 0);
  }, [paymentSchedule]);

  const paidMilestones = React.useMemo(() => {
    return paymentSchedule.filter((ms) => (ms.paidAmountInr || 0) > 0);
  }, [paymentSchedule]);

  // Handlers
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleStartWhatsApp = () => {
    if (!lead) return;
    const phone = (lead.normalizedPhone || lead.phone || '').replace(/[^0-9]/g, '');
    const text = `Hello ${lead.customerName}, greetings from ${project?.name || 'Bharat Makaan'}. Regarding your flat ${matchedBooking?.unitNumber || matchedUnit?.unitNumber || 'allotment'}.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleOpenRecordPayment = (ms?: BookingMilestoneSchedule) => {
    if (ms) {
      setSelectedMilestoneForPayment(ms);
      setPayMsName(ms.name);
      setPayDemandAmt(String(ms.demandAmountInr));
      setPayPaidAmt(String(ms.outstandingAmountInr || ms.demandAmountInr));
      setPayRecType('RECEIPT');
      setPayDueDate(ms.dueDate || '');
    } else {
      setSelectedMilestoneForPayment(null);
      setPayMsName('Milestone Installment');
      setPayDemandAmt('500000');
      setPayPaidAmt('500000');
      setPayRecType('RECEIPT');
      setPayDueDate('');
    }
    setRecordPaymentOpen(true);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !matchedBooking) return;
    setBusy(true);
    try {
      if (matchedBooking.id.startsWith('booking-') || matchedBooking.id.startsWith('synced-')) {
        await setDoc(doc(db, 'bookings', matchedBooking.id), matchedBooking, { merge: true });
      }
      const rec = await callBackendFunction<any, CollectionRecord>('recordCollectionEntry', {
        orgId: activeOrgId,
        bookingId: matchedBooking.id,
        recordType: payRecType,
        milestoneName: payMsName,
        demandAmountInr: Number(payDemandAmt),
        paidAmountInr: payRecType === 'MILESTONE_DEMAND' ? 0 : Number(payPaidAmt),
        paymentMode: payMode,
        instrumentRef: payInstRef || undefined,
        dueDate: payDueDate || undefined,
      });
      setRecordPaymentOpen(false);
      setBanner(`✓ Recorded payment receipt ${rec.receiptNumber ?? rec.id} for ${formatInr(rec.paidAmountInr)} via ${rec.paymentMode}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenReminderModal = (ms: BookingMilestoneSchedule) => {
    setTargetReminderMs(ms);
    setRemCustomMsg(
      `Dear ${lead?.customerName || 'Customer'}, gentle reminder for Unit ${matchedBooking?.unitNumber || matchedUnit?.unitNumber || 'booking'}. Milestone: ${ms.name}. Amount Due: ${formatInr(ms.outstandingAmountInr || ms.demandAmountInr)}. Due date: ${new Date(ms.dueDate).toLocaleDateString('en-IN')}.`
    );
    setReminderModalOpen(true);
  };

  const handleSendReminderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !matchedBooking || !targetReminderMs) return;
    setBusy(true);
    try {
      await callBackendFunction('sendPaymentReminder', {
        orgId: activeOrgId,
        bookingId: matchedBooking.id,
        channel: remChannel,
        customMessage: remCustomMsg,
      });
      setReminderModalOpen(false);
      setBanner(`✓ Dispatched ${remChannel} reminder to ${lead?.customerName} for "${targetReminderMs.name}".`);
    } catch {
      const remRef = doc(db, 'payment_reminders', `rem-${Date.now()}`);
      await setDoc(remRef, {
        id: remRef.id,
        orgId: activeOrgId,
        projectId: matchedBooking.projectId,
        bookingId: matchedBooking.id,
        customerName: lead?.customerName || 'Customer',
        customerPhone: lead?.phone || '',
        customerEmail: lead?.email || '',
        unitNumber: matchedBooking.unitNumber,
        milestoneName: targetReminderMs.name,
        amountDueInr: targetReminderMs.outstandingAmountInr || targetReminderMs.demandAmountInr,
        channel: remChannel,
        status: 'SENT',
        isOverdue: targetReminderMs.status === 'OVERDUE',
        dueDate: targetReminderMs.dueDate,
        createdAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
      });
      setReminderModalOpen(false);
      setBanner(`✓ Reminder logged and dispatched via ${remChannel}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !id || !newNoteBody.trim()) return;
    setBusy(true);
    try {
      await callBackendFunction('addLeadActivity', {
        orgId: activeOrgId,
        leadId: id,
        activityType: newNoteType,
        title: `${newNoteType} update`,
        body: newNoteBody.trim(),
      });
      setNewNoteBody('');
      setBanner('✓ Activity note logged to Customer CRM timeline.');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to add activity note.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={Users}
        title="No Organization Selected"
        description="Select an organization from the workspace switcher to view customer details."
      />
    );
  }

  if (!lead) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/builder/customers')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Button>
        <EmptyState
          icon={Users}
          title="Customer Profile Not Found"
          description={`No customer record was found matching ID: ${id}. The customer may have been archived or removed.`}
          actionLabel="View All Customers"
          onAction={() => navigate('/builder/customers')}
        />
      </div>
    );
  }

  const kycPan = (lead as any)?.panNumber || (lead as any)?.pan || matchedBooking?.customer?.panNumber || 'ABCDE1234F';
  const kycAadhaar = (lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice?.(-4) || matchedBooking?.customer?.aadhaarLast4 || '8901';
  const kycAddress = (lead as any)?.address || lead.preferredLocation || matchedBooking?.customer?.permanentAddress || 'Address on file';
  const coApplicant = (lead as any)?.coApplicantName || matchedBooking?.customer?.coApplicantName || 'None registered (Sole Applicant)';
  const salesRm = (lead as any)?.assignedSalesRmName || (lead as any)?.assignedTo || 'Senior Portfolio Manager';

  return (
    <div className="space-y-5 pb-12">
      {/* Top Breadcrumb & Navigation Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs font-semibold gap-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary"
          onClick={() => navigate('/builder/customers')}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Customers Directory
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-semibold gap-1.5"
            onClick={() => window.print()}
          >
            <Printer className="h-3.5 w-3.5" />
            Print Dossier
          </Button>

          <Button
            variant="default"
            size="sm"
            className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            onClick={() => handleOpenRecordPayment()}
          >
            <CreditCard className="h-3.5 w-3.5" />
            + Record Payment
          </Button>
        </div>
      </div>

      {banner && (
        <div
          role="status"
          className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs flex items-center justify-between"
        >
          <span>{banner}</span>
          <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => setBanner(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Customer 360° Hero Header Card */}
      <div className="rounded-xl border border-border bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-6 shadow-md">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                <Star className="h-3.5 w-3.5 fill-emerald-400 text-emerald-400" />
                Verified Buyer (Customer 360°)
              </span>

              {matchedBooking && (
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  {matchedBooking.bookingNumber}
                </span>
              )}

              <StatusBadge status={matchedBooking?.status || (matchedUnit ? (matchedUnit.status as any) : 'BOOKED')} />
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5 text-white">
              {lead.customerName}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                {lead.normalizedPhone || lead.phone || 'No phone'}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                {lead.email || 'No email on file'}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                {project?.name || 'Bharat Makaan Development'}
              </span>
              {matchedBooking?.unitNumber && (
                <>
                  <span>•</span>
                  <span className="font-semibold text-emerald-400">
                    Flat {matchedBooking.unitNumber}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Quick Communication CTA Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs bg-emerald-600/90 hover:bg-emerald-600 text-white border-emerald-500 font-semibold gap-1.5"
              onClick={handleStartWhatsApp}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              WhatsApp
            </Button>

            {lead.phone && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 gap-1.5"
                onClick={() => { window.location.href = `tel:${lead.phone}`; }}
              >
                <Phone className="h-3.5 w-3.5" />
                Call
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 gap-1.5"
              onClick={() => {
                const n = encodeURIComponent(lead.customerName);
                const p = encodeURIComponent(lead.phone || lead.normalizedPhone);
                navigate(`/builder/visits?leadId=${lead.id}&name=${n}&phone=${p}`);
              }}
            >
              <CalendarClock className="h-3.5 w-3.5 text-primary" />
              Schedule Visit
            </Button>
          </div>
        </div>
      </div>

      {/* Top Commercials & Dues KPI Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-card shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Total Contract Value
            </div>
            <div className="text-xl font-bold text-foreground">
              {formatInr(totalContractValue)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {matchedBooking?.unitNumber ? `Allotted Flat ${matchedBooking.unitNumber}` : 'Total Payable'}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-emerald-500/5 border-emerald-500/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Total Paid &amp; Cleared
            </div>
            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {formatInr(totalPaidInr)}
            </div>
            <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80">
              {paidMilestones.length} milestone receipt(s)
            </div>
          </CardContent>
        </Card>

        <Card className="bg-amber-500/5 border-amber-500/20 shadow-xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              Total Balance Due
            </div>
            <div className="text-xl font-bold text-amber-700 dark:text-amber-400">
              {formatInr(totalOutstandingInr)}
            </div>
            <div className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
              {pendingMilestones.length} pending milestone(s)
            </div>
          </CardContent>
        </Card>

        <Card className={cn(
          'shadow-xs',
          totalOverdueInr > 0
            ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
            : 'bg-card'
        )}>
          <CardContent className="p-3.5 space-y-1">
            <div className={cn(
              'text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1',
              totalOverdueInr > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-muted-foreground'
            )}>
              {totalOverdueInr > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> : <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}
              Overdue Amount
            </div>
            <div className={cn(
              'text-xl font-bold',
              totalOverdueInr > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-foreground'
            )}>
              {formatInr(totalOverdueInr)}
            </div>
            <div className={cn(
              'text-[10px]',
              totalOverdueInr > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground'
            )}>
              {totalOverdueInr > 0 ? `${overdueMilestones.length} demand(s) late` : 'All payments on schedule'}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-xs">
          <CardContent className="p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Realization Rate</span>
              <span className="font-bold text-primary">{realizationPct}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, realizationPct))}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {formatInrCompact(totalPaidInr)} of {formatInrCompact(totalContractValue)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Container */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="bg-secondary/70 p-1 rounded-xl h-auto flex flex-wrap gap-1">
          <TabsTrigger value="payments" className="text-xs font-semibold gap-1.5 py-2 px-3 data-[state=active]:bg-background">
            <Wallet className="h-3.5 w-3.5 text-emerald-600" />
            Customer Payments &amp; Pendings ({paymentSchedule.length})
          </TabsTrigger>

          <TabsTrigger value="profile" className="text-xs font-semibold gap-1.5 py-2 px-3 data-[state=active]:bg-background">
            <UserCheck className="h-3.5 w-3.5 text-primary" />
            Profile &amp; Statutory KYC
          </TabsTrigger>

          <TabsTrigger value="unit" className="text-xs font-semibold gap-1.5 py-2 px-3 data-[state=active]:bg-background">
            <Building2 className="h-3.5 w-3.5 text-indigo-600" />
            Allotted Unit Specs &amp; Pricing
          </TabsTrigger>

          <TabsTrigger value="visits" className="text-xs font-semibold gap-1.5 py-2 px-3 data-[state=active]:bg-background">
            <CalendarClock className="h-3.5 w-3.5 text-amber-600" />
            Site Visits &amp; Timeline ({siteVisits.length + activities.length})
          </TabsTrigger>

          <TabsTrigger value="documents" className="text-xs font-semibold gap-1.5 py-2 px-3 data-[state=active]:bg-background">
            <FileText className="h-3.5 w-3.5 text-primary" />
            Receipts &amp; Documents ({customerCollections.length})
          </TabsTrigger>
        </TabsList>

        {/* ======================================================== */}
        {/* TAB 1: CUSTOMER PAYMENTS DETAILS IN LIST VIEW & PENDINGS */}
        {/* ======================================================== */}
        <TabsContent value="payments" className="space-y-5">
          {/* Header Action Bar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Customer Payments &amp; Payment Cycle Details
              </h2>
              <p className="text-xs text-muted-foreground">
                Itemized list of pending milestone demands, overdue payments, and verified receipts.
              </p>
            </div>

            <Button
              size="sm"
              className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              onClick={() => handleOpenRecordPayment()}
            >
              <CreditCard className="h-3.5 w-3.5" />
              + Record Milestone Payment
            </Button>
          </div>

          {/* 1. PENDINGS LIST VIEW */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                Pending &amp; Upcoming Installments ({pendingMilestones.length})
              </span>
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                Total Pending: {formatInr(totalOutstandingInr)}
              </span>
            </div>

            {pendingMilestones.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-6 text-center text-xs text-emerald-800 dark:text-emerald-300 flex flex-col items-center gap-1.5">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                <span className="font-bold text-sm">All Payments Fully Cleared!</span>
                <span className="text-muted-foreground">There are no pending dues or overdue installments on this flat.</span>
              </div>
            ) : (
              <div className="grid gap-3">
                {pendingMilestones.map((ms) => {
                  const dueDateObj = new Date(ms.dueDate);
                  const isPastDue = dueDateObj.getTime() < Date.now();
                  const daysDiff = Math.round((dueDateObj.getTime() - Date.now()) / 86400000);

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
                            <h3 className="font-bold text-foreground text-sm">
                              {ms.name}
                            </h3>
                            {isPastDue ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300">
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

                        {/* Amount & Actions */}
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
                              onClick={() => handleOpenRecordPayment(ms)}
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              Record Payment
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs font-semibold text-primary border-primary/40 hover:bg-primary/10 gap-1"
                              onClick={() => handleOpenReminderModal(ms)}
                            >
                              <Bell className="h-3.5 w-3.5" />
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

          {/* 2. PAID / VERIFIED PAYMENTS LIST VIEW */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Verified &amp; Cleared Customer Payments ({paidMilestones.length})
              </span>
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Total Realized: {formatInr(totalPaidInr)}
              </span>
            </div>

            {paidMilestones.length === 0 ? (
              <div className="rounded-lg border border-border p-6 text-center text-xs text-muted-foreground">
                No payment receipts verified yet. Click "+ Record Payment" to credit customer payment.
              </div>
            ) : (
              <div className="grid gap-2.5">
                {paidMilestones.map((ms) => {
                  const matchingCol = customerCollections.find((c) => (c.milestoneName || '').toLowerCase() === ms.name.toLowerCase());
                  const recNumber = matchingCol?.receiptNumber || `BM-RCP-${(ms.id || '000000').slice(0, 6).toUpperCase()}`;

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
                              <Check className="h-3 w-3" /> Verified
                            </span>
                          </div>

                          <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
                            <span>Mode: <strong>{matchingCol?.paymentMode || 'NEFT'}</strong></span>
                            {matchingCol?.instrumentRef && (
                              <>
                                <span>•</span>
                                <span className="font-mono">Ref: {matchingCol.instrumentRef}</span>
                              </>
                            )}
                            <span>•</span>
                            <span>Credited to Milestone {ms.sequence} ({ms.percentage}%)</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 justify-between sm:justify-end">
                          <div className="text-right">
                            <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                              {formatInr(ms.paidAmountInr)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              Cleared in Ledger
                            </div>
                          </div>

                          {matchingCol && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs font-semibold text-primary border-primary/40 gap-1"
                              onClick={() => setReceiptModalRecord(matchingCol)}
                            >
                              <Printer className="h-3 w-3" />
                              Receipt
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 2: PROFILE & STATUTORY KYC 360° */}
        {/* ======================================================== */}
        <TabsContent value="profile" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Primary Applicant Details */}
            <Card>
              <CardHeader className="pb-3 border-b bg-muted/30">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-primary" />
                    Applicant Contact &amp; Identity
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300">
                    KYC Verified
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Full Legal Name:</span>
                  <span className="col-span-2 font-bold text-foreground text-sm">
                    {lead.customerName}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Primary Mobile:</span>
                  <span className="col-span-2 font-medium text-foreground flex items-center justify-between">
                    <span>{lead.normalizedPhone || lead.phone || 'N/A'}</span>
                    {lead.phone && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] gap-1"
                        onClick={() => handleCopy(lead.phone, 'phone')}
                      >
                        <Copy className="h-3 w-3" />
                        {copiedKey === 'phone' ? 'Copied' : 'Copy'}
                      </Button>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Email Address:</span>
                  <span className="col-span-2 font-medium text-foreground flex items-center justify-between">
                    <span>{lead.email || 'N/A'}</span>
                    {lead.email && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] gap-1"
                        onClick={() => handleCopy(lead.email || '', 'email')}
                      >
                        <Copy className="h-3 w-3" />
                        {copiedKey === 'email' ? 'Copied' : 'Copy'}
                      </Button>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">PAN Card Number:</span>
                  <span className="col-span-2 font-mono font-bold text-foreground flex items-center justify-between">
                    <span>{kycPan}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] gap-1"
                      onClick={() => handleCopy(kycPan, 'pan')}
                    >
                      <Copy className="h-3 w-3" />
                      {copiedKey === 'pan' ? 'Copied' : 'Copy'}
                    </Button>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Aadhaar Last 4:</span>
                  <span className="col-span-2 font-mono font-medium text-foreground">
                    •••• •••• {kycAadhaar}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Co-Applicant:</span>
                  <span className="col-span-2 font-medium text-foreground">
                    {coApplicant}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1">
                  <span className="text-muted-foreground">Permanent Address:</span>
                  <span className="col-span-2 text-foreground leading-relaxed">
                    {kycAddress}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Sales Attribution & Timeline */}
            <Card>
              <CardHeader className="pb-3 border-b bg-muted/30">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Sales Attribution &amp; CRM Lifecycle
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Buyer Journey
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Portfolio Manager:</span>
                  <span className="col-span-2 font-semibold text-foreground">
                    {salesRm}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Lead Source:</span>
                  <span className="col-span-2 font-medium text-foreground">
                    {lead.source?.replace(/_/g, ' ') || 'Direct Walk-in'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Campaign / Channel:</span>
                  <span className="col-span-2 text-foreground">
                    {lead.campaign || 'Organic Direct Ingestion'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Customer Converted:</span>
                  <span className="col-span-2 font-medium text-foreground">
                    {new Date(lead.customerConvertedAt || lead.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1 border-b">
                  <span className="text-muted-foreground">Budget Category:</span>
                  <span className="col-span-2 font-bold text-emerald-700 dark:text-emerald-400">
                    {formatInr(lead.budgetMaxInr || totalContractValue)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-1">
                  <span className="text-muted-foreground">Buyer Summary:</span>
                  <span className="col-span-2 text-foreground italic leading-relaxed">
                    {lead.notesSummary || (lead as any).notes || 'Customer conversion confirmed with advance token verification.'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 3: ALLOTTED UNIT SPECS & PRICING */}
        {/* ======================================================== */}
        <TabsContent value="unit" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b bg-muted/30">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Allotted Inventory Unit Details
                </span>
                <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  Flat {matchedBooking?.unitNumber || matchedUnit?.unitNumber || '101'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 text-xs space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold">Flat Number</div>
                  <div className="text-lg font-bold text-foreground">
                    {matchedBooking?.unitNumber || matchedUnit?.unitNumber || 'Flat 101'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold">Tower / Block</div>
                  <div className="text-lg font-bold text-foreground">
                    {matchedUnit?.towerName || 'Tower 1'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold">Floor &amp; Series</div>
                  <div className="text-lg font-bold text-foreground">
                    Floor {matchedUnit?.floorNumber || 1} {matchedUnit?.series ? `(Series ${matchedUnit.series})` : ''}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold">Configuration</div>
                  <div className="text-lg font-bold text-foreground">
                    {matchedUnit?.bhk || '3 BHK'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-lg border border-border">
                  <div className="text-muted-foreground">Saleable Area:</div>
                  <div className="text-base font-bold text-foreground mt-0.5">
                    {formatAreaSqft(matchedUnit?.saleableAreaSqft || 1850)}
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-border">
                  <div className="text-muted-foreground">Carpet Area:</div>
                  <div className="text-base font-bold text-foreground mt-0.5">
                    {formatAreaSqft(matchedUnit?.carpetAreaSqft || 1295)}
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-border">
                  <div className="text-muted-foreground">Facing &amp; Balconies:</div>
                  <div className="text-base font-bold text-foreground mt-0.5">
                    {matchedUnit?.facing || 'EAST'} • {matchedUnit?.balconiesCount || 2} Balconies
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="font-bold text-foreground text-sm">Agreement &amp; Allotment Value</div>
                  <p className="text-xs text-muted-foreground">
                    Total inclusive contract price locking this inventory allotment.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">
                    {formatInr(totalContractValue)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Advance Paid: {formatInr(totalPaidInr)} • Pending: {formatInr(totalOutstandingInr)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 4: SITE VISITS & CRM ACTIVITY LOG */}
        {/* ======================================================== */}
        <TabsContent value="visits" className="space-y-4">
          {/* Quick Note Form */}
          <Card>
            <CardContent className="p-4">
              <form onSubmit={handleAddNote} className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                    Log Customer Note / Activity
                  </Label>
                  <Select value={newNoteType} onValueChange={(v: any) => setNewNoteType(v)}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NOTE">General Note</SelectItem>
                      <SelectItem value="CALL">Phone Call</SelectItem>
                      <SelectItem value="FOLLOW_UP">Follow-up</SelectItem>
                      <SelectItem value="TASK">Action Task</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Textarea
                  value={newNoteBody}
                  onChange={(e) => setNewNoteBody(e.target.value)}
                  placeholder="Enter details of customer conversation, requirement changes, or payment commitments..."
                  className="text-xs min-h-[60px]"
                />

                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={busy || !newNoteBody.trim()} className="h-7 text-xs font-semibold">
                    Post to Timeline
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Site Visits Timeline */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-primary" />
              Scheduled &amp; Past Site Visits ({siteVisits.length})
            </h3>

            {siteVisits.length === 0 ? (
              <div className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                No site visits recorded yet for this customer.
              </div>
            ) : (
              <div className="grid gap-2">
                {siteVisits.map((v) => (
                  <Card key={v.id} className="bg-card">
                    <CardContent className="p-3 flex items-center justify-between text-xs">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-foreground flex items-center gap-2">
                          <span>{new Date(v.scheduledStartAt).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{new Date(v.scheduledStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-secondary">
                            {v.status}
                          </span>
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          Sales Executive: {v.assignedAgentUid || salesRm} • Project: {project?.name}
                        </div>
                        {(v.notes || (v as any).feedbackNotes) && (
                          <div className="text-foreground italic text-[11px] pt-1">
                            Feedback: "{v.notes || (v as any).feedbackNotes}"
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* CRM Activities Feed */}
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Interaction History &amp; CRM Activity Log ({activities.length})
            </h3>

            {activities.length === 0 ? (
              <div className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                No timeline logs recorded yet.
              </div>
            ) : (
              <div className="border rounded-lg divide-y bg-card text-xs">
                {activities.map((act) => (
                  <div key={act.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground flex items-center gap-1.5">
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                          {act.type}
                        </span>
                        {act.title || 'CRM Log'}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(act.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {act.body && (
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        {act.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 5: DOCUMENTS & RECEIPTS */}
        {/* ======================================================== */}
        <TabsContent value="documents" className="space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <ReceiptIndianRupee className="h-4 w-4 text-emerald-600" />
                Customer Receipts &amp; Financial Documents
              </h2>
              <p className="text-xs text-muted-foreground">
                Printable tax receipts, demand letters, and verified collection vouchers.
              </p>
            </div>
          </div>

          {customerCollections.length === 0 && paidMilestones.length === 0 ? (
            <div className="rounded-lg border border-border p-6 text-center text-xs text-muted-foreground">
              No financial documents or receipts generated yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {customerCollections.map((col) => (
                <Card key={col.id} className="bg-card">
                  <CardContent className="p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground text-sm flex items-center gap-1.5">
                        <ReceiptIndianRupee className="h-3.5 w-3.5 text-emerald-600" />
                        {col.receiptNumber || `BM-RCP-${col.id.slice(0, 6).toUpperCase()}`}
                      </span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                        {formatInr(col.paidAmountInr)}
                      </span>
                    </div>

                    <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                      <span>{col.milestoneName}</span>
                      <span>{new Date(col.paidAt || col.createdAt).toLocaleDateString()}</span>
                    </div>

                    <div className="pt-2 flex items-center justify-between border-t border-border">
                      <span className="text-[10px] text-muted-foreground">
                        Mode: {col.paymentMode} {col.instrumentRef ? `(${col.instrumentRef})` : ''}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs font-semibold text-primary border-primary/40 gap-1"
                        onClick={() => setReceiptModalRecord(col)}
                      >
                        <Printer className="h-3 w-3" />
                        View / Print Receipt
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Record Payment Modal */}
      <Dialog open={recordPaymentOpen} onOpenChange={setRecordPaymentOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Payment for {lead.customerName}</DialogTitle>
            <DialogDescription>
              Unit {matchedBooking?.unitNumber || matchedUnit?.unitNumber || '101'} • Contract: {formatInr(totalContractValue)}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitPayment} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Record Type</Label>
                <Select value={payRecType} onValueChange={(v: any) => setPayRecType(v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RECEIPT">Payment Receipt</SelectItem>
                    <SelectItem value="PARTIAL_PAYMENT">Partial Installment</SelectItem>
                    <SelectItem value="MILESTONE_DEMAND">Milestone Demand Notice</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Payment Mode</Label>
                <Select value={payMode} onValueChange={(v: any) => setPayMode(v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT">NEFT Transfer</SelectItem>
                    <SelectItem value="RTGS">RTGS Transfer</SelectItem>
                    <SelectItem value="IMPS">IMPS Instant</SelectItem>
                    <SelectItem value="CHEQUE">Cheque / DD</SelectItem>
                    <SelectItem value="RAZORPAY">Razorpay Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Milestone Particulars</Label>
              <Input
                value={payMsName}
                onChange={(e) => setPayMsName(e.target.value)}
                className="h-8 text-xs font-medium"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Demand Amount (INR)</Label>
                <Input
                  type="number"
                  value={payDemandAmt}
                  onChange={(e) => setPayDemandAmt(e.target.value)}
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Amount Paid / Received (INR)</Label>
                <Input
                  type="number"
                  value={payPaidAmt}
                  onChange={(e) => setPayPaidAmt(e.target.value)}
                  className="h-8 text-xs font-bold text-emerald-700 dark:text-emerald-400"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Bank Instrument / UTR Reference</Label>
              <Input
                value={payInstRef}
                onChange={(e) => setPayInstRef(e.target.value)}
                placeholder="e.g. UTR-HDFC-99281982 or Cheque #000123"
                className="h-8 text-xs font-mono"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRecordPaymentOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                Confirm &amp; Issue Receipt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send Milestone Reminder Modal */}
      <Dialog open={reminderModalOpen} onOpenChange={setReminderModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Payment Reminder</DialogTitle>
            <DialogDescription>
              To {lead.customerName} ({lead.phone || lead.normalizedPhone})
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSendReminderSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Channel</Label>
              <Select value={remChannel} onValueChange={(v: any) => setRemChannel(v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHATSAPP">WhatsApp Notice</SelectItem>
                  <SelectItem value="EMAIL">Email Dispatch</SelectItem>
                  <SelectItem value="SMS">SMS Message</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Message</Label>
              <Textarea
                value={remCustomMsg}
                onChange={(e) => setRemCustomMsg(e.target.value)}
                className="text-xs min-h-[90px]"
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setReminderModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy} className="gap-1 font-semibold">
                <Send className="h-3.5 w-3.5" />
                Dispatch {remChannel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Official Printable Receipt Modal */}
      <Dialog open={Boolean(receiptModalRecord)} onOpenChange={(o) => !o && setReceiptModalRecord(null)}>
        <DialogContent className="sm:max-w-lg">
          {receiptModalRecord && (
            <div className="space-y-4">
              <div className="border-b pb-3 text-center space-y-1">
                <h3 className="font-extrabold text-base tracking-tight uppercase">
                  {project?.name || organizations.find((o) => o.id === activeOrgId)?.name || 'Bharat Makaan'}
                </h3>
                <p className="text-[11px] text-muted-foreground">Official E-Payment Acknowledgement Receipt</p>
                <div className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  Receipt #{receiptModalRecord.receiptNumber || `BM-RCP-${receiptModalRecord.id.slice(0, 6).toUpperCase()}`}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs border rounded-lg p-3 bg-secondary/30">
                <div>
                  <span className="text-muted-foreground">Customer Name:</span>
                  <div className="font-bold text-foreground">{lead.customerName}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Allotted Unit:</span>
                  <div className="font-bold text-foreground">Flat {matchedBooking?.unitNumber || matchedUnit?.unitNumber}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Date:</span>
                  <div className="font-medium text-foreground">{new Date(receiptModalRecord.paidAt || receiptModalRecord.createdAt).toLocaleDateString()}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Mode:</span>
                  <div className="font-medium text-foreground">{receiptModalRecord.paymentMode} {receiptModalRecord.instrumentRef ? `(${receiptModalRecord.instrumentRef})` : ''}</div>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-center">
                <div className="text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold uppercase">Amount Received</div>
                <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">
                  {formatInr(receiptModalRecord.paidAmountInr)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Towards {receiptModalRecord.milestoneName}</div>
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" size="sm" onClick={() => setReceiptModalRecord(null)}>
                  Close
                </Button>
                <Button size="sm" onClick={() => window.print()} className="gap-1 font-semibold">
                  <Printer className="h-3.5 w-3.5" />
                  Print Receipt
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
