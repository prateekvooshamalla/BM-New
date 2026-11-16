import * as React from 'react';
import { Check, Plus, ReceiptIndianRupee, ShieldCheck, XCircle } from 'lucide-react';
import {
  formatInr,
  formatInrCompact,
  type Booking,
  type CollectionRecord,
  type Lead,
  type Quotation,
  type ReconciliationRecord,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export function BookingsAndCollectionsPage() {
  const { activeOrgId, projects, activeProjectId, selectProject } = useTenantStore();
  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;

  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [collections, setCollections] = React.useState<CollectionRecord[]>([]);
  const [reconciliations, setReconciliations] = React.useState<ReconciliationRecord[]>([]);
  const [quotations, setQuotations] = React.useState<Quotation[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);

  const [newBookingOpen, setNewBookingOpen] = React.useState(false);
  const [recordPaymentBk, setRecordPaymentBk] = React.useState<Booking | null>(null);
  const [reconcileTarget, setReconcileTarget] = React.useState<CollectionRecord | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Booking Form
  const [qtId, setQtId] = React.useState('');
  const [leadId, setLeadId] = React.useState('');
  const [pan, setPan] = React.useState('');
  const [aadhaarLast4, setAadhaarLast4] = React.useState('');
  const [permAddress, setPermAddress] = React.useState('');
  const [tokenAmt, setTokenAmt] = React.useState('500000');

  // Collection Entry Form
  const [recType, setRecType] = React.useState<'RECEIPT' | 'PARTIAL_PAYMENT' | 'MILESTONE_DEMAND' | 'REFUND'>('RECEIPT');
  const [msName, setMsName] = React.useState('Booking Token Receipt');
  const [demandAmt, setDemandAmt] = React.useState('500000');
  const [paidAmt, setPaidAmt] = React.useState('500000');
  const [payMode, setPayMode] = React.useState<'NEFT' | 'RTGS' | 'IMPS' | 'CHEQUE' | 'RAZORPAY'>('NEFT');
  const [instRef, setInstRef] = React.useState('');

  // Reconciliation Form
  const [bankRef, setBankRef] = React.useState('');
  const [settledAmt, setSettledAmt] = React.useState('');
  const [gatewayFee, setGatewayFee] = React.useState('0');

  React.useEffect(() => {
    if (!activeOrgId || !currentProjectId) return;

    const uBk = subscribeTenantCollection<Booking>({
      orgId: activeOrgId,
      collectionName: 'bookings',
      projectId: currentProjectId,
      sort: sortDescByIso<Booking>('createdAt'),
      onData: setBookings,
    });

    const uCol = subscribeTenantCollection<CollectionRecord>({
      orgId: activeOrgId,
      collectionName: 'collection_records',
      filter: (c) => c.projectId === currentProjectId,
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
      projectId: currentProjectId,
      filter: (q) => q.status === 'ISSUED' || q.status === 'SHARED',
      onData: setQuotations,
    });

    const uLd = subscribeTenantCollection<Lead>({
      orgId: activeOrgId,
      collectionName: 'leads',
      onData: setLeads,
    });

    return () => {
      uBk();
      uCol();
      uRec();
      uQt();
      uLd();
    };
  }, [activeOrgId, currentProjectId]);

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
      setBanner(`Created booking ${bk.bookingNumber} (status: ${bk.status}).`);
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
      await callBackendFunction('transitionBookingStatus', {
        orgId: activeOrgId,
        bookingId: bk.id,
        targetStatus,
        reason: targetStatus === 'CANCELLED' ? 'Authorized cancellation & inventory release' : undefined,
      });
      setBanner(`Booking ${bk.bookingNumber} updated to ${targetStatus}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Transition failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !recordPaymentBk) return;
    setBusy(true);
    try {
      const rec = await callBackendFunction<any, CollectionRecord>('recordCollectionEntry', {
        orgId: activeOrgId,
        bookingId: recordPaymentBk.id,
        recordType: recType,
        milestoneName: msName,
        demandAmountInr: Number(demandAmt),
        paidAmountInr: Number(paidAmt),
        paymentMode: payMode,
        instrumentRef: instRef || undefined,
      });
      setRecordPaymentBk(null);
      setBanner(
        payMode === 'RAZORPAY'
          ? `Created Razorpay collection (${rec.id}) in PENDING_VERIFICATION — awaits server-side HMAC webhook confirmation.`
          : `Recorded ${rec.recordType} (${rec.receiptNumber ?? rec.status}).`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to record collection.');
    } finally {
      setBusy(false);
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
      setBanner(`Reconciled settlement: ${res.status} (Discrepancy: ${formatInr(res.discrepancyAmountInr)}).`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Reconciliation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId || projects.length === 0 || !currentProjectId) {
    return (
      <EmptyState
        icon={ReceiptIndianRupee}
        title="No active bookings yet. Convert a unit hold or approved quotation into a booking."
        description="Create a project and issue an approved quotation first to initiate controlled unit bookings and customer ledgers."
      />
    );
  }

  const totalContracted = bookings
    .filter((b) => b.status !== 'CANCELLED')
    .reduce((acc, b) => acc + b.totalPayableInr, 0);
  const totalCollected = bookings.reduce((acc, b) => acc + b.totalCollectedVerifiedInr, 0);
  const totalOutstanding = bookings
    .filter((b) => b.status !== 'CANCELLED')
    .reduce((acc, b) => acc + b.outstandingBalanceInr, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Controlled Unit Bookings & Customer Collections"
        title="Bookings, Ledgers & Reconciliation"
        description="Separate builder customer collections from SaaS billing, with transactional booking locks and HMAC-verified Razorpay reconciliation."
        actions={
          <div className="flex items-center gap-2">
            <Select value={currentProjectId} onValueChange={selectProject}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PermissionGate permission="bookings:create" projectId={currentProjectId}>
              <Button size="sm" onClick={() => setNewBookingOpen(true)}>
                <Plus className="h-4 w-4" />
                New Booking
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Active Booking Value</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {formatInrCompact(totalContracted)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Verified Collections</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-emerald-700">
            {formatInrCompact(totalCollected)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Outstanding Receivable</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-amber-700">
            {formatInrCompact(totalOutstanding)}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="bookings">
        <TabsList>
          <TabsTrigger value="bookings">Bookings ({bookings.length})</TabsTrigger>
          <TabsTrigger value="collections">Customer Ledger & Receipts ({collections.length})</TabsTrigger>
          <TabsTrigger value="reconciliation">Bank Reconciliation ({reconciliations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings">
          {bookings.length === 0 ? (
            <EmptyState
              icon={ReceiptIndianRupee}
              title="No active bookings yet. Convert a unit hold or approved quotation into a booking."
              description="Link an issued quotation and buyer KYC to lock the unit transactionally and initialize the customer ledger."
              actionLabel="Initiate First Booking"
              onAction={() => setNewBookingOpen(true)}
            />
          ) : (
            <DataTable
              data={bookings}
              searchPlaceholder="Search booking number, unit, or customer..."
              columns={[
                { accessorKey: 'bookingNumber', header: 'Booking #' },
                { accessorKey: 'unitNumber', header: 'Unit' },
                {
                  id: 'customer',
                  header: 'Customer',
                  cell: ({ row }) => row.original.customer.fullName,
                },
                {
                  accessorKey: 'totalPayableInr',
                  header: 'Contract Total',
                  cell: ({ row }) => formatInr(row.original.totalPayableInr),
                },
                {
                  accessorKey: 'totalCollectedVerifiedInr',
                  header: 'Collected',
                  cell: ({ row }) => formatInr(row.original.totalCollectedVerifiedInr),
                },
                {
                  accessorKey: 'outstandingBalanceInr',
                  header: 'Outstanding',
                  cell: ({ row }) => formatInr(row.original.outstandingBalanceInr),
                },
                {
                  accessorKey: 'status',
                  header: 'Status',
                  cell: ({ row }) => <StatusBadge status={row.original.status} />,
                },
                {
                  id: 'actions',
                  header: 'Workflow',
                  cell: ({ row }) => {
                    const bk = row.original;
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {bk.status !== 'CANCELLED' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRecordPaymentBk(bk)}
                          >
                            + Demand / Receipt
                          </Button>
                        )}
                        {bk.status === 'PENDING_APPROVAL' && (
                          <Button size="sm" onClick={() => handleTransition(bk, 'BOOKED')}>
                            <Check className="h-3 w-3" /> Approve
                          </Button>
                        )}
                        {bk.status === 'BOOKED' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleTransition(bk, 'AGREEMENT_EXECUTED')}
                          >
                            Agreement
                          </Button>
                        )}
                        {bk.status === 'AGREEMENT_EXECUTED' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleTransition(bk, 'REGISTERED')}
                          >
                            Register
                          </Button>
                        )}
                        {bk.status !== 'CANCELLED' && bk.status !== 'REGISTERED' && (
                          <PermissionGate permission="bookings:cancel">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => handleTransition(bk, 'CANCELLED')}
                            >
                              <XCircle className="h-3.5 w-3.5" /> Cancel & Release
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

        <TabsContent value="collections">
          <DataTable
            data={collections}
            searchPlaceholder="Search receipt number, milestone, or mode..."
            emptyMessage="No collection demands or receipts recorded yet."
            columns={[
              { accessorKey: 'milestoneName', header: 'Milestone / Particulars' },
              { accessorKey: 'recordType', header: 'Type' },
              { accessorKey: 'paymentMode', header: 'Mode' },
              {
                accessorKey: 'demandAmountInr',
                header: 'Demand',
                cell: ({ row }) => formatInr(row.original.demandAmountInr),
              },
              {
                accessorKey: 'paidAmountInr',
                header: 'Paid / Refunded',
                cell: ({ row }) => formatInr(row.original.paidAmountInr),
              },
              { accessorKey: 'receiptNumber', header: 'Receipt #' },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
              },
              {
                id: 'reconcile',
                header: 'Reconcile',
                cell: ({ row }) =>
                  row.original.status === 'VERIFIED' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReconcileTarget(row.original);
                        setSettledAmt(String(row.original.paidAmountInr));
                      }}
                    >
                      <ShieldCheck className="h-3 w-3" /> Reconcile
                    </Button>
                  ) : null,
              },
            ]}
          />
        </TabsContent>

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
                cell: ({ row }) => formatInr(row.original.discrepancyAmountInr),
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

      {/* Create Booking Modal */}
      <Dialog open={newBookingOpen} onOpenChange={setNewBookingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Controlled Unit Booking</DialogTitle>
            <DialogDescription>
              Links an issued quotation and lead inside a server-side Firestore transaction.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateBooking} className="space-y-3">
            <div className="space-y-1">
              <Label>Select Issued Quotation *</Label>
              <Select value={qtId} onValueChange={setQtId}>
                <SelectTrigger><SelectValue placeholder="Choose approved quotation" /></SelectTrigger>
                <SelectContent>
                  {quotations.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.quotationNumber} — Unit {q.unitNumber} ({formatInr(q.totalPayableInr)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Link Buyer Lead *</Label>
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger><SelectValue placeholder="Choose CRM lead" /></SelectTrigger>
                <SelectContent>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.customerName} ({l.normalizedPhone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Applicant PAN</Label>
                <Input placeholder="ABCDE1234F" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1">
                <Label>Aadhaar (Last 4 Digits)</Label>
                <Input maxLength={4} placeholder="4321" value={aadhaarLast4} onChange={(e) => setAadhaarLast4(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Permanent Address *</Label>
              <Input required value={permAddress} onChange={(e) => setPermAddress(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Booking Token Amount (INR) *</Label>
              <Input type="number" required value={tokenAmt} onChange={(e) => setTokenAmt(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !qtId || !leadId}>
                Confirm & Lock Unit Booking
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Record Collection / Demand / Refund Modal */}
      <Dialog
        open={Boolean(recordPaymentBk)}
        onOpenChange={(o) => !o && setRecordPaymentBk(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Record Ledger Entry — {recordPaymentBk?.bookingNumber}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordCollection} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Entry Type *</Label>
                <Select value={recType} onValueChange={(v: any) => setRecType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RECEIPT">Full Milestone Receipt</SelectItem>
                    <SelectItem value="PARTIAL_PAYMENT">Partial Payment</SelectItem>
                    <SelectItem value="MILESTONE_DEMAND">Milestone Demand Notice</SelectItem>
                    <SelectItem value="REFUND">Customer Refund</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payment Mode *</Label>
                <Select value={payMode} onValueChange={(v: any) => setPayMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT">NEFT</SelectItem>
                    <SelectItem value="RTGS">RTGS</SelectItem>
                    <SelectItem value="IMPS">IMPS</SelectItem>
                    <SelectItem value="CHEQUE">Cheque / DD</SelectItem>
                    <SelectItem value="RAZORPAY">Razorpay Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Milestone / Particulars *</Label>
              <Input required value={msName} onChange={(e) => setMsName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Demand Amount (INR)</Label>
                <Input type="number" value={demandAmt} onChange={(e) => setDemandAmt(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Paid / Refunded Amount (INR)</Label>
                <Input type="number" value={paidAmt} onChange={(e) => setPaidAmt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Instrument / UTR Reference</Label>
              <Input value={instRef} onChange={(e) => setInstRef(e.target.value)} placeholder="UTR / Cheque #" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Save Ledger Entry</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bank Settlement Reconciliation Modal */}
      <Dialog
        open={Boolean(reconcileTarget)}
        onOpenChange={(o) => !o && setReconcileTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconcile Bank Settlement</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReconcile} className="space-y-3">
            <div className="space-y-1">
              <Label>Bank Statement / Settlement Reference *</Label>
              <Input required value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="HDFC-UTR-9928374" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Settled Amount (INR) *</Label>
                <Input type="number" required value={settledAmt} onChange={(e) => setSettledAmt(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Gateway Fee (INR)</Label>
                <Input type="number" value={gatewayFee} onChange={(e) => setGatewayFee(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Record Reconciliation</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
