import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import {
  Check,
  Download,
  FileSpreadsheet,
  Plus,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  calculateCostSheet,
  formatAreaSqft,
  formatInr,
  validatePaymentPlanPercentages,
  type ApprovalRequest,
  type ParkingSlot,
  type PaymentPlan,
  type PaymentPlanMilestone,
  type PriceBook,
  type Quotation,
  type Tower,
  type Unit,
} from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable } from '@/components/shared/DataTable';
import { PermissionGate } from '@/components/shared/PermissionGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

const DEFAULT_CLP_MILESTONES: PaymentPlanMilestone[] = [
  { sequence: 1, name: 'Booking Token Advance', percentage: 10, dueTrigger: 'On Booking', taxTreatment: 'PROPORTIONAL_GST' },
  { sequence: 2, name: 'Sale Agreement Execution', percentage: 10, dueTrigger: 'Within 30 Days of Booking', taxTreatment: 'PROPORTIONAL_GST' },
  { sequence: 3, name: 'Excavation & Foundation', percentage: 15, dueTrigger: 'On Completion of Foundation', taxTreatment: 'PROPORTIONAL_GST' },
  { sequence: 4, name: 'Basement & Podium Slabs', percentage: 15, dueTrigger: 'On Casting of Podium Slab', taxTreatment: 'PROPORTIONAL_GST' },
  { sequence: 5, name: 'Mid-Level Superstructure Slab', percentage: 15, dueTrigger: 'On Casting of Mid-Level Superstructure Slab', taxTreatment: 'PROPORTIONAL_GST' },
  { sequence: 6, name: 'Terrace & Brick/Block Work', percentage: 15, dueTrigger: 'On Completion of Terrace Slab', taxTreatment: 'PROPORTIONAL_GST' },
  { sequence: 7, name: 'Internal Flooring & MEP', percentage: 15, dueTrigger: 'On Completion of Internal Finishes', taxTreatment: 'PROPORTIONAL_GST' },
  { sequence: 8, name: 'Notice of Possession & Handover', percentage: 5, dueTrigger: 'On Offer of Possession', taxTreatment: 'INCLUDE_POSSESSION_CHARGES' },
];

export function CostSheetGeneratorPanel({ projectId }: { projectId: string }) {
  const [searchParams] = useSearchParams();
  const initialUnitId = searchParams.get('unitId') || '';

  const { activeOrgId } = useTenantStore();
  const [towers, setTowers] = React.useState<Tower[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [priceBooks, setPriceBooks] = React.useState<PriceBook[]>([]);
  const [paymentPlans, setPaymentPlans] = React.useState<PaymentPlan[]>([]);
  const [parkingSlots, setParkingSlots] = React.useState<ParkingSlot[]>([]);
  const [quotations, setQuotations] = React.useState<Quotation[]>([]);
  const [discountApprovals, setDiscountApprovals] = React.useState<ApprovalRequest[]>([]);

  // 15-Step Quotation Builder Selection State
  const [towerFilter, setTowerFilter] = React.useState<string>('ALL');
  const [floorFilter, setFloorFilter] = React.useState<string>('ALL');
  const [selectedUnitId, setSelectedUnitId] = React.useState<string>(initialUnitId);
  const [selectedPbId, setSelectedPbId] = React.useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = React.useState<string>('');
  const [parkingCount, setParkingCount] = React.useState<string>('2');
  const [parkingType, setParkingType] = React.useState<'STANDARD' | 'TANDEM' | 'MECHANICAL' | 'EV' | 'ACCESSIBLE'>('STANDARD');
  const [discountType, setDiscountType] = React.useState<'NONE' | 'FIXED_INR' | 'PER_SQFT' | 'PERCENTAGE_OF_BASE'>('NONE');
  const [discountValue, setDiscountValue] = React.useState<string>('0');
  const [discountReason, setDiscountReason] = React.useState<string>('');
  const [custName, setCustName] = React.useState<string>('');
  const [custPhone, setCustPhone] = React.useState<string>('');
  const [custEmail, setCustEmail] = React.useState<string>('');
  const [terms, setTerms] = React.useState<string>(
    '1. Quotation valid for 15 days subject to unit availability. 2. Cheques/RTGS in favour of Builder RERA Escrow Account. 3. Stamp duty & registration extra at actuals.'
  );

  // CLP Payment Plan Modal
  const [planModalOpen, setPlanModalOpen] = React.useState(false);
  const [planName, setPlanName] = React.useState('Construction-Linked Plan (CLP)');
  const [planType, setPlanType] = React.useState<'CONSTRUCTION_LINKED' | 'DATE_LINKED' | 'DOWN_PAYMENT' | 'CUSTOM'>('CONSTRUCTION_LINKED');
  const [milestones, setMilestones] = React.useState<PaymentPlanMilestone[]>(DEFAULT_CLP_MILESTONES);

  const [banner, setBanner] = React.useState<string | null>(null);
  const [aiHelperOutput, setAiHelperOutput] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!activeOrgId || !projectId) return;

    const u1 = subscribeTenantCollection<Tower>({
      orgId: activeOrgId,
      collectionName: 'towers',
      projectId,
      onData: setTowers,
    });
    const u2 = subscribeTenantCollection<Unit>({
      orgId: activeOrgId,
      collectionName: 'units',
      projectId,
      onData: (list) => {
        setUnits(list);
        if (!selectedUnitId && list[0]) setSelectedUnitId(list[0].id);
      },
    });
    const u3 = subscribeTenantCollection<PriceBook>({
      orgId: activeOrgId,
      collectionName: 'price_books',
      projectId,
      filter: (b) => b.status === 'ACTIVE' || b.status === 'APPROVED',
      onData: (approved) => {
        setPriceBooks(approved);
        if (!selectedPbId && approved[0]) setSelectedPbId(approved[0].id);
      },
    });
    const u4 = subscribeTenantCollection<PaymentPlan>({
      orgId: activeOrgId,
      collectionName: 'payment_plans',
      projectId,
      onData: (list) => {
        setPaymentPlans(list);
        if (!selectedPlanId && list[0]) setSelectedPlanId(list[0].id);
      },
    });
    const u5 = subscribeTenantCollection<ParkingSlot>({
      orgId: activeOrgId,
      collectionName: 'parking_slots',
      projectId,
      onData: setParkingSlots,
    });
    const u6 = subscribeTenantCollection<Quotation>({
      orgId: activeOrgId,
      collectionName: 'quotations',
      projectId,
      sort: sortDescByIso<Quotation>('createdAt'),
      onData: setQuotations,
    });
    const u7 = subscribeTenantCollection<ApprovalRequest>({
      orgId: activeOrgId,
      collectionName: 'approvals',
      extraConstraints: [
        where('entityType', '==', 'QUOTATION_DISCOUNT'),
        where('status', '==', 'PENDING'),
      ],
      filter: (a) => a.entityType === 'QUOTATION_DISCOUNT' && a.status === 'PENDING',
      onData: setDiscountApprovals,
    });

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
    };
  }, [activeOrgId, projectId]);

  const selectableUnits = React.useMemo(() => {
    return units.filter((u) => {
      if (towerFilter !== 'ALL' && u.towerId !== towerFilter) return false;
      if (floorFilter !== 'ALL' && String(u.floorNumber) !== floorFilter) return false;
      return true;
    });
  }, [units, towerFilter, floorFilter]);

  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;
  const selectedPb = priceBooks.find((b) => b.id === selectedPbId) ?? null;
  const selectedPlan = paymentPlans.find((p) => p.id === selectedPlanId) ?? null;

  const liveBreakdown = React.useMemo(() => {
    if (!selectedUnit || !selectedPb) return null;
    try {
      const assignedPhysical = parkingSlots.filter((s) => s.allocatedUnitId === selectedUnit.id);
      return calculateCostSheet({
        unit: selectedUnit,
        priceBook: selectedPb,
        paymentPlan: selectedPlan,
        allocatedParkingSlots: assignedPhysical.length > 0 ? assignedPhysical : undefined,
        fallbackParkingCount: Number(parkingCount) || 0,
        fallbackParkingType: parkingType,
        discount: {
          type: discountType,
          value: Number(discountValue) || 0,
        },
      });
    } catch {
      return null;
    }
  }, [
    selectedUnit,
    selectedPb,
    selectedPlan,
    parkingSlots,
    parkingCount,
    parkingType,
    discountType,
    discountValue,
  ]);

  const milestoneValidation = validatePaymentPlanPercentages(milestones);

  const handleSavePaymentPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const created = await callBackendFunction<any, PaymentPlan>('createPaymentPlan', {
        orgId: activeOrgId,
        projectId,
        name: planName,
        planType,
        milestones,
      });
      setSelectedPlanId(created.id);
      setPlanModalOpen(false);
      setBanner(`Created payment plan "${created.name}" (100% reconciled).`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to create payment plan.');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !selectedUnit || !selectedPb || !selectedPlan) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await callBackendFunction<
        any,
        { quotation: Quotation; pdfBase64: string }
      >('createQuotation', {
        orgId: activeOrgId,
        projectId,
        unitId: selectedUnit.id,
        priceBookId: selectedPb.id,
        paymentPlanId: selectedPlan.id,
        customer: {
          name: custName,
          phone: custPhone,
          email: custEmail,
        },
        selectedParkingSlotIds: selectedUnit.assignedParkingSlotIds,
        parkingSlotsCount: Number(parkingCount) || 0,
        parkingTypeUsed: parkingType,
        discount: {
          type: discountType,
          value: Number(discountValue) || 0,
          reason: discountReason || undefined,
        },
        validDays: 15,
        termsAndConditions: terms,
      });

      // Trigger browser PDF download from authoritative server-generated PDF bytes
      const byteCharacters = atob(res.pdfBase64);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${res.quotation.quotationNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      setBanner(
        `Generated versioned PDF Quotation ${res.quotation.quotationNumber} (${res.quotation.status}).`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Quotation generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRunAiExplain = async () => {
    if (!activeOrgId || !liveBreakdown || !selectedUnit) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<any, { text: string }>('runAiAssistant', {
        orgId: activeOrgId,
        feature: 'COST_SHEET_EXPLANATION',
        context: {
          unitNumber: selectedUnit.unitNumber,
          bhk: selectedUnit.bhk,
          saleableAreaSqft: selectedUnit.saleableAreaSqft,
          totalPayableInr: liveBreakdown.totalPayableInr,
          totalGstInr: liveBreakdown.totalGstInr,
          milestonesCount: liveBreakdown.schedule.length,
        },
      });
      setAiHelperOutput(res.text);
    } catch (err) {
      setAiHelperOutput(
        err instanceof Error
          ? err.message
          : 'OpenAI API key is not configured on backend (`OPENAI_API_KEY`). Financial calculations remain 100% deterministic.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async (qt: Quotation, channel: 'WHATSAPP' | 'EMAIL') => {
    if (!activeOrgId) return;
    try {
      await callBackendFunction('shareQuotationAuthorized', {
        orgId: activeOrgId,
        quotationId: qt.id,
        channel,
      });
      setBanner(`Marked ${qt.quotationNumber} as shared via ${channel}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Sharing blocked.');
    }
  };

  return (
    <div className="space-y-6">
      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
          {banner}
        </div>
      )}

      {/* Pending Discount Approvals */}
      {discountApprovals.length > 0 && (
        <PermissionGate permission="quotations:approve_discount" projectId={projectId}>
          <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Pending Quotation Discount Approvals ({discountApprovals.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {discountApprovals.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-xs"
                >
                  <span>{app.requestSummary}</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        callBackendFunction('decideApproval', {
                          orgId: activeOrgId,
                          approvalId: app.id,
                          decision: 'APPROVED',
                          decisionNotes: 'Discount approved',
                        })
                      }
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        callBackendFunction('decideApproval', {
                          orgId: activeOrgId,
                          approvalId: app.id,
                          decision: 'REJECTED',
                          decisionNotes: 'Exceeds margin floor',
                        })
                      }
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </PermissionGate>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          Payment Schedules ({paymentPlans.length}) & 15-Step Quotation Builder
        </div>
        <Button variant="outline" size="sm" onClick={() => setPlanModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New CLP / Payment Plan
        </Button>
      </div>

      {priceBooks.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No approved price book. Create your pricing rules."
          description="Approve and activate at least one Price Book in the first tab before generating customer cost sheets."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left: Configuration Form */}
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-sm">Configure Cost Sheet Parameters</CardTitle>
              <CardDescription>
                Select tower, floor, unit, approved price book, parking, CLP plan, and customer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleGenerateQuotation} className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label>Tower Filter</Label>
                    <Select value={towerFilter} onValueChange={setTowerFilter}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Towers</SelectItem>
                        {towers.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Floor Filter</Label>
                    <Input
                      placeholder="ALL or Floor #"
                      value={floorFilter === 'ALL' ? '' : floorFilter}
                      onChange={(e) => setFloorFilter(e.target.value ? e.target.value : 'ALL')}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Select Unit *</Label>
                  <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                    <SelectTrigger><SelectValue placeholder="Choose unit" /></SelectTrigger>
                    <SelectContent>
                      {selectableUnits.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.unitNumber} — {u.bhk} ({formatAreaSqft(u.saleableAreaSqft)}) [{u.status}]
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label>Approved Price Book *</Label>
                    <Select value={selectedPbId} onValueChange={setSelectedPbId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {priceBooks.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            v{b.versionNumber} — {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Payment Plan *</Label>
                    <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                      <SelectTrigger><SelectValue placeholder="Create plan ->" /></SelectTrigger>
                      <SelectContent>
                        {paymentPlans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label>Parking Spaces</Label>
                    <Input
                      type="number"
                      min={0}
                      max={6}
                      value={parkingCount}
                      onChange={(e) => setParkingCount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Parking Category</Label>
                    <Select value={parkingType} onValueChange={(v: any) => setParkingType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STANDARD">Standard</SelectItem>
                        <SelectItem value="TANDEM">Tandem</SelectItem>
                        <SelectItem value="EV">EV Bay</SelectItem>
                        <SelectItem value="MECHANICAL">Mechanical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label>Permitted Discount</Label>
                    <Select value={discountType} onValueChange={(v: any) => setDiscountType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">No Discount</SelectItem>
                        <SelectItem value="FIXED_INR">Fixed Amount (INR)</SelectItem>
                        <SelectItem value="PER_SQFT">Per Sq. Ft. (INR)</SelectItem>
                        <SelectItem value="PERCENTAGE_OF_BASE">% of Base Price</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Discount Value</Label>
                    <Input
                      type="number"
                      min={0}
                      disabled={discountType === 'NONE'}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </div>
                </div>
                {discountType !== 'NONE' && (
                  <Input
                    placeholder="Reason for discount"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                  />
                )}

                <div className="border-t border-border pt-3 space-y-2.5">
                  <div className="text-xs font-semibold">Customer Details</div>
                  <Input
                    required
                    placeholder="Customer Full Name *"
                    value={custName}
                    onChange={(e) => setCustName(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      required
                      placeholder="Phone (+91...) *"
                      value={custPhone}
                      onChange={(e) => setCustPhone(e.target.value)}
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={custEmail}
                      onChange={(e) => setCustEmail(e.target.value)}
                    />
                  </div>
                  <Textarea
                    rows={2}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || !selectedUnit || !selectedPb || !selectedPlan}
                >
                  <Download className="h-4 w-4" />
                  {busy
                    ? 'Generating Authoritative PDF...'
                    : liveBreakdown?.requiresDiscountApproval
                      ? 'Submit Discount Approval & Generate Draft PDF'
                      : 'Issue Versioned Quotation & Download PDF'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Right: Live Deterministic Cost Sheet & CLP Preview */}
          <Card className="lg:col-span-7">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">
                    Deterministic Cost Sheet Preview{' '}
                    {selectedUnit ? `— Unit ${selectedUnit.unitNumber}` : ''}
                  </CardTitle>
                  <CardDescription>
                    Exact backend formula calculation. AI assists copy & explanations only.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!liveBreakdown || busy}
                  onClick={handleRunAiExplain}
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  AI Summary & Share Copy
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {aiHelperOutput && (
                <div className="rounded-md border border-border bg-accent/40 p-3 text-xs leading-relaxed">
                  {aiHelperOutput}
                </div>
              )}

              {liveBreakdown ? (
                <>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="bm-table w-full text-xs">
                      <thead>
                        <tr>
                          <th>Component</th>
                          <th>Base (INR)</th>
                          <th>GST</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveBreakdown.lineItems.map((li) => (
                          <tr key={li.internalKey}>
                            <td className="font-medium">{li.displayLabel}</td>
                            <td>{formatInr(li.baseAmountInr)}</td>
                            <td>
                              {formatInr(li.gstAmountInr)} ({li.gstPct}%)
                            </td>
                            <td className="font-semibold">{formatInr(li.totalWithGstInr)}</td>
                          </tr>
                        ))}
                        {liveBreakdown.discountAmountInr > 0 && (
                          <tr className="text-emerald-700 font-semibold">
                            <td>Less: Negotiated Discount ({liveBreakdown.discountEffectivePct}%)</td>
                            <td>- {formatInr(liveBreakdown.discountAmountInr)}</td>
                            <td>—</td>
                            <td>
                              {liveBreakdown.requiresDiscountApproval
                                ? 'Requires Approval'
                                : 'Within Policy'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-primary px-4 py-3 text-primary-foreground">
                    <div>
                      <div className="text-xs opacity-85">All-Inclusive Total Payable</div>
                      <div className="text-[11px] opacity-75">
                        Includes Total GST of {formatInr(liveBreakdown.totalGstInr)}
                      </div>
                    </div>
                    <div className="text-xl font-bold">
                      {formatInr(liveBreakdown.totalPayableInr)}
                    </div>
                  </div>

                  {/* CLP Schedule Table */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold">
                      Payment Schedule ({liveBreakdown.schedule.length} Milestones)
                    </div>
                    <div className="rounded-md border border-border overflow-hidden max-h-56 overflow-y-auto">
                      <table className="bm-table w-full text-xs">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Milestone & Due Trigger</th>
                            <th>%</th>
                            <th>Installment Payable</th>
                          </tr>
                        </thead>
                        <tbody>
                          {liveBreakdown.schedule.map((m) => (
                            <tr key={m.sequence}>
                              <td>{m.sequence}</td>
                              <td>
                                <div className="font-medium">{m.name}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {m.dueTrigger}
                                </div>
                              </td>
                              <td>{m.percentage}%</td>
                              <td className="font-semibold">
                                {formatInr(m.totalInstallmentPayableInr)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  Select a unit and approved price book to preview the exact cost breakdown.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quotation History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Issued Quotation History ({quotations.length})</CardTitle>
          <CardDescription>
            Each quotation retains its frozen approved pricing snapshot even after subsequent price
            revisions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={quotations}
            searchPlaceholder="Search quotation number, unit, or customer..."
            emptyMessage="No quotations generated for this project yet."
            columns={[
              { accessorKey: 'quotationNumber', header: 'Quotation #' },
              { accessorKey: 'unitNumber', header: 'Unit' },
              {
                id: 'customer',
                header: 'Customer',
                cell: ({ row }) => (
                  <div>
                    <div className="font-medium">{row.original.customer.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.original.customer.phone}
                    </div>
                  </div>
                ),
              },
              {
                accessorKey: 'priceBookVersion',
                header: 'Price Book',
                cell: ({ row }) => `v${row.original.priceBookVersion}`,
              },
              {
                accessorKey: 'totalPayableInr',
                header: 'Total Payable',
                cell: ({ row }) => (
                  <span className="font-semibold">{formatInr(row.original.totalPayableInr)}</span>
                ),
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
              },
              {
                id: 'share',
                header: 'Share',
                cell: ({ row }) => (
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={row.original.status === 'PENDING_APPROVAL'}
                      onClick={() => handleShare(row.original, 'WHATSAPP')}
                    >
                      <Share2 className="h-3 w-3" /> WhatsApp
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={row.original.status === 'PENDING_APPROVAL'}
                      onClick={() => handleShare(row.original, 'EMAIL')}
                    >
                      Email
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Construction-Linked Payment Plan Creator Dialog */}
      <Dialog open={planModalOpen} onOpenChange={setPlanModalOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create Construction-Linked or Date-Linked Payment Plan</DialogTitle>
            <DialogDescription>
              Milestones must reconcile to exactly 100.00%. Current sum:{' '}
              <strong>{milestoneValidation.totalPercentage}%</strong>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSavePaymentPlan} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Plan Name *</Label>
                <Input required value={planName} onChange={(e) => setPlanName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Schedule Type *</Label>
                <Select value={planType} onValueChange={(v: any) => setPlanType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONSTRUCTION_LINKED">Construction-Linked (CLP)</SelectItem>
                    <SelectItem value="DATE_LINKED">Date-Linked</SelectItem>
                    <SelectItem value="DOWN_PAYMENT">Down Payment</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2 rounded-md border border-border p-3">
              {milestones.map((ms, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <Input
                      value={ms.name}
                      onChange={(e) =>
                        setMilestones((prev) =>
                          prev.map((m, i) => (i === idx ? { ...m, name: e.target.value } : m))
                        )
                      }
                      placeholder="Milestone name"
                    />
                  </div>
                  <div className="col-span-4">
                    <Input
                      value={ms.dueTrigger}
                      onChange={(e) =>
                        setMilestones((prev) =>
                          prev.map((m, i) => (i === idx ? { ...m, dueTrigger: e.target.value } : m))
                        )
                      }
                      placeholder="Due trigger"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      step="0.5"
                      value={ms.percentage}
                      onChange={(e) =>
                        setMilestones((prev) =>
                          prev.map((m, i) =>
                            i === idx ? { ...m, percentage: Number(e.target.value) } : m
                          )
                        )
                      }
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setMilestones((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-destructive p-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setMilestones((prev) => [
                    ...prev,
                    {
                      sequence: prev.length + 1,
                      name: `Milestone ${prev.length + 1}`,
                      percentage: 5,
                      dueTrigger: 'Upon Completion',
                      taxTreatment: 'PROPORTIONAL_GST',
                    },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add Milestone
              </Button>
              <span
                className={`text-xs font-semibold ${
                  milestoneValidation.valid ? 'text-emerald-700' : 'text-destructive'
                }`}
              >
                Total: {milestoneValidation.totalPercentage}%{' '}
                {milestoneValidation.valid ? '(Reconciled)' : '(Must equal 100%)'}
              </span>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={busy || !milestoneValidation.valid}>
                Save Payment Plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
