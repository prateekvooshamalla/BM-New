import * as React from 'react';
import { where } from 'firebase/firestore';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Check,
  Copy,
  Eye,
  Lock,
  Plus,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  calculateCostSheet,
  formatInr,
  formatInrCompact,
  isPriceBookImmutable,
  type ApprovalRequest,
  type CostSheetLineItemRule,
  type PriceBook,
  type PriceRevision,
  type Unit,
} from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable } from '@/components/shared/DataTable';
import { PermissionGate } from '@/components/shared/PermissionGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
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

const INITIAL_LINE_ITEMS: CostSheetLineItemRule[] = [
  {
    id: 'li-amenities',
    internalKey: 'amenities_charges',
    displayLabel: 'Amenities Charges',
    description: 'Builder can rename e.g. Amenities & Infrastructure Development Charges',
    basis: 'FIXED_AMOUNT',
    amount: 600000,
    taxCategory: 'AGREEMENT_GST',
    isOptional: false,
    isVisible: true,
    isRemovable: true,
    displayOrder: 1,
  },
  {
    id: 'li-infra',
    internalKey: 'infrastructure_charges',
    displayLabel: 'Infrastructure Charges',
    basis: 'PER_SQFT_SALEABLE',
    amount: 150,
    taxCategory: 'AGREEMENT_GST',
    isOptional: false,
    isVisible: true,
    isRemovable: true,
    displayOrder: 2,
  },
  {
    id: 'li-maint',
    internalKey: 'maintenance_advance',
    displayLabel: 'Maintenance Advance (24 Months)',
    basis: 'PER_SQFT_SALEABLE',
    amount: 120,
    taxCategory: 'OTHER_SERVICE_GST',
    isOptional: false,
    isVisible: true,
    isRemovable: true,
    displayOrder: 3,
  },
  {
    id: 'li-legal',
    internalKey: 'legal_documentation',
    displayLabel: 'Legal & Documentation Charges',
    basis: 'FIXED_AMOUNT',
    amount: 50000,
    taxCategory: 'OTHER_SERVICE_GST',
    isOptional: false,
    isVisible: true,
    isRemovable: true,
    displayOrder: 4,
  },
  {
    id: 'li-corpus',
    internalKey: 'corpus_fund',
    displayLabel: 'Corpus Fund',
    basis: 'PER_SQFT_SALEABLE',
    amount: 200,
    taxCategory: 'EXEMPT_CORPUS',
    isOptional: false,
    isVisible: true,
    isRemovable: true,
    displayOrder: 5,
  },
];

export function PriceBookManagerPanel({ projectId }: { projectId: string }) {
  const { activeOrgId } = useTenantStore();
  const [priceBooks, setPriceBooks] = React.useState<PriceBook[]>([]);
  const [revisions, setRevisions] = React.useState<PriceRevision[]>([]);
  const [approvals, setApprovals] = React.useState<ApprovalRequest[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);

  const [selectedBookId, setSelectedBookId] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [previewUnitId, setPreviewUnitId] = React.useState<string>('');
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Draft Editor State
  const [editingId, setEditingId] = React.useState<string | undefined>(undefined);
  const [pbName, setPbName] = React.useState('Launch Price Book');
  const [pbDesc, setPbDesc] = React.useState('');
  const [pbEffective, setPbEffective] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [pbExpiry, setPbExpiry] = React.useState('');
  const [baseRate, setBaseRate] = React.useState('10500');
  const [flatSizePickerOpen, setFlatSizePickerOpen] = React.useState(false);
  const [selectedBaselineSource, setSelectedBaselineSource] = React.useState<string | null>(null);
  const [floorRiseEnabled, setFloorRiseEnabled] = React.useState(true);
  const [floorRiseStart, setFloorRiseStart] = React.useState('5');
  const [floorRiseRate, setFloorRiseRate] = React.useState('50');
  const [eastPremium, setEastPremium] = React.useState('150');
  const [northPremium, setNorthPremium] = React.useState('100');
  const [parkViewPremium, setParkViewPremium] = React.useState('125');
  const [cornerPremium, setCornerPremium] = React.useState('100');
  const [locationPremium, setLocationPremium] = React.useState('0');
  const [stdParkingPrice, setStdParkingPrice] = React.useState('450000');
  const [evParkingPrice, setEvParkingPrice] = React.useState('550000');
  const [tandemParkingPrice, setTandemParkingPrice] = React.useState('750000');
  const [agreementGst, setAgreementGst] = React.useState('5');
  const [serviceGst, setServiceGst] = React.useState('18');
  const [maxAutoDiscount, setMaxAutoDiscount] = React.useState('2');
  const [internalNotes, setInternalNotes] = React.useState('');
  const [lineItems, setLineItems] = React.useState<CostSheetLineItemRule[]>(INITIAL_LINE_ITEMS);

  const inventoryFlatSizes = React.useMemo(() => {
    const map = new Map<string, {
      unitType: string;
      bhk: string;
      saleableAreaSqft: number;
      carpetAreaSqft: number;
      baseRatePerSqft: number;
      unitsCount: number;
    }>();
    for (const u of units) {
      const key = `${u.unitType}_${u.bhk}_${u.saleableAreaSqft}_${u.baseRatePerSqft}`;
      const existing = map.get(key);
      if (existing) {
        existing.unitsCount++;
      } else {
        map.set(key, {
          unitType: u.unitType,
          bhk: u.bhk,
          saleableAreaSqft: u.saleableAreaSqft,
          carpetAreaSqft: u.carpetAreaSqft,
          baseRatePerSqft: u.baseRatePerSqft,
          unitsCount: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.saleableAreaSqft - b.saleableAreaSqft);
  }, [units]);

  const handleGeneratePricing = () => {
    if (inventoryFlatSizes.length === 0) {
      setBanner('No inventory units found in this project. Please create or bulk-generate units first to establish baseline pricing.');
      return;
    }
    if (inventoryFlatSizes.length === 1) {
      const item = inventoryFlatSizes[0];
      setBaseRate(String(item.baseRatePerSqft));
      setSelectedBaselineSource(`${item.bhk} (${item.saleableAreaSqft} sq.ft.) @ ₹${item.baseRatePerSqft.toLocaleString('en-IN')}/sq.ft.`);
      setBanner(`Applied v1 inventory base price ₹${item.baseRatePerSqft.toLocaleString('en-IN')}/sq.ft. from ${item.bhk} (${item.saleableAreaSqft} sq.ft.).`);
      return;
    }
    setFlatSizePickerOpen(true);
  };

  const handleApplyFlatSizeRate = (item: {
    bhk: string;
    saleableAreaSqft: number;
    baseRatePerSqft: number;
  }) => {
    setBaseRate(String(item.baseRatePerSqft));
    setSelectedBaselineSource(`${item.bhk} (${item.saleableAreaSqft} sq.ft.) @ ₹${item.baseRatePerSqft.toLocaleString('en-IN')}/sq.ft.`);
    setFlatSizePickerOpen(false);
    setBanner(`Applied v1 inventory base price ₹${item.baseRatePerSqft.toLocaleString('en-IN')}/sq.ft. from ${item.bhk} (${item.saleableAreaSqft} sq.ft.).`);
  };

  React.useEffect(() => {
    if (!activeOrgId || !projectId) return;

    const unsubPb = subscribeTenantCollection<PriceBook>({
      orgId: activeOrgId,
      collectionName: 'price_books',
      projectId,
      sort: (a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0),
      onData: (list) => {
        setPriceBooks(list);
        if (!selectedBookId && list[0]) {
          setSelectedBookId(list[0].id);
        }
      },
    });

    const unsubRev = subscribeTenantCollection<PriceRevision>({
      orgId: activeOrgId,
      collectionName: 'price_revisions',
      projectId,
      onData: setRevisions,
    });

    const unsubApp = subscribeTenantCollection<ApprovalRequest>({
      orgId: activeOrgId,
      collectionName: 'approvals',
      extraConstraints: [
        where('entityType', '==', 'PRICE_BOOK'),
        where('status', '==', 'PENDING'),
      ],
      filter: (a) => a.entityType === 'PRICE_BOOK' && a.status === 'PENDING',
      onData: setApprovals,
    });

    const unsubUnits = subscribeTenantCollection<Unit>({
      orgId: activeOrgId,
      collectionName: 'units',
      projectId,
      onData: (list) => {
        setUnits(list);
        if (!previewUnitId && list[0]) {
          setPreviewUnitId(list[0].id);
        }
      },
    });

    return () => {
      unsubPb();
      unsubRev();
      unsubApp();
      unsubUnits();
    };
  }, [activeOrgId, projectId]);

  const selectedBook = priceBooks.find((b) => b.id === selectedBookId) ?? priceBooks[0] ?? null;

  const openDraftEditor = (existing?: PriceBook) => {
    if (existing) {
      setEditingId(existing.id);
      setPbName(existing.name);
      setPbDesc(existing.description ?? '');
      setPbEffective(existing.effectiveFrom.slice(0, 10));
      setPbExpiry(existing.expiresAt?.slice(0, 10) ?? '');
      setBaseRate(String(existing.basePricePerSqft));
      setFloorRiseEnabled(existing.floorRise.enabled);
      setFloorRiseStart(String(existing.floorRise.startFloor));
      setFloorRiseRate(String(existing.floorRise.ratePerFloorPerSqft));
      setEastPremium(String(existing.facingPremiumPerSqft.EAST ?? 0));
      setNorthPremium(String(existing.facingPremiumPerSqft.NORTH ?? 0));
      setParkViewPremium(String(existing.viewPremiumPerSqft.CENTRAL_PARK ?? 0));
      setCornerPremium(String(existing.cornerPremiumPerSqft));
      setLocationPremium(String(existing.locationPremiumPerSqft));
      setStdParkingPrice(String(existing.parkingPricesByType.STANDARD));
      setEvParkingPrice(String(existing.parkingPricesByType.EV));
      setTandemParkingPrice(String(existing.parkingPricesByType.TANDEM));
      setAgreementGst(String(existing.taxConfig.agreementGstPct));
      setServiceGst(String(existing.taxConfig.otherServiceGstPct));
      setMaxAutoDiscount(String(existing.maxDiscountPctWithoutApproval));
      setInternalNotes(existing.internalNotes ?? '');
      setLineItems(structuredClone(existing.lineItems));
    } else {
      setEditingId(undefined);
      setPbName(`Price Book v${priceBooks.length + 1}`);
      setLineItems(structuredClone(INITIAL_LINE_ITEMS));
    }
    setEditorOpen(true);
  };

  const addCustomChargeRow = () => {
    const idx = lineItems.length + 1;
    setLineItems([
      ...lineItems,
      {
        id: `custom-${Date.now()}`,
        internalKey: `custom_charge_${idx}`,
        displayLabel: `Custom Charge ${idx}`,
        basis: 'FIXED_AMOUNT',
        amount: 100000,
        taxCategory: 'AGREEMENT_GST',
        isOptional: true,
        isVisible: true,
        isRemovable: true,
        displayOrder: idx,
      },
    ]);
  };

  const updateLineItem = (idx: number, patch: Partial<CostSheetLineItemRule>) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const removeLineItem = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setBusy(true);
    setBanner(null);
    try {
      const saved = await callBackendFunction<any, PriceBook>('savePriceBookDraft', {
        orgId: activeOrgId,
        projectId,
        priceBookId: editingId,
        name: pbName,
        description: pbDesc,
        effectiveFrom: new Date(pbEffective).toISOString(),
        expiresAt: pbExpiry ? new Date(pbExpiry).toISOString() : null,
        basePricePerSqft: Number(baseRate),
        floorRise: {
          enabled: floorRiseEnabled,
          startFloor: Number(floorRiseStart),
          ratePerFloorPerSqft: Number(floorRiseRate),
        },
        facingPremiumPerSqft: {
          EAST: Number(eastPremium),
          NORTH: Number(northPremium),
          NORTH_EAST: Number(eastPremium),
        },
        viewPremiumPerSqft: {
          CENTRAL_PARK: Number(parkViewPremium),
        },
        cornerPremiumPerSqft: Number(cornerPremium),
        locationPremiumPerSqft: Number(locationPremium),
        unitSpecificPremiumInr: {},
        parkingPricesByType: {
          STANDARD: Number(stdParkingPrice),
          TANDEM: Number(tandemParkingPrice),
          MECHANICAL: Number(stdParkingPrice),
          EV: Number(evParkingPrice),
          ACCESSIBLE: Number(stdParkingPrice),
        },
        lineItems,
        taxConfig: {
          agreementGstPct: Number(agreementGst),
          otherServiceGstPct: Number(serviceGst),
          roundingMode: 'NEAREST_RUPEE',
          registrationDisclaimer:
            'Stamp duty & registration charges are payable at actuals as per prevailing Government norms.',
        },
        maxDiscountPctWithoutApproval: Number(maxAutoDiscount),
        internalNotes,
      });
      setSelectedBookId(saved.id);
      setEditorOpen(false);
      setBanner(`Saved draft "${saved.name}" (v${saved.versionNumber}).`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to save draft price book.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitForApproval = async (pb: PriceBook) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      await callBackendFunction('submitPriceBookForApproval', {
        orgId: activeOrgId,
        projectId,
        priceBookId: pb.id,
      });
      setBanner(`Submitted "${pb.name}" v${pb.versionNumber} for director approval.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveDecision = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      await callBackendFunction('decideApproval', {
        orgId: activeOrgId,
        approvalId,
        decision,
        decisionNotes: `${decision} via Pricing Governance Panel`,
      });
      setBanner(`Price book ${decision.toLowerCase()}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async (pb: PriceBook) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<
        any,
        { updatedUnitsCount: number; revisionsCreated: number }
      >('activatePriceBook', {
        orgId: activeOrgId,
        projectId,
        priceBookId: pb.id,
        reason: `Activated ${pb.name} v${pb.versionNumber}`,
      });
      setBanner(
        `Activated v${pb.versionNumber}! Updated ${res.updatedUnitsCount} unbooked units and logged ${res.revisionsCreated} price revisions.`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Activation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleClone = async (pb: PriceBook) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const cloned = await callBackendFunction<any, PriceBook>('clonePriceBookVersion', {
        orgId: activeOrgId,
        projectId,
        sourcePriceBookId: pb.id,
      });
      setSelectedBookId(cloned.id);
      setBanner(`Cloned immutable v${pb.versionNumber} into editable draft v${cloned.versionNumber}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Clone failed.');
    } finally {
      setBusy(false);
    }
  };

  // Live deterministic impact preview on a selected real unit
  const impactPreview = React.useMemo(() => {
    if (!selectedBook || units.length === 0) return null;
    const unit = units.find((u) => u.id === previewUnitId) ?? units[0];
    if (!unit) return null;
    return {
      unit,
      breakdown: calculateCostSheet({ unit, priceBook: selectedBook }),
    };
  }, [selectedBook, units, previewUnitId]);

  const versionChartData = React.useMemo(() => {
    return [...priceBooks]
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map((b) => ({
        version: `v${b.versionNumber}`,
        baseRate: b.basePricePerSqft,
        name: b.name,
      }));
  }, [priceBooks]);

  return (
    <div className="space-y-6">
      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
          {banner}
        </div>
      )}

      {/* Pending Director Approvals Strip */}
      {approvals.length > 0 && (
        <PermissionGate permission="pricing:approve" projectId={projectId}>
          <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pending Price Book Approvals ({approvals.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {approvals.map((app) => (
                <div
                  key={app.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-xs"
                >
                  <div>
                    <div className="font-semibold">{app.requestSummary}</div>
                    <div className="text-muted-foreground">Requested by {app.requestedByName}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => handleApproveDecision(app.id, 'APPROVED')}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve & Lock
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleApproveDecision(app.id, 'REJECTED')}
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
          Project Price Books ({priceBooks.length})
        </div>
        <PermissionGate permission="pricing:edit_draft" projectId={projectId}>
          <Button size="sm" onClick={() => openDraftEditor()}>
            <Plus className="h-4 w-4" />
            Create Draft Price Book
          </Button>
        </PermissionGate>
      </div>

      {priceBooks.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No approved price book. Create your pricing rules."
          description="Define base rate per sq. ft., floor rise, facing/view/corner premiums, editable cost-sheet labels, custom charges, and GST slabs."
          actionLabel="Create First Price Book"
          onAction={() => openDraftEditor()}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Version List */}
          <div className="space-y-2.5">
            {priceBooks.map((pb) => {
              const immutable = pb.isImmutable || isPriceBookImmutable(pb.status);
              const isSelected = selectedBook?.id === pb.id;
              return (
                <div
                  key={pb.id}
                  onClick={() => setSelectedBookId(pb.id)}
                  className={`rounded-lg border p-4 cursor-pointer transition-colors ${
                    isSelected ? 'border-primary bg-accent/40' : 'border-border bg-card hover:bg-secondary/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm">
                      v{pb.versionNumber} — {pb.name}
                    </div>
                    <StatusBadge status={pb.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Base: <strong>{formatInr(pb.basePricePerSqft)}/sq.ft.</strong> • Effective{' '}
                    {new Date(pb.effectiveFrom).toLocaleDateString()}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {!immutable ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => openDraftEditor(pb)}>
                          Edit Draft
                        </Button>
                        {pb.status === 'DRAFT' && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => handleSubmitForApproval(pb)}
                          >
                            <Send className="h-3 w-3" />
                            Submit Approval
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1.5">
                          <Lock className="h-3 w-3" /> Immutable
                        </span>
                        <Button variant="outline" size="sm" onClick={() => handleClone(pb)}>
                          <Copy className="h-3 w-3" />
                          Clone New Version
                        </Button>
                        {pb.status === 'APPROVED' && (
                          <PermissionGate permission="pricing:activate" projectId={projectId}>
                            <Button size="sm" disabled={busy} onClick={() => handleActivate(pb)}>
                              Activate Now
                            </Button>
                          </PermissionGate>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Book Breakdown & Live Unit Impact Preview */}
          <div className="lg:col-span-2 space-y-6">
            {selectedBook && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>
                        {selectedBook.name} (v{selectedBook.versionNumber}) — Editable Line Items
                      </CardTitle>
                      <CardDescription>
                        Display labels customize customer cost sheets while internal keys remain
                        deterministic.
                      </CardDescription>
                    </div>
                    <StatusBadge status={selectedBook.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-4 text-xs">
                    <div className="rounded-md border border-border p-2.5">
                      <span className="text-muted-foreground">Base Rate</span>
                      <div className="font-bold text-sm mt-0.5">
                        {formatInr(selectedBook.basePricePerSqft)}/sq.ft.
                      </div>
                    </div>
                    <div className="rounded-md border border-border p-2.5">
                      <span className="text-muted-foreground">Floor Rise</span>
                      <div className="font-bold text-sm mt-0.5">
                        {selectedBook.floorRise.enabled
                          ? `₹${selectedBook.floorRise.ratePerFloorPerSqft}/fl (Fl ${selectedBook.floorRise.startFloor}+)`
                          : 'Disabled'}
                      </div>
                    </div>
                    <div className="rounded-md border border-border p-2.5">
                      <span className="text-muted-foreground">Agreement GST</span>
                      <div className="font-bold text-sm mt-0.5">
                        {selectedBook.taxConfig.agreementGstPct}%
                      </div>
                    </div>
                    <div className="rounded-md border border-border p-2.5">
                      <span className="text-muted-foreground">Max Auto Discount</span>
                      <div className="font-bold text-sm mt-0.5">
                        {selectedBook.maxDiscountPctWithoutApproval}%
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="bm-table w-full text-xs">
                      <thead>
                        <tr>
                          <th>Internal Key (Stable)</th>
                          <th>Editable Cost Sheet Label</th>
                          <th>Basis</th>
                          <th>Amount / Rate</th>
                          <th>Tax Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBook.lineItems.map((li) => (
                          <tr key={li.id}>
                            <td className="font-mono text-[11px] text-muted-foreground">
                              {li.internalKey}
                            </td>
                            <td className="font-medium">{li.displayLabel}</td>
                            <td>{li.basis.replace(/_/g, ' ')}</td>
                            <td>
                              {li.basis === 'PERCENTAGE_OF_BASE'
                                ? `${li.amount}%`
                                : formatInr(li.amount)}
                            </td>
                            <td>{li.taxCategory}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Impact Preview */}
                  {impactPreview && (
                    <div className="rounded-lg border border-border bg-secondary/40 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <Eye className="h-3.5 w-3.5 text-primary" />
                          Live Unit Impact Preview
                        </div>
                        <Select value={impactPreview.unit.id} onValueChange={setPreviewUnitId}>
                          <SelectTrigger className="h-7 w-44 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {units.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.unitNumber} ({u.saleableAreaSqft} sq.ft.)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3 text-xs pt-1">
                        <div>
                          Consideration Subtotal:{' '}
                          <strong>
                            {formatInr(impactPreview.breakdown.netAgreementValueBeforeGstInr)}
                          </strong>
                        </div>
                        <div>
                          Total GST: <strong>{formatInr(impactPreview.breakdown.totalGstInr)}</strong>
                        </div>
                        <div>
                          All-Inclusive Payable:{' '}
                          <strong className="text-primary">
                            {formatInr(impactPreview.breakdown.totalPayableInr)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Historical Price Progression Chart (Recharts) & Revision Table */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm">
                    Base Rate Progression & Unit Price Revisions ({revisions.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {versionChartData.length > 0 && (
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={versionChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="version" fontSize={12} />
                        <YAxis
                          fontSize={12}
                          tickFormatter={(v) => `₹${v}`}
                        />
                        <Tooltip
                          formatter={(val: number) => [formatInr(val), 'Base Rate / sq.ft.']}
                        />
                        <Line
                          type="monotone"
                          dataKey="baseRate"
                          stroke="#0F265C"
                          strokeWidth={2.5}
                          dot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <DataTable
                  data={revisions}
                  searchPlaceholder="Search revisions by unit..."
                  emptyMessage="No price revisions recorded yet. Revisions are logged automatically when a new price book version is activated."
                  columns={[
                    { accessorKey: 'unitNumber', header: 'Unit #' },
                    {
                      accessorKey: 'priceBookVersion',
                      header: 'Version',
                      cell: ({ row }) => `v${row.original.priceBookVersion}`,
                    },
                    {
                      accessorKey: 'oldTotalValue',
                      header: 'Previous Value',
                      cell: ({ row }) => formatInrCompact(row.original.oldTotalValue),
                    },
                    {
                      accessorKey: 'newTotalValue',
                      header: 'New Value',
                      cell: ({ row }) => formatInrCompact(row.original.newTotalValue),
                    },
                    {
                      accessorKey: 'changeAmount',
                      header: 'Delta',
                      cell: ({ row }) => {
                        const d = row.original.changeAmount;
                        return (
                          <span className={d >= 0 ? 'text-emerald-700 font-medium' : 'text-red-700'}>
                            {d >= 0 ? '+' : ''}
                            {formatInrCompact(d)} ({row.original.changePct}%)
                          </span>
                        );
                      },
                    },
                    { accessorKey: 'reason', header: 'Reason' },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Full Dynamic Price Book Editor Modal */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Draft Price Book' : 'Create Dynamic Price Book'}
            </DialogTitle>
            <DialogDescription>
              Customize numeric pricing rules and editable cost-sheet line-item labels. Approved
              versions become permanently immutable.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveDraft} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1 sm:col-span-2">
                <Label>Price Book Name *</Label>
                <Input required value={pbName} onChange={(e) => setPbName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Effective Date *</Label>
                <Input type="date" required value={pbEffective} onChange={(e) => setPbEffective(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Expiry Date</Label>
                <Input type="date" value={pbExpiry} onChange={(e) => setPbExpiry(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>Base Rate / sq.ft. (INR) *</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2 gap-1 text-primary border-primary/30 hover:bg-primary/5"
                    onClick={handleGeneratePricing}
                  >
                    <Sparkles className="h-3 w-3" />
                    Generate Pricing
                  </Button>
                </div>
                <Input type="number" required value={baseRate} onChange={(e) => setBaseRate(e.target.value)} />
                {selectedBaselineSource && (
                  <p className="text-[11px] text-emerald-600 font-medium">
                    ✓ From {selectedBaselineSource}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Floor Rise Start Floor</Label>
                <Input type="number" value={floorRiseStart} onChange={(e) => setFloorRiseStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Floor Rise / Floor / sq.ft.</Label>
                <Input type="number" value={floorRiseRate} onChange={(e) => setFloorRiseRate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Corner Premium / sq.ft.</Label>
                <Input type="number" value={cornerPremium} onChange={(e) => setCornerPremium(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>East Facing / sq.ft.</Label>
                <Input type="number" value={eastPremium} onChange={(e) => setEastPremium(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Park View / sq.ft.</Label>
                <Input type="number" value={parkViewPremium} onChange={(e) => setParkViewPremium(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Standard Parking (INR)</Label>
                <Input type="number" value={stdParkingPrice} onChange={(e) => setStdParkingPrice(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>EV Parking (INR)</Label>
                <Input type="number" value={evParkingPrice} onChange={(e) => setEvParkingPrice(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Agreement GST (%)</Label>
                <Input type="number" step="0.1" value={agreementGst} onChange={(e) => setAgreementGst(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Maintenance/Legal GST (%)</Label>
                <Input type="number" step="0.1" value={serviceGst} onChange={(e) => setServiceGst(e.target.value)} />
              </div>
              <div className="flex items-end pb-2 sm:col-span-2">
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={floorRiseEnabled} onCheckedChange={setFloorRiseEnabled} />
                  Enable Floor Rise
                </label>
              </div>
            </div>

            {/* Dedicated Discount Governance Section */}
            <div className="rounded-lg border border-border bg-muted/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Discount Governance & Delegation Policy
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Set clear boundary controls for executive approvals and sales negotiations.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 items-center">
                <div className="space-y-1">
                  <Label className="text-xs">Max Sales Auto-Discount (%) without Approval</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={50}
                    value={maxAutoDiscount}
                    onChange={(e) => setMaxAutoDiscount(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Sales reps can issue up to {maxAutoDiscount}% discount directly on cost sheets.
                  </p>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  <span className="font-semibold">Approval Guardrail:</span> Quotations exceeding {maxAutoDiscount}% discount automatically trigger a two-party Director / Commercial Head approval requirement before the PDF can be finalized or signed.
                </div>
              </div>
            </div>

            {/* Editable Cost-Sheet Line Items Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Editable Cost-Sheet Charges & Custom Labels
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addCustomChargeRow}>
                  <Plus className="h-3.5 w-3.5" />
                  Add Custom Charge
                </Button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto rounded-md border border-border p-3">
                {lineItems.map((li, idx) => (
                  <div
                    key={li.id}
                    className="grid gap-2 sm:grid-cols-12 items-center border-b border-border pb-2 last:border-0"
                  >
                    <div className="sm:col-span-4">
                      <Input
                        value={li.displayLabel}
                        onChange={(e) => updateLineItem(idx, { displayLabel: e.target.value })}
                        placeholder="Display Label on Quotation"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Select
                        value={li.basis}
                        onValueChange={(v: any) => updateLineItem(idx, { basis: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FIXED_AMOUNT">Fixed Amount (INR)</SelectItem>
                          <SelectItem value="PER_SQFT_SALEABLE">Per Sq. Ft. (Saleable)</SelectItem>
                          <SelectItem value="PER_SQFT_CARPET">Per Sq. Ft. (Carpet)</SelectItem>
                          <SelectItem value="PERCENTAGE_OF_BASE">% of Base Price</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        value={li.amount}
                        onChange={(e) => updateLineItem(idx, { amount: Number(e.target.value) })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Select
                        value={li.taxCategory}
                        onValueChange={(v: any) => updateLineItem(idx, { taxCategory: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AGREEMENT_GST">Agreement GST</SelectItem>
                          <SelectItem value="OTHER_SERVICE_GST">Service GST (18%)</SelectItem>
                          <SelectItem value="EXEMPT_CORPUS">Corpus (0% GST)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-1 flex items-center justify-end gap-1">
                      <Switch
                        checked={li.isVisible}
                        onCheckedChange={(v) => updateLineItem(idx, { isVisible: v })}
                      />
                      {li.isRemovable && (
                        <button
                          type="button"
                          onClick={() => removeLineItem(idx)}
                          className="text-destructive p-1 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Internal Pricing Notes</Label>
              <Input
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Internal governance notes (not printed on customer PDF)"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save Draft Price Book'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Flat Size Baseline Picker Dialog */}
      <Dialog open={flatSizePickerOpen} onOpenChange={setFlatSizePickerOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Generate Pricing from Inventory Baseline
            </DialogTitle>
            <DialogDescription>
              Select an inventory flat size. The base rate per sq.ft. configured during inventory upload will be populated as the Version 1 baseline for this Price Book.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {inventoryFlatSizes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No units found in project inventory.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {inventoryFlatSizes.map((item) => (
                  <div
                    key={`${item.unitType}_${item.bhk}_${item.saleableAreaSqft}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-sm">
                        {item.bhk} ({item.unitType})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.saleableAreaSqft.toLocaleString('en-IN')} sq.ft. primary | {item.carpetAreaSqft.toLocaleString('en-IN')} sq.ft. carpet | {item.unitsCount} units
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">v1 Base Rate</div>
                        <div className="text-base font-bold text-primary">
                          ₹{item.baseRatePerSqft.toLocaleString('en-IN')}<span className="text-xs font-normal">/sq.ft.</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleApplyFlatSizeRate(item)}
                      >
                        Take This Price
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlatSizePickerOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
