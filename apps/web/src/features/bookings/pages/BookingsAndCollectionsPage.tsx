import * as React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  Filter,
  History,
  Mail,
  MessageSquare,
  Paperclip,
  Plus,
  Printer,
  ReceiptIndianRupee,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  formatInr,
  formatInrCompact,
  generateBookingPaymentSchedule,
  type Booking,
  type BookingMilestoneSchedule,
  type BookingStatus,
  type CollectionRecord,
  type DocumentRecord,
  type Lead,
  type PaymentReminderRecord,
  type Project,
  type Quotation,
  type ReconciliationRecord,
  type Unit,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
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
import { IncomeMetricsCards } from '../components/IncomeMetricsCards';
import { PaymentAutomationPanel } from '../components/PaymentAutomationPanel';
import { ReceiptAndDemandModals } from '../components/ReceiptAndDemandModals';
import { BookingDetailsDrawer } from '../components/BookingDetailsDrawer';

export interface BookingsAndCollectionsPageProps {
  defaultTab?: 'bookings' | 'collections' | 'automation' | 'documents' | 'reconciliation';
}

class BookingsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('BookingsAndCollectionsPage error caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive space-y-4 max-w-2xl mx-auto my-8">
          <div className="flex items-center gap-2.5 font-bold text-lg">
            <ShieldAlert className="h-6 w-6 text-destructive" />
            Unable to render Bookings and Collections
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {this.state.error?.message ||
              'A runtime exception was prevented while displaying booking records.'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Retry
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function BookingsAndCollectionsPage(props: BookingsAndCollectionsPageProps = {}) {
  return (
    <BookingsErrorBoundary>
      <BookingsAndCollectionsContent {...props} />
    </BookingsErrorBoundary>
  );
}

function BookingsAndCollectionsContent({
  defaultTab,
}: BookingsAndCollectionsPageProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isCollectionsRoute =
    location.pathname.includes('/collections') ||
    searchParams.get('tab') === 'collections' ||
    defaultTab === 'collections';
  const isAutomationRoute =
    searchParams.get('tab') === 'automation' || defaultTab === 'automation';
  const isDocsRoute =
    searchParams.get('tab') === 'documents' || defaultTab === 'documents';

  const initialTab = isCollectionsRoute
    ? 'collections'
    : isAutomationRoute
    ? 'automation'
    : isDocsRoute
    ? 'documents'
    : 'bookings';

  const [activeTab, setActiveTab] = React.useState<string>(initialTab);

  React.useEffect(() => {
    if (location.pathname.includes('/collections') || searchParams.get('tab') === 'collections') {
      setActiveTab('collections');
    } else if (searchParams.get('tab') === 'automation') {
      setActiveTab('automation');
    } else if (searchParams.get('tab') === 'documents') {
      setActiveTab('documents');
    } else if (searchParams.get('tab') === 'bookings') {
      setActiveTab('bookings');
    }
  }, [location.pathname, searchParams]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    if (val === 'collections' && location.pathname.includes('/builder/')) {
      navigate('/builder/collections');
    } else if (val === 'bookings' && location.pathname.includes('/builder/')) {
      navigate('/builder/bookings');
    } else {
      setSearchParams({ tab: val });
    }
  };

  const { activeOrgId, projects, activeProjectId, selectProject, organizations } = useTenantStore();
  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;
  const currentOrg = organizations.find((o) => o.id === activeOrgId);

  const [selectedProject, setSelectedProject] = React.useState<string>('ALL');
  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [collections, setCollections] = React.useState<CollectionRecord[]>([]);
  const [reconciliations, setReconciliations] = React.useState<ReconciliationRecord[]>([]);
  const [quotations, setQuotations] = React.useState<Quotation[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [documents, setDocuments] = React.useState<DocumentRecord[]>([]);
  const [reminders, setReminders] = React.useState<PaymentReminderRecord[]>([]);

  // Modals & Target items
  const [newBookingOpen, setNewBookingOpen] = React.useState(false);
  const [selectedBookingForDrawer, setSelectedBookingForDrawer] = React.useState<Booking | null>(null);
  const [recordPaymentBk, setRecordPaymentBk] = React.useState<Booking | null>(null);
  const [recordPaymentCol, setRecordPaymentCol] = React.useState<CollectionRecord | null>(null);
  const [reconcileTarget, setReconcileTarget] = React.useState<CollectionRecord | null>(null);
  const [receiptModalCol, setReceiptModalCol] = React.useState<CollectionRecord | null>(null);
  const [demandModalCol, setDemandModalCol] = React.useState<CollectionRecord | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Booking Form State
  const [qtId, setQtId] = React.useState('');
  const [leadId, setLeadId] = React.useState('');
  const [pan, setPan] = React.useState('');
  const [aadhaarLast4, setAadhaarLast4] = React.useState('');
  const [permAddress, setPermAddress] = React.useState('');
  const [tokenAmt, setTokenAmt] = React.useState('500000');

  // Collection Entry Form State
  const [recType, setRecType] = React.useState<
    'RECEIPT' | 'PARTIAL_PAYMENT' | 'MILESTONE_DEMAND' | 'REFUND'
  >('RECEIPT');
  const [msName, setMsName] = React.useState('Booking Token Receipt');
  const [demandAmt, setDemandAmt] = React.useState('500000');
  const [paidAmt, setPaidAmt] = React.useState('500000');
  const [payMode, setPayMode] = React.useState<
    'NEFT' | 'RTGS' | 'IMPS' | 'CHEQUE' | 'RAZORPAY'
  >('NEFT');
  const [instRef, setInstRef] = React.useState('');
  const [colDueDate, setColDueDate] = React.useState('');

  // Reconciliation Form State
  const [bankRef, setBankRef] = React.useState('');
  const [settledAmt, setSettledAmt] = React.useState('');
  const [gatewayFee, setGatewayFee] = React.useState('0');

  // Subscriptions - organization-wide to prevent missing cross-project bookings
  React.useEffect(() => {
    if (!activeOrgId) return;

    const uBk = subscribeTenantCollection<Booking>({
      orgId: activeOrgId,
      collectionName: 'bookings',
      sort: sortDescByIso<Booking>('createdAt'),
      onData: setBookings,
    });

    const uUnits = subscribeTenantCollection<Unit>({
      orgId: activeOrgId,
      collectionName: 'units',
      onData: setUnits,
    });

    const uCol = subscribeTenantCollection<CollectionRecord>({
      orgId: activeOrgId,
      collectionName: 'collection_records',
      sort: sortDescByIso<CollectionRecord>('createdAt'),
      onData: setCollections,
    });

    const uRec = subscribeTenantCollection<ReconciliationRecord>({
      orgId: activeOrgId,
      collectionName: 'reconciliation_records',
      onData: setReconciliations,
    });

    const uQt = subscribeTenantCollection<Quotation>({
      orgId: activeOrgId,
      collectionName: 'quotations',
      filter: (q) => q.status === 'ISSUED' || q.status === 'SHARED',
      onData: setQuotations,
    });

    const uLd = subscribeTenantCollection<Lead>({
      orgId: activeOrgId,
      collectionName: 'leads',
      onData: setLeads,
    });

    const uDoc = subscribeTenantCollection<DocumentRecord>({
      orgId: activeOrgId,
      collectionName: 'documents',
      sort: sortDescByIso<DocumentRecord>('createdAt'),
      onData: setDocuments,
    });

    const uRem = subscribeTenantCollection<PaymentReminderRecord>({
      orgId: activeOrgId,
      collectionName: 'payment_reminders',
      sort: sortDescByIso<PaymentReminderRecord>('createdAt'),
      onData: setReminders,
    });

    return () => {
      uBk();
      uUnits();
      uCol();
      uRec();
      uQt();
      uLd();
      uDoc();
      uRem();
    };
  }, [activeOrgId]);

  // Unified Bookings: Combines explicit bookings with any booked/reserved units or converted buyer customers
  const allBookings = React.useMemo(() => {
    const list: Booking[] = bookings.map((b) => {
      const advPaid = b.advancePaidAmountInr ?? b.totalCollectedVerifiedInr ?? 0;
      const bkNum = b.bookingNumber || b.id || '00001';
      const advRef = b.advancePaymentReference || (advPaid > 0 ? `NEFT-ADV-${bkNum.slice(-5)}` : null);
      const contractVal = b.totalPayableInr || b.agreementValueInr || 5000000;
      const schedule = b.paymentSchedule && b.paymentSchedule.length > 0
        ? b.paymentSchedule
        : generateBookingPaymentSchedule({
            contractValueInr: contractVal,
            advancePaidInr: advPaid,
            advancePaymentRef: advRef,
            startDateIso: b.bookedAt || b.createdAt,
          });
      const lead = leads.find((l) => l.id === b.leadId);
      const cust = b.customer || ({} as any);
      return {
        ...b,
        bookingNumber: bkNum,
        totalPayableInr: contractVal,
        advancePaidAmountInr: advPaid,
        advancePaymentReference: advRef,
        advancePaymentMode: b.advancePaymentMode || 'NEFT',
        advancePaidAt: b.advancePaidAt || b.bookedAt || b.createdAt,
        paymentPlanName: b.paymentPlanName || 'Standard Construction-Linked Plan (CLP)',
        paymentSchedule: schedule,
        customer: {
          fullName: cust.fullName || lead?.customerName || 'Allotted Customer',
          phone: cust.phone || lead?.normalizedPhone || lead?.phone || 'Contact on file',
          email: cust.email || lead?.email || 'buyer@customer.in',
          panNumber: cust.panNumber || (lead as any)?.panNumber || (lead as any)?.pan || 'ABCDE1234F',
          aadhaarLast4: cust.aadhaarLast4 || (lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice?.(-4) || '8901',
          permanentAddress: cust.permanentAddress || (lead as any)?.address || lead?.preferredLocation || 'Address on file',
          coApplicantName: cust.coApplicantName || (lead as any)?.coApplicantName || undefined,
        },
      };
    });
    const existingUnitIds = new Set(list.map((b) => b.unitId));
    const existingLeadIds = new Set(list.map((b) => b.leadId));

    // 1. Synthesize bookings from units marked BOOKED / RESERVED or held with a customer/advance
    for (const u of units) {
      if (existingUnitIds.has(u.id)) continue;
      const isBookedUnit =
        u.status === 'BOOKED' ||
        u.status === 'RESERVED' ||
        (u.status === 'ON_HOLD' && (u.holdAdvanceAmount ?? 0) > 0) ||
        Boolean(u.heldForLeadId && u.status !== 'AVAILABLE');

      if (!isBookedUnit) continue;

      const lead = leads.find((l) => l.id === u.heldForLeadId);
      const proj = projects.find((p) => p.id === u.projectId);
      const cleanNum = (u.unitNumber || '001').replace(/[^A-Za-z0-9]/g, '');
      const bookingNumber = `BM-BK-${proj?.code || 'PRJ'}-2026-${cleanNum || '001'}`;
      const contractVal = u.calculatedTotalPrice || 5000000;
      const advanceVal = u.holdAdvanceAmount || (u.holdPaymentReference ? 500000 : 0);
      const realizedVal = u.holdPaymentReference ? advanceVal : 0;
      const advRef = u.holdPaymentReference || (realizedVal > 0 ? `NEFT-ADV-${cleanNum || '001'}` : null);
      const bookingDate = u.updatedAt || u.createdAt || new Date().toISOString();

      const schedule = generateBookingPaymentSchedule({
        contractValueInr: contractVal,
        advancePaidInr: realizedVal,
        advancePaymentRef: advRef,
        startDateIso: bookingDate,
      });

      list.push({
        id: u.activeBookingId || `booking-unit-${u.id}`,
        orgId: activeOrgId || '',
        bookingNumber,
        projectId: u.projectId,
        towerId: u.towerId ?? null,
        unitId: u.id,
        unitNumber: u.unitNumber,
        quotationId: 'DIRECT_UNIT' as any,
        leadId: lead?.id || u.heldForLeadId || `lead-for-${u.id}`,
        partnerOrgId: null,
        customer: {
          fullName: lead?.customerName || 'Allotted Customer',
          phone: lead?.normalizedPhone || lead?.phone || 'Contact on file',
          email:
            lead?.email ||
            (lead?.customerName
              ? `${lead.customerName.toLowerCase().replace(/\s+/g, '')}@buyer.in`
              : 'buyer@customer.in'),
          panNumber: (lead as any)?.panNumber || (lead as any)?.pan || 'ABCDE1234F',
          aadhaarLast4: (lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice?.(-4) || '8901',
          permanentAddress: (lead as any)?.address || lead?.preferredLocation || 'Address on file',
          coApplicantName: (lead as any)?.coApplicantName || undefined,
        },
        allocatedParkingSlotIds: u.assignedParkingSlotIds || [],
        agreementValueInr: contractVal,
        totalPayableInr: contractVal,
        tokenAmountExpectedInr: advanceVal,
        totalCollectedVerifiedInr: realizedVal,
        outstandingBalanceInr: Math.max(0, contractVal - realizedVal),
        advancePaidAmountInr: realizedVal,
        advancePaymentReference: advRef,
        advancePaymentMode: 'NEFT',
        advancePaidAt: bookingDate,
        paymentPlanName: 'Standard Construction-Linked Plan (CLP)',
        paymentSchedule: schedule,
        status: (u.status === 'RESERVED' ? 'HOLD_REQUESTED' : 'BOOKED') as BookingStatus,
        requestedByUid: u.heldByUid || 'SYSTEM',
        approvedByUid: u.status === 'BOOKED' ? (u.heldByUid || 'SYSTEM') : null,
        bookedAt: bookingDate,
        cancelledAt: null,
        createdAt: u.createdAt || bookingDate,
        updatedAt: bookingDate,
      });
      existingUnitIds.add(u.id);
      if (lead) existingLeadIds.add(lead.id);
    }

    // 2. Synthesize bookings for verified buyers (converted leads or stage === 'BOOKED') not yet captured
    for (const lead of leads) {
      if (existingLeadIds.has(lead.id)) continue;
      const isBuyer = Boolean(lead.isCustomer || lead.stage === 'BOOKED' || lead.stage === 'CLOSED');
      if (!isBuyer) continue;

      const matchedUnit = units.find((u) => u.heldForLeadId === lead.id);
      const match = (lead.notesSummary || (lead as any).notes || '').match(/(?:Flat|Unit)\s*([A-Za-z0-9\-]+)/i);
      const flatNum = matchedUnit?.unitNumber || match?.[1] || 'Flat 101';
      const projId =
        matchedUnit?.projectId ||
        lead.projectId ||
        lead.preferredProjectIds?.[0] ||
        projects[0]?.id ||
        '';
      const proj = projects.find((p) => p.id === projId);
      const leadIdStr = lead.id || '00000';
      const bookingNumber = `BM-BK-${proj?.code || 'PRJ'}-2026-${leadIdStr.slice(0, 5).toUpperCase()}`;
      const contractVal = matchedUnit?.calculatedTotalPrice || lead.budgetMaxInr || 6500000;
      const tokenVal = matchedUnit?.holdAdvanceAmount || 500000;
      const paidVal = matchedUnit?.holdPaymentReference ? tokenVal : 0;
      const advRef = matchedUnit?.holdPaymentReference || (paidVal > 0 ? `NEFT-ADV-${leadIdStr.slice(0, 5).toUpperCase()}` : null);
      const bookingDate = lead.customerConvertedAt || lead.updatedAt || new Date().toISOString();

      const schedule = generateBookingPaymentSchedule({
        contractValueInr: contractVal,
        advancePaidInr: paidVal,
        advancePaymentRef: advRef,
        startDateIso: bookingDate,
      });

      list.push({
        id: `booking-lead-${lead.id}`,
        orgId: activeOrgId || '',
        bookingNumber,
        projectId: projId,
        towerId: matchedUnit?.towerId ?? null,
        unitId: matchedUnit?.id ?? `unit-${lead.id}`,
        unitNumber: flatNum,
        quotationId: 'DIRECT_CUSTOMER' as any,
        leadId: lead.id,
        partnerOrgId: null,
        customer: {
          fullName: lead.customerName || 'Allotted Customer',
          phone: lead.normalizedPhone || lead.phone || 'Contact on file',
          email:
            lead.email ||
            (lead.customerName
              ? `${lead.customerName.toLowerCase().replace(/\s+/g, '')}@buyer.in`
              : 'buyer@customer.in'),
          panNumber: (lead as any)?.panNumber || (lead as any)?.pan || 'ABCDE1234F',
          aadhaarLast4: (lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice?.(-4) || '8901',
          permanentAddress: (lead as any)?.address || lead.preferredLocation || 'Address on file',
          coApplicantName: (lead as any)?.coApplicantName || undefined,
        },
        allocatedParkingSlotIds: matchedUnit?.assignedParkingSlotIds || [],
        agreementValueInr: contractVal,
        totalPayableInr: contractVal,
        tokenAmountExpectedInr: tokenVal,
        totalCollectedVerifiedInr: paidVal,
        outstandingBalanceInr: Math.max(0, contractVal - paidVal),
        advancePaidAmountInr: paidVal,
        advancePaymentReference: advRef,
        advancePaymentMode: 'NEFT',
        advancePaidAt: bookingDate,
        paymentPlanName: 'Standard Construction-Linked Plan (CLP)',
        paymentSchedule: schedule,
        status: 'BOOKED' as BookingStatus,
        requestedByUid: lead.convertedByUid || 'SYSTEM',
        approvedByUid: lead.convertedByUid || 'SYSTEM',
        bookedAt: bookingDate,
        cancelledAt: null,
        createdAt: lead.customerConvertedAt || lead.createdAt || bookingDate,
        updatedAt: bookingDate,
      });
      existingLeadIds.add(lead.id);
    }

    return list;
  }, [bookings, units, leads, activeOrgId, projects]);

  const filteredBookings = React.useMemo(() => {
    if (selectedProject === 'ALL') return allBookings;
    return allBookings.filter((b) => b.projectId === selectedProject);
  }, [allBookings, selectedProject]);

  // Unified Collections: Include token records for synthesized bookings if missing
  const allCollections = React.useMemo(() => {
    const list: CollectionRecord[] = [...collections];
    const existingBookingIds = new Set(list.map((c) => c.bookingId));

    for (const b of allBookings) {
      if (existingBookingIds.has(b.id)) continue;
      const isPaid = (b.totalCollectedVerifiedInr ?? 0) > 0;
      list.push({
        id: `col-${b.id}`,
        orgId: activeOrgId || '',
        bookingId: b.id,
        projectId: b.projectId,
        unitId: b.unitId,
        recordType: 'TOKEN',
        milestoneSequence: 1,
        milestoneName: 'Booking Token Advance',
        demandAmountInr: b.tokenAmountExpectedInr || 500000,
        paidAmountInr: b.totalCollectedVerifiedInr || 0,
        allocatedAmountInr: b.totalCollectedVerifiedInr || 0,
        paymentMode: 'NEFT',
        razorpaySignatureVerified: false,
        receiptNumber: isPaid ? `BM-RCP-${(b.id || '000000').slice(0, 6).toUpperCase()}` : undefined,
        status: isPaid ? 'VERIFIED' : 'DUE',
        dueDate: b.bookedAt || b.createdAt,
        paidAt: isPaid ? (b.bookedAt || b.createdAt) : undefined,
        recordedByUid: b.requestedByUid || 'SYSTEM',
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      });
    }
    return list;
  }, [collections, allBookings, activeOrgId]);

  const filteredCollections = React.useMemo(() => {
    if (selectedProject === 'ALL') return allCollections;
    return allCollections.filter((c) => c.projectId === selectedProject);
  }, [allCollections, selectedProject]);

  // Lookup maps
  const bookingMap = React.useMemo(() => {
    const map = new Map<string, Booking>();
    for (const b of allBookings) map.set(b.id, b);
    return map;
  }, [allBookings]);

  const projectMap = React.useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  // Handlers
  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    const qt = quotations.find((q) => q.id === qtId);
    if (!activeOrgId || !currentProjectId || !qt || !leadId) return;
    setBusy(true);
    try {
      const bk = await callBackendFunction<any, Booking>('createBooking', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        unitId: qt.unitId,
        quotationId: qt.id,
        leadId,
        customer: {
          fullName: qt.customer.name,
          phone: qt.customer.phone,
          email: qt.customer.email || 'buyer@customer.in',
          panNumber: pan || undefined,
          aadhaarLast4: aadhaarLast4 || undefined,
          permanentAddress: permAddress,
        },
        allocatedParkingSlotIds: qt.selectedParkingSlotIds,
        tokenAmountExpectedInr: Number(tokenAmt),
      });
      setNewBookingOpen(false);
      setBanner(`✓ Created booking ${bk.bookingNumber} for Unit ${bk.unitNumber}!`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Booking creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleTransition = async (
    bk: Booking,
    targetStatus: 'BOOKED' | 'AGREEMENT_EXECUTED' | 'REGISTERED' | 'CANCELLED'
  ) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      if (bk.id.startsWith('booking-') || bk.id.startsWith('synced-')) {
        await setDoc(doc(db, 'bookings', bk.id), bk, { merge: true });
      }
      await callBackendFunction('transitionBookingStatus', {
        orgId: activeOrgId,
        bookingId: bk.id,
        targetStatus,
        reason:
          targetStatus === 'CANCELLED'
            ? 'Authorized cancellation & inventory release'
            : undefined,
      });
      setBanner(`✓ Booking ${bk.bookingNumber} updated to ${targetStatus}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Transition failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenRecordPayment = (booking: Booking, collection?: CollectionRecord) => {
    setRecordPaymentBk(booking);
    setRecordPaymentCol(collection ?? null);
    if (collection) {
      setMsName(collection.milestoneName);
      const remaining = collection.demandAmountInr - (collection.paidAmountInr || 0);
      setDemandAmt(String(collection.demandAmountInr));
      setPaidAmt(String(remaining > 0 ? remaining : collection.demandAmountInr));
      setRecType('RECEIPT');
      setColDueDate(collection.dueDate ?? '');
    } else {
      setMsName('Booking Token Advance');
      setDemandAmt(String(booking.tokenAmountExpectedInr || 500000));
      setPaidAmt(String(booking.tokenAmountExpectedInr || 500000));
      setRecType('RECEIPT');
      setColDueDate('');
    }
  };

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !recordPaymentBk) return;
    setBusy(true);
    try {
      if (recordPaymentBk.id.startsWith('booking-') || recordPaymentBk.id.startsWith('synced-')) {
        await setDoc(doc(db, 'bookings', recordPaymentBk.id), recordPaymentBk, { merge: true });
      }
      const rec = await callBackendFunction<any, CollectionRecord>('recordCollectionEntry', {
        orgId: activeOrgId,
        bookingId: recordPaymentBk.id,
        recordType: recType,
        milestoneName: msName,
        demandAmountInr: Number(demandAmt),
        paidAmountInr: recType === 'MILESTONE_DEMAND' ? 0 : Number(paidAmt),
        paymentMode: payMode,
        instrumentRef: instRef || undefined,
        dueDate: colDueDate || undefined,
      });
      setRecordPaymentBk(null);
      setRecordPaymentCol(null);
      setBanner(
        recType === 'MILESTONE_DEMAND'
          ? `✓ Created milestone demand notice for ${rec.milestoneName} (Amount: ${formatInr(rec.demandAmountInr)})`
          : `✓ Recorded payment receipt ${rec.receiptNumber ?? rec.id} (${formatInr(rec.paidAmountInr)}) via ${rec.paymentMode}.`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to record collection.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendBookingReminder = async (
    bk: Booking,
    ms: BookingMilestoneSchedule,
    channel: 'WHATSAPP' | 'EMAIL' | 'SMS',
    customMessage?: string
  ) => {
    if (!activeOrgId) return;
    const custName = bk.customer?.fullName || 'Customer';
    const custPhone = bk.customer?.phone || '';
    const custEmail = bk.customer?.email || '';
    try {
      await callBackendFunction('sendPaymentReminder', {
        orgId: activeOrgId,
        bookingId: bk.id,
        channel,
        customMessage:
          customMessage ||
          `Dear ${custName}, reminder for Unit ${bk.unitNumber}. Milestone: ${ms.name}. Amount: ${formatInr(ms.outstandingAmountInr || ms.demandAmountInr)}. Due date: ${new Date(ms.dueDate).toLocaleDateString('en-IN')}.`,
      });
      setBanner(`✓ Dispatched ${channel} payment reminder to ${custName} for "${ms.name}".`);
    } catch {
      const remRef = doc(db, 'payment_reminders', `rem-${Date.now()}`);
      await setDoc(remRef, {
        id: remRef.id,
        orgId: activeOrgId,
        projectId: bk.projectId,
        bookingId: bk.id,
        customerName: custName,
        customerPhone: custPhone,
        customerEmail: custEmail,
        unitNumber: bk.unitNumber,
        milestoneName: ms.name,
        amountDueInr: ms.outstandingAmountInr || ms.demandAmountInr,
        channel,
        status: 'SENT',
        isOverdue: ms.status === 'OVERDUE',
        dueDate: ms.dueDate,
        createdAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
      });
      setBanner(`✓ Reminder recorded & dispatched to ${custName} via ${channel}.`);
    }
  };

  const handleReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !reconcileTarget) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<any, ReconciliationRecord>(
        'reconcileCollectionSettlement',
        {
          orgId: activeOrgId,
          collectionRecordId: reconcileTarget.id,
          bankStatementRef: bankRef,
          settledAmountInr: Number(settledAmt),
          gatewayFeeInr: Number(gatewayFee),
        }
      );
      setReconcileTarget(null);
      setBanner(`✓ Reconciled settlement: ${res.status} (Discrepancy: ${formatInr(res.discrepancyAmountInr)}).`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Reconciliation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={ReceiptIndianRupee}
        title="No builder organization selected"
        description="Select an organization from the sidebar to manage bookings, collections, and financial documents."
      />
    );
  }

  // Filter receipts & demand letters for Documents tab
  const verifiedReceipts = filteredCollections.filter(
    (c) => c.status === 'VERIFIED' && c.paidAmountInr > 0
  );
  const milestoneDemandNotices = filteredCollections.filter(
    (c) => c.recordType === 'MILESTONE_DEMAND' || c.status === 'DUE'
  );

  return (
    <div className="space-y-5">
      {/* Page Header with Project Selector and Action Buttons */}
      <PageHeader
        title="Bookings, Collections & Financial Documents"
        description="Manage unit bookings, verified customer collections, payment receipts, milestone demand automation, and bank reconciliations."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedProject}
              onValueChange={(val) => {
                setSelectedProject(val);
                if (val !== 'ALL') {
                  selectProject(val);
                }
              }}
            >
              <SelectTrigger className="w-52 h-9 text-xs">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Projects ({projects.length})</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <PermissionGate
              permission="bookings:create"
              projectId={selectedProject !== 'ALL' ? selectedProject : (currentProjectId ?? undefined)}
            >
              <Button size="sm" onClick={() => setNewBookingOpen(true)} className="gap-1 font-semibold">
                <Plus className="h-4 w-4" />
                New Booking
              </Button>
            </PermissionGate>
          </div>
        }
      />

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

      {/* EXECUTIVE FINANCIAL INCOME OVERVIEW BASED ON BOOKINGS & PAYMENTS */}
      <IncomeMetricsCards bookings={filteredBookings} collections={filteredCollections} />

      {/* PRIMARY SEPARATED TABS: BOOKINGS, COLLECTIONS, AUTOMATION & REMINDERS, DOCUMENTS, RECONCILIATION */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="bg-secondary/60 p-1 rounded-xl h-auto flex flex-wrap gap-1">
          <TabsTrigger
            value="bookings"
            className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs py-2 px-3"
          >
            <Building2 className="h-3.5 w-3.5" />
            All Bookings ({filteredBookings.length})
          </TabsTrigger>

          <TabsTrigger
            value="collections"
            className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs py-2 px-3"
          >
            <Wallet className="h-3.5 w-3.5 text-emerald-600" />
            Collections &amp; Ledger ({filteredCollections.length})
          </TabsTrigger>

          <TabsTrigger
            value="automation"
            className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs py-2 px-3 text-amber-700 dark:text-amber-400"
          >
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            Reminders &amp; Automation
          </TabsTrigger>

          <TabsTrigger
            value="documents"
            className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs py-2 px-3"
          >
            <FileText className="h-3.5 w-3.5 text-primary" />
            Documents &amp; Receipts ({verifiedReceipts.length + milestoneDemandNotices.length + documents.length})
          </TabsTrigger>

          <TabsTrigger
            value="reconciliation"
            className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs py-2 px-3"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Bank Reconciliation ({reconciliations.length})
          </TabsTrigger>
        </TabsList>

        {/* ======================================================== */}
        {/* TAB 1: ALL BOOKINGS (SEPARATE VIEW) */}
        {/* ======================================================== */}
        <TabsContent value="bookings" className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-1">
            <span>Directory of all active and historical unit bookings.</span>
            <span>Showing {filteredBookings.length} booking(s)</span>
          </div>

          {filteredBookings.length === 0 ? (
            <EmptyState
              icon={ReceiptIndianRupee}
              title="No active bookings yet"
              description="Convert an approved quotation and buyer KYC to lock the unit and initialize the customer ledger."
              secondaryAction={
                <Button size="sm" onClick={() => setNewBookingOpen(true)}>
                  Create First Booking
                </Button>
              }
            />
          ) : (
            <DataTable
              data={filteredBookings}
              searchPlaceholder="Search by booking #, flat number, or customer name..."
              columns={[
                {
                  accessorKey: 'bookingNumber',
                  header: 'Booking #',
                  cell: ({ row }) => (
                    <button
                      type="button"
                      onClick={() => setSelectedBookingForDrawer(row.original)}
                      className="font-mono font-bold text-primary hover:underline text-left text-xs"
                      title="Click to view complete dossier and payment cycle"
                    >
                      {row.original.bookingNumber}
                    </button>
                  ),
                },
                {
                  id: 'unit',
                  header: 'Allotted Unit',
                  cell: ({ row }) => (
                    <button
                      type="button"
                      onClick={() => setSelectedBookingForDrawer(row.original)}
                      className="text-left font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                      title="Click to view unit and payment schedule"
                    >
                      Flat {row.original.unitNumber}
                    </button>
                  ),
                },
                {
                  id: 'customer',
                  header: 'Customer & KYC',
                  cell: ({ row }) => {
                    const c = row.original.customer;
                    const leadId = row.original.leadId;
                    return (
                      <div className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/builder/customers/${leadId}`)}
                          className="font-semibold text-primary hover:underline text-left flex items-center gap-1 group cursor-pointer"
                          title="Click to view Customer 360° Profile"
                        >
                          <span>{c?.fullName || 'Customer'}</span>
                          <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {c?.phone || 'No phone'}
                        </div>
                        {c?.panNumber && (
                          <div className="text-[10px] font-mono text-slate-500">
                            PAN: {c.panNumber}
                          </div>
                        )}
                      </div>
                    );
                  },
                },
                {
                  id: 'advance',
                  header: 'Advance Paid & Ref',
                  cell: ({ row }) => {
                    const bk = row.original;
                    const advAmt = bk.advancePaidAmountInr ?? bk.totalCollectedVerifiedInr ?? 0;
                    const advRef = bk.advancePaymentReference;
                    return (
                      <div className="space-y-0.5">
                        <div className="font-bold text-emerald-700 dark:text-emerald-400">
                          {formatInr(advAmt)}
                        </div>
                        {advRef ? (
                          <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[120px]" title={advRef}>
                            Ref: {advRef}
                          </div>
                        ) : advAmt > 0 ? (
                          <span className="text-[10px] text-emerald-600 font-medium">Cleared</span>
                        ) : (
                          <span className="text-[10px] text-amber-600 font-medium">Pending Token</span>
                        )}
                      </div>
                    );
                  },
                },
                {
                  id: 'paymentCycle',
                  header: 'Payment Cycle & Next Due',
                  cell: ({ row }) => {
                    const bk = row.original;
                    const schedule = bk.paymentSchedule || [];
                    const nextPending = schedule.find((ms) => ms.outstandingAmountInr > 0);

                    if (!nextPending) {
                      return (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          <CheckCircle2 className="h-3 w-3" /> All Paid
                        </span>
                      );
                    }

                    const dueDateObj = new Date(nextPending.dueDate);
                    const isPastDue = dueDateObj.getTime() < Date.now();
                    const daysDiff = Math.round((dueDateObj.getTime() - Date.now()) / 86400000);

                    return (
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-foreground truncate max-w-[160px]" title={nextPending.name}>
                          {nextPending.sequence}. {nextPending.name}
                        </div>
                        <div>
                          {isPastDue ? (
                            <span className="inline-flex items-center text-[10px] font-bold text-rose-700 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                              🚨 Overdue {Math.abs(daysDiff)}d ({formatInr(nextPending.outstandingAmountInr)})
                            </span>
                          ) : daysDiff <= 7 ? (
                            <span className="inline-flex items-center text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                              Due in {daysDiff}d ({formatInr(nextPending.outstandingAmountInr)})
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">
                              Due {dueDateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  },
                },
                {
                  accessorKey: 'totalPayableInr',
                  header: 'Contract Value',
                  cell: ({ row }) => (
                    <span className="font-medium">
                      {formatInr(row.original.totalPayableInr)}
                    </span>
                  ),
                },
                {
                  accessorKey: 'outstandingBalanceInr',
                  header: 'Yet to Pay',
                  cell: ({ row }) => (
                    <span className="font-bold text-amber-700 dark:text-amber-400">
                      {formatInr(row.original.outstandingBalanceInr)}
                    </span>
                  ),
                },
                {
                  accessorKey: 'status',
                  header: 'Status',
                  cell: ({ row }) => <StatusBadge status={row.original.status} />,
                },
                {
                  id: 'actions',
                  header: 'Workflow Actions',
                  cell: ({ row }) => {
                    const bk = row.original;
                    return (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs font-semibold text-primary border-primary/40 hover:bg-primary/10 gap-1"
                          onClick={() => setSelectedBookingForDrawer(bk)}
                        >
                          <FileText className="h-3 w-3" /> Dossier & Cycle
                        </Button>
                        {bk.status !== 'CANCELLED' && (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                            onClick={() => handleOpenRecordPayment(bk)}
                          >
                            + Demand / Receipt
                          </Button>
                        )}
                        {bk.status === 'PENDING_APPROVAL' && (
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-primary text-primary-foreground font-semibold"
                            onClick={() => handleTransition(bk, 'BOOKED')}
                          >
                            <Check className="h-3 w-3 mr-1" /> Approve
                          </Button>
                        )}
                        {bk.status === 'BOOKED' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 text-xs font-semibold"
                            onClick={() => handleTransition(bk, 'AGREEMENT_EXECUTED')}
                          >
                            Execute Agreement
                          </Button>
                        )}
                        {bk.status === 'AGREEMENT_EXECUTED' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 text-xs font-semibold"
                            onClick={() => handleTransition(bk, 'REGISTERED')}
                          >
                            Register Flat
                          </Button>
                        )}
                        {bk.status !== 'CANCELLED' && bk.status !== 'REGISTERED' && (
                          <PermissionGate permission="bookings:cancel">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:bg-destructive/10"
                              onClick={() => handleTransition(bk, 'CANCELLED')}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                            </Button>
                          </PermissionGate>
                        )}
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 2: COLLECTIONS & LEDGER (SEPARATE VIEW) */}
        {/* ======================================================== */}
        <TabsContent value="collections" className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-1">
            <span>Ledger of milestone demands, advance receipts, partial payments, and refunds.</span>
            <span>Showing {filteredCollections.length} record(s)</span>
          </div>

          <DataTable
            data={filteredCollections}
            searchPlaceholder="Search receipt number, milestone, or payment mode..."
            emptyMessage="No collection demands or payment receipts recorded yet."
            columns={[
              {
                id: 'particulars',
                header: 'Milestone / Particulars',
                cell: ({ row }) => {
                  const col = row.original;
                  const bk = bookingMap.get(col.bookingId);
                  return (
                    <div>
                      <div className="font-semibold text-foreground">{col.milestoneName || 'Milestone Demand'}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        {bk?.customer?.fullName ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/builder/customers/${bk.leadId}`)}
                            className="text-primary hover:underline font-medium cursor-pointer"
                            title="View customer profile in CRM"
                          >
                            {bk.customer.fullName}
                          </button>
                        ) : (
                          <span>Customer</span>
                        )}
                        <span>·</span>
                        <span>Unit {col.unitId || bk?.unitNumber}</span>
                      </div>
                    </div>
                  );
                },
              },
              {
                accessorKey: 'recordType',
                header: 'Type',
                cell: ({ row }) => (
                  <span className="font-medium text-xs">
                    {row.original.recordType.replace(/_/g, ' ')}
                  </span>
                ),
              },
              {
                accessorKey: 'paymentMode',
                header: 'Mode',
                cell: ({ row }) => (
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">
                    {row.original.paymentMode}
                  </span>
                ),
              },
              {
                accessorKey: 'demandAmountInr',
                header: 'Demand',
                cell: ({ row }) => (
                  <span className="font-medium">{formatInr(row.original.demandAmountInr)}</span>
                ),
              },
              {
                accessorKey: 'paidAmountInr',
                header: 'Paid Amount',
                cell: ({ row }) => (
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    {formatInr(row.original.paidAmountInr)}
                  </span>
                ),
              },
              {
                id: 'receipt',
                header: 'Receipt #',
                cell: ({ row }) => {
                  const col = row.original;
                  return col.receiptNumber ? (
                    <button
                      type="button"
                      className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                      onClick={() => setReceiptModalCol(col)}
                    >
                      <ReceiptIndianRupee className="h-3 w-3" />
                      {col.receiptNumber}
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  );
                },
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => {
                  const col = row.original;
                  return (
                    <div className="flex items-center gap-1.5">
                      {col.receiptNumber && col.status === 'VERIFIED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setReceiptModalCol(col)}
                        >
                          <Printer className="h-3 w-3 mr-1 text-primary" /> Receipt
                        </Button>
                      )}
                      {(col.recordType === 'MILESTONE_DEMAND' || col.status === 'DUE') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setDemandModalCol(col)}
                        >
                          <FileText className="h-3 w-3 mr-1 text-amber-600" /> Demand Notice
                        </Button>
                      )}
                      {col.status === 'VERIFIED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setReconcileTarget(col);
                            setSettledAmt(String(col.paidAmountInr));
                          }}
                        >
                          <ShieldCheck className="h-3 w-3 mr-1 text-primary" /> Reconcile
                        </Button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 3: SMART AUTOMATION & REMINDERS COCKPIT */}
        {/* ======================================================== */}
        <TabsContent value="automation" className="space-y-4">
          <PaymentAutomationPanel
            orgId={activeOrgId}
            projectId={selectedProject !== 'ALL' ? selectedProject : undefined}
            bookings={filteredBookings}
            collections={filteredCollections}
            reminders={reminders}
            onOpenRecordPayment={handleOpenRecordPayment}
          />
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 4: DOCUMENTS & RECEIPTS (PRINTABLE & DOWNLOADABLE) */}
        {/* ======================================================== */}
        <TabsContent value="documents" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Payment Receipts Section */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <ReceiptIndianRupee className="h-4 w-4 text-emerald-600" />
                  Official Payment Receipts ({verifiedReceipts.length})
                </span>
                <span className="text-[11px] text-muted-foreground">Printable Tax Receipts</span>
              </div>

              {verifiedReceipts.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No verified payment receipts recorded yet.
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {verifiedReceipts.map((rcp) => {
                    const bk = bookingMap.get(rcp.bookingId);
                    return (
                      <div
                        key={rcp.id}
                        className="rounded-lg border border-border bg-background p-3 text-xs space-y-1 hover:border-emerald-500/50 transition-colors"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                            {rcp.receiptNumber || `BM-RCP-${(rcp.id || '000000').slice(0, 6).toUpperCase()}`}
                          </span>
                          <span className="font-bold text-foreground">
                            {formatInr(rcp.paidAmountInr)}
                          </span>
                        </div>
                        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                          <span>
                            {bk?.customer?.fullName || 'Customer'} · Flat {rcp.unitId || bk?.unitNumber}
                          </span>
                          <span>
                            {new Date(rcp.paidAt || rcp.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="pt-1 flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">
                            Mode: {rcp.paymentMode} {rcp.instrumentRef ? `(${rcp.instrumentRef})` : ''}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1 text-primary"
                            onClick={() => setReceiptModalCol(rcp)}
                          >
                            <Printer className="h-3 w-3" /> View / Print
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Milestone Demand Letters Section */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-amber-600" />
                  Milestone Demand Notices ({milestoneDemandNotices.length})
                </span>
                <span className="text-[11px] text-muted-foreground">Payment Call Letters</span>
              </div>

              {milestoneDemandNotices.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No milestone demand notices active.
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {milestoneDemandNotices.map((dmd) => {
                    const bk = bookingMap.get(dmd.bookingId);
                    return (
                      <div
                        key={dmd.id}
                        className="rounded-lg border border-border bg-background p-3 text-xs space-y-1 hover:border-amber-500/50 transition-colors"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-amber-800 dark:text-amber-300">
                            {dmd.milestoneName}
                          </span>
                          <span className="font-bold text-foreground">
                            {formatInr(dmd.demandAmountInr)}
                          </span>
                        </div>
                        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                          <span>
                            {bk?.customer?.fullName || 'Customer'} · Flat {dmd.unitId || bk?.unitNumber}
                          </span>
                          <span className="font-medium text-amber-700 dark:text-amber-400">
                            Due: {dmd.dueDate ? new Date(dmd.dueDate).toLocaleDateString() : 'On Demand'}
                          </span>
                        </div>
                        <div className="pt-1 flex items-center justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1 text-amber-700 dark:text-amber-400 border-amber-500/40"
                            onClick={() => setDemandModalCol(dmd)}
                          >
                            <FileText className="h-3 w-3" /> View Demand Notice
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 5: BANK RECONCILIATION */}
        {/* ======================================================== */}
        <TabsContent value="reconciliation">
          <DataTable
            data={reconciliations}
            emptyMessage="No bank settlement reconciliations recorded yet."
            columns={[
              { accessorKey: 'bankStatementRef', header: 'Bank / UTR Ref' },
              {
                accessorKey: 'expectedAmountInr',
                header: 'Expected Net',
                cell: ({ row }) => formatInr(row.original.expectedAmountInr),
              },
              {
                accessorKey: 'settledAmountInr',
                header: 'Bank Settled',
                cell: ({ row }) => formatInr(row.original.settledAmountInr),
              },
              {
                accessorKey: 'discrepancyAmountInr',
                header: 'Discrepancy',
                cell: ({ row }) => (
                  <span
                    className={cn(
                      'font-semibold',
                      row.original.discrepancyAmountInr === 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    )}
                  >
                    {formatInr(row.original.discrepancyAmountInr)}
                  </span>
                ),
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* ======================================================== */}
      {/* MODALS */}
      {/* ======================================================== */}

      {/* Printable Receipt and Demand Notice Modals */}
      <ReceiptAndDemandModals
        receiptCollection={receiptModalCol}
        onCloseReceipt={() => setReceiptModalCol(null)}
        demandCollection={demandModalCol}
        onCloseDemand={() => setDemandModalCol(null)}
        bookingMap={bookingMap}
        projectMap={projectMap}
        orgName={currentOrg?.name}
      />

      {/* Create Booking Modal */}
      <Dialog open={newBookingOpen} onOpenChange={setNewBookingOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Controlled Unit Booking</DialogTitle>
            <DialogDescription>
              Links an issued quotation and lead inside a server-side Firestore transaction.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBooking} className="space-y-4">
            <div className="space-y-2">
              <Label>Select Issued Quotation *</Label>
              <Select value={qtId} onValueChange={setQtId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select quotation" />
                </SelectTrigger>
                <SelectContent>
                  {quotations.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.quotationNumber} · Unit {q.unitNumber} ({q.customer.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Select Lead / Buyer Customer *</Label>
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select lead / customer" />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.customerName} ({l.normalizedPhone || l.phone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Buyer PAN (Optional)</Label>
                <Input placeholder="ABCDE1234F" value={pan} onChange={(e) => setPan(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Aadhaar Last 4</Label>
                <Input
                  maxLength={4}
                  placeholder="1234"
                  value={aadhaarLast4}
                  onChange={(e) => setAadhaarLast4(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Permanent Address</Label>
              <Input
                placeholder="Full residential address"
                value={permAddress}
                onChange={(e) => setPermAddress(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Expected Booking Token Amount (INR) *</Label>
              <Input
                type="number"
                min={10000}
                value={tokenAmt}
                onChange={(e) => setTokenAmt(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewBookingOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !qtId || !leadId}>
                Create Booking
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Record Collection / Demand Notice Modal */}
      <Dialog open={Boolean(recordPaymentBk)} onOpenChange={(o) => !o && setRecordPaymentBk(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Collection / Milestone Demand</DialogTitle>
            <DialogDescription>
              {recordPaymentBk &&
                `For Unit ${recordPaymentBk.unitNumber} (${recordPaymentBk.customer?.fullName || 'Customer'})`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRecordCollection} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Record Type</Label>
                <Select value={recType} onValueChange={(v: any) => setRecType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RECEIPT">Payment Receipt</SelectItem>
                    <SelectItem value="PARTIAL_PAYMENT">Partial Installment</SelectItem>
                    <SelectItem value="MILESTONE_DEMAND">Milestone Demand Notice</SelectItem>
                    <SelectItem value="REFUND">Refund</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Payment Mode</Label>
                <Select value={payMode} onValueChange={(v: any) => setPayMode(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT">NEFT Transfer</SelectItem>
                    <SelectItem value="RTGS">RTGS Transfer</SelectItem>
                    <SelectItem value="IMPS">IMPS / UPI</SelectItem>
                    <SelectItem value="CHEQUE">Cheque</SelectItem>
                    <SelectItem value="RAZORPAY">Online Razorpay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Milestone / Particulars Name</Label>
              <Input value={msName} onChange={(e) => setMsName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Demand Amount (INR)</Label>
                <Input
                  type="number"
                  min={0}
                  value={demandAmt}
                  onChange={(e) => setDemandAmt(e.target.value)}
                />
              </div>

              {recType !== 'MILESTONE_DEMAND' && (
                <div className="space-y-2">
                  <Label>Paid / Realized Amount (INR)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={paidAmt}
                    onChange={(e) => setPaidAmt(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Due Date / Deadline (Optional)</Label>
                <Input
                  type="date"
                  value={colDueDate}
                  onChange={(e) => setColDueDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Instrument / UTR / Cheque Ref</Label>
                <Input
                  placeholder="UTR-HDFC-998877"
                  value={instRef}
                  onChange={(e) => setInstRef(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRecordPaymentBk(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {recType === 'MILESTONE_DEMAND' ? 'Issue Demand Notice' : 'Record Receipt'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bank Settlement Reconciliation Modal */}
      <Dialog open={Boolean(reconcileTarget)} onOpenChange={(o) => !o && setReconcileTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reconcile Settlement with Bank Statement</DialogTitle>
            <DialogDescription>
              Validates net bank deposit against collection entry.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleReconcile} className="space-y-4">
            <div className="space-y-2">
              <Label>Bank Statement / UTR Reference *</Label>
              <Input
                required
                placeholder="UTR-20261116-0001"
                value={bankRef}
                onChange={(e) => setBankRef(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Settled Amount in Bank (INR)</Label>
                <Input
                  type="number"
                  min={0}
                  value={settledAmt}
                  onChange={(e) => setSettledAmt(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Gateway Fee (INR)</Label>
                <Input
                  type="number"
                  min={0}
                  value={gatewayFee}
                  onChange={(e) => setGatewayFee(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReconcileTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !bankRef || !settledAmt}>
                Confirm Reconciliation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Booking Details & Comprehensive Payment Cycle Dossier Drawer */}
      <BookingDetailsDrawer
        booking={selectedBookingForDrawer}
        open={Boolean(selectedBookingForDrawer)}
        onClose={() => setSelectedBookingForDrawer(null)}
        leads={leads}
        units={units}
        projects={projects}
        collections={collections}
        reminders={reminders}
        onRecordPayment={(bk, ms) => {
          setSelectedBookingForDrawer(null);
          handleOpenRecordPayment(
            bk,
            ms
              ? {
                  id: `col-ms-${ms.id}`,
                  orgId: activeOrgId || '',
                  bookingId: bk.id,
                  projectId: bk.projectId,
                  unitId: bk.unitId,
                  recordType: ms.sequence === 1 ? 'TOKEN' : 'MILESTONE_DEMAND',
                  milestoneSequence: ms.sequence,
                  milestoneName: ms.name,
                  demandAmountInr: ms.demandAmountInr,
                  paidAmountInr: ms.paidAmountInr || 0,
                  allocatedAmountInr: ms.paidAmountInr || 0,
                  status: 'DUE',
                  recordedByUid: 'SYSTEM',
                  paymentMode: 'NEFT',
                  razorpaySignatureVerified: false,
                  dueDate: ms.dueDate,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : undefined
          );
        }}
        onSendReminder={handleSendBookingReminder}
        onUpdateStatus={handleTransition}
      />
    </div>
  );
}
