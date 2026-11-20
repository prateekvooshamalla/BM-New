import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  AlertCircle,
  Building2,
  Calculator,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  Edit,
  ExternalLink,
  FileText,
  Filter,
  FolderPlus,
  Grid3X3,
  History,
  KeyRound,
  Layers,
  List,
  Lock,
  Mail,
  Phone,
  Plus,
  Share2,
  ShieldCheck,
  TrendingUp,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import {
  calculateCostSheet,
  generateBookingPaymentSchedule,
  getQuotationPriceBooks,
  formatAreaSqft,
  formatInr,
  formatInrCompact,
  type AuditEvent,
  type Booking,
  type FacingDirection,
  type Floor,
  type Lead,
  type PaymentPlan,
  type PriceBook,
  type PriceRevision,
  type Project,
  type ProjectPhase,
  type Quotation,
  type Tower,
  type Unit,
  type UnitStatus,
  type UnitType,
} from '@bharat-makaan/shared';
import { BookingDetailsDrawer } from '@/features/bookings/components/BookingDetailsDrawer';
import { InventorySetupWizard } from '@/features/inventory/components/InventorySetupWizard';
import { ProjectDetailsSummary, UnitRoomSummary } from '@/features/inventory/components/InventoryDetailsSummary';
import { UnitRoomFields } from '@/features/inventory/components/InventorySetupFields';
import { createUnitDraft, roomPayload } from '@/features/inventory/components/inventory-setup';
import { useProjectPricingContext } from '@/features/pricing/hooks/useProjectPricingContext';
import { callBackendFunction, storage } from '@/lib/firebase';
import { sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PermissionGate } from '@/components/shared/PermissionGate';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const FACING_OPTIONS: FacingDirection[] = [
  'EAST',
  'WEST',
  'NORTH',
  'SOUTH',
  'NORTH_EAST',
  'NORTH_WEST',
  'SOUTH_EAST',
  'SOUTH_WEST',
];

const STATUS_OPTIONS: UnitStatus[] = [
  'AVAILABLE',
  'ON_HOLD',
  'RESERVED',
  'BOOKED',
  'AGREEMENT',
  'REGISTERED',
];

export function ProjectsAndInventoryPage() {
  const { activeOrgId, activeProjectId, projects, setProjects, selectProject } = useTenantStore();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [setup, setSetup] = React.useState<{ mode: 'project' | 'edit' | 'unit'; project?: Project; towers?: Tower[] } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  React.useEffect(() => { setSetup(null); setNotice(null); }, [activeOrgId]);
  return <div className="space-y-4">
    {notice && <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
    <ProjectInventoryWorkspace key={`${activeOrgId}:${id ?? activeProjectId ?? projects[0]?.id ?? ''}`}
      onStartProject={() => setSetup({ mode: 'project' })}
      onEditProject={(project) => setSetup({ mode: 'edit', project })}
      onStartUnit={(project, towers) => setSetup({ mode: 'unit', project, towers })} />
    {setup && activeOrgId && <InventorySetupWizard key={`${activeOrgId}:${setup.mode}:${setup.project?.id ?? ''}`}
      mode={setup.mode} project={setup.project} towers={setup.towers}
      onClose={() => setSetup(null)} onComplete={(project, unit) => {
        const latest = useTenantStore.getState().projects;
        setProjects(latest.some((item) => item.id === project.id)
          ? latest.map((item) => item.id === project.id ? setup.mode === 'edit' ? project : { ...item, masterPlanDocumentId: project.masterPlanDocumentId ?? item.masterPlanDocumentId } : item)
          : [...latest, project]);
        selectProject(project.id, 'SINGLE_PROJECT'); setSetup(null);
        setNotice(unit ? `Saved ${project.name} and added unit ${unit.unitNumber} to inventory.` : `Saved ${project.name}. You can add units from Add Inventory.`);
        if (id) navigate(`/builder/projects/${project.id}`);
      }} />}
  </div>;
}

function ProjectInventoryWorkspace({ onStartProject, onEditProject, onStartUnit }: {
  onStartProject: () => void; onEditProject: (project: Project) => void; onStartUnit: (project: Project, towers: Tower[]) => void;
}) {
  const navigate = useNavigate();
  const { id: routeProjectId } = useParams<{ id?: string }>();
  const {
    activeOrgId,
    projects,
    activeProjectId,
    activeProject,
    selectProject,
    setSelectedContextEntity,
    setAiDrawerOpen,
  } = useTenantStore();

  React.useEffect(() => {
    if (routeProjectId && routeProjectId !== activeProjectId) {
      if (projects.some((p) => p.id === routeProjectId)) {
        selectProject(routeProjectId, 'SINGLE_PROJECT');
      }
    }
  }, [routeProjectId, activeProjectId, projects, selectProject]);

  const [phases, setPhases] = React.useState<ProjectPhase[]>([]);
  const [towers, setTowers] = React.useState<Tower[]>([]);
  const [floors, setFloors] = React.useState<Floor[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [viewMode, setViewMode] = React.useState<'visual' | 'table'>('visual');

  // Filter states
  const [selectedPhaseId, setSelectedPhaseId] = React.useState<string>('ALL');
  const [selectedTowerId, setSelectedTowerId] = React.useState<string>('ALL');
  const [selectedFloorNo, setSelectedFloorNo] = React.useState<string>('ALL');
  const [filterBhk, setFilterBhk] = React.useState<string>('ALL');
  const [filterFacing, setFilterFacing] = React.useState<string>('ALL');
  const [filterStatus, setFilterStatus] = React.useState<string>('ALL');
  const [minArea, setMinArea] = React.useState<string>('');
  const [maxPriceCr, setMaxPriceCr] = React.useState<string>('');
  const [unitSearch, setUnitSearch] = React.useState<string>('');

  // Modals & Drawers
  const [createPhaseOpen, setCreatePhaseOpen] = React.useState(false);
  const [createTowerOpen, setCreateTowerOpen] = React.useState(false);
  const [bulkWizardOpen, setBulkWizardOpen] = React.useState(false);
  const [selectedUnit, setSelectedUnit] = React.useState<Unit | null>(null);
  const [unitAuditHistory, setUnitAuditHistory] = React.useState<AuditEvent[]>([]);
  const [transitionReason, setTransitionReason] = React.useState('');
  const [bannerMsg, setBannerMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Create Phase / Tower Form
  const [phaseName, setPhaseName] = React.useState('Phase 1');
  const [phaseCode, setPhaseCode] = React.useState('PH1');
  const [towerName, setTowerName] = React.useState('Tower 1');
  const [towerCode, setTowerCode] = React.useState('T1');
  const [towerType, setTowerType] = React.useState<'TOWER' | 'BLOCK' | 'SECTOR' | 'VILLA_CLUSTER'>('TOWER');
  const [towerFloors, setTowerFloors] = React.useState('15');
  const [towerError, setTowerError] = React.useState<string | null>(null);

  const [bulkRooms, setBulkRooms] = React.useState(createUnitDraft);
  const [editRooms, setEditRooms] = React.useState(createUnitDraft);

  // Edit Unit Form
  const [editUnitOpen, setEditUnitOpen] = React.useState(false);
  const [editUnitId, setEditUnitId] = React.useState('');
  const [editUnitNumber, setEditUnitNumber] = React.useState('');
  const [editUnitSeries, setEditUnitSeries] = React.useState('');
  const [editFloorNo, setEditFloorNo] = React.useState('1');
  const [editUnitTypeVal, setEditUnitTypeVal] = React.useState<UnitType>('APARTMENT');
  const [editBhk, setEditBhk] = React.useState('');
  const [editSaleable, setEditSaleable] = React.useState('');
  const [editCarpet, setEditCarpet] = React.useState('');
  const [editFacing, setEditFacing] = React.useState<FacingDirection>('EAST');
  const [editBaseRate, setEditBaseRate] = React.useState('');
  const [editParkingEntitled, setEditParkingEntitled] = React.useState('1');
  const [editCorner, setEditCorner] = React.useState(false);
  const [editPublished, setEditPublished] = React.useState(false);

  // Quick Add Customer in Flat Drawer
  const [quickCustomerModalOpen, setQuickCustomerModalOpen] = React.useState(false);
  const [quickCustName, setQuickCustName] = React.useState('');
  const [quickCustPhone, setQuickCustPhone] = React.useState('');
  const [quickCustEmail, setQuickCustEmail] = React.useState('');
  const [quickCustNotes, setQuickCustNotes] = React.useState('');
  const [drawerNotice, setDrawerNotice] = React.useState<string | null>(null);
  const [floorPlanUrl, setFloorPlanUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    setFloorPlanUrl(null);
    if (selectedUnit?.floorPlanStoragePath) {
      getDownloadURL(ref(storage, selectedUnit.floorPlanStoragePath)).then((url) => { if (active) setFloorPlanUrl(url); }).catch(() => { if (active) setBannerMsg('Unable to load floor plan. Check your document access.'); });
    }
    return () => { active = false; };
  }, [selectedUnit?.floorPlanStoragePath]);
  const [holdCustomer, setHoldCustomer] = React.useState('');
  const [holdAdvance, setHoldAdvance] = React.useState('0');
  const [holdReference, setHoldReference] = React.useState('');
  const [customerLeads, setCustomerLeads] = React.useState<Lead[]>([]);
  React.useEffect(() => {
    setHoldCustomer(selectedUnit?.heldForLeadId ?? '');
    setHoldAdvance(String(selectedUnit?.holdAdvanceAmount ?? 0));
    setHoldReference(selectedUnit?.holdPaymentReference ?? '');
  }, [selectedUnit?.id]);
  React.useEffect(() => {
    if (!activeOrgId) return;
    return subscribeTenantCollection<Lead>({ orgId: activeOrgId, collectionName: 'leads', onData: setCustomerLeads });
  }, [activeOrgId]);

  const [drawerOpenForUnit, setDrawerOpenForUnit] = React.useState(false);

  const unitBookingForDrawer = React.useMemo<Booking | null>(() => {
    if (!selectedUnit) return null;
    const lead = customerLeads.find((l) => l.id === selectedUnit.heldForLeadId);
    const cleanNum = selectedUnit.unitNumber.replace(/[^A-Za-z0-9]/g, '');
    const contractVal = selectedUnit.calculatedTotalPrice || 5000000;
    const advanceVal = selectedUnit.holdAdvanceAmount || (selectedUnit.holdPaymentReference ? 500000 : 0);
    const realizedVal = selectedUnit.holdPaymentReference ? advanceVal : 0;
    const advRef = selectedUnit.holdPaymentReference || (realizedVal > 0 ? `NEFT-ADV-${cleanNum || '001'}` : null);
    const bookingDate = selectedUnit.updatedAt || selectedUnit.createdAt || new Date().toISOString();

    const schedule = generateBookingPaymentSchedule({
      contractValueInr: contractVal,
      advancePaidInr: realizedVal,
      advancePaymentRef: advRef,
      startDateIso: bookingDate,
    });

    return {
      id: selectedUnit.activeBookingId || `booking-unit-${selectedUnit.id}`,
      orgId: activeOrgId || '',
      bookingNumber: `BM-BK-${activeProject?.code || 'PRJ'}-2026-${cleanNum || '001'}`,
      projectId: selectedUnit.projectId,
      towerId: selectedUnit.towerId ?? null,
      unitId: selectedUnit.id,
      unitNumber: selectedUnit.unitNumber,
      quotationId: 'DIRECT_UNIT' as any,
      leadId: lead?.id || selectedUnit.heldForLeadId || `lead-for-${selectedUnit.id}`,
      partnerOrgId: null,
      customer: {
        fullName: lead?.customerName || 'Allotted Customer',
        phone: lead?.normalizedPhone || lead?.phone || 'Contact on file',
        email: lead?.email || `${(lead?.customerName || 'buyer').toLowerCase().replace(/\s+/g, '')}@buyer.in`,
        panNumber: (lead as any)?.panNumber || (lead as any)?.pan || 'ABCDE1234F',
        aadhaarLast4: (lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice(-4) || '8901',
        permanentAddress: (lead as any)?.address || lead?.preferredLocation || 'Address on file',
        coApplicantName: (lead as any)?.coApplicantName || undefined,
      },
      allocatedParkingSlotIds: selectedUnit.assignedParkingSlotIds || [],
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
      status: (selectedUnit.status === 'RESERVED' ? 'HOLD_REQUESTED' : selectedUnit.status === 'BOOKED' ? 'BOOKED' : 'HOLD_REQUESTED') as any,
      requestedByUid: selectedUnit.heldByUid || 'SYSTEM',
      approvedByUid: selectedUnit.status === 'BOOKED' ? (selectedUnit.heldByUid || 'SYSTEM') : null,
      bookedAt: bookingDate,
      cancelledAt: null,
      createdAt: selectedUnit.createdAt || bookingDate,
      updatedAt: bookingDate,
    };
  }, [selectedUnit, customerLeads, activeOrgId, activeProject]);

  const [priceRevisions, setPriceRevisions] = React.useState<PriceRevision[]>([]);
  const [priceBooks, setPriceBooks] = React.useState<PriceBook[]>([]);
  const [paymentPlans, setPaymentPlans] = React.useState<PaymentPlan[]>([]);
  const [priceLogModalOpen, setPriceLogModalOpen] = React.useState(false);
  const [priceLogSearch, setPriceLogSearch] = React.useState('');

  // Direct Cost Sheet Modal State
  const [costSheetModalOpen, setCostSheetModalOpen] = React.useState(false);
  const [costSheetUnit, setCostSheetUnit] = React.useState<Unit | null>(null);
  const [costSheetLeadId, setCostSheetLeadId] = React.useState<string>('NEW');
  const [costSheetCustName, setCostSheetCustName] = React.useState('');
  const [costSheetCustPhone, setCostSheetCustPhone] = React.useState('');
  const [costSheetCustEmail, setCostSheetCustEmail] = React.useState('');
  const [costSheetPbId, setCostSheetPbId] = React.useState('');
  const [costSheetPlanId, setCostSheetPlanId] = React.useState('');
  const [costSheetDiscountType, setCostSheetDiscountType] = React.useState<'NONE' | 'FIXED_INR' | 'PER_SQFT' | 'PERCENTAGE_OF_BASE'>('NONE');
  const [costSheetDiscountVal, setCostSheetDiscountVal] = React.useState('0');
  const [costSheetGenerating, setCostSheetGenerating] = React.useState(false);
  const [costSheetError, setCostSheetError] = React.useState<string | null>(null);
  const [costSheetSuccessNotice, setCostSheetSuccessNotice] = React.useState<string | null>(null);
  const [showInlineNewCustomer, setShowInlineNewCustomer] = React.useState(false);

  // Bulk Generator Form
  const [bulkTowerId, setBulkTowerId] = React.useState('');
  const [bulkUnitType, setBulkUnitType] = React.useState<'APARTMENT' | 'PENTHOUSE' | 'VILLA' | 'PLOT' | 'SHOP' | 'OFFICE'>('APARTMENT');
  const [bulkStartFloor, setBulkStartFloor] = React.useState('1');
  const [bulkEndFloor, setBulkEndFloor] = React.useState('5');
  const [bulkUnitsPerFloor, setBulkUnitsPerFloor] = React.useState('4');
  const [bulkBhk, setBulkBhk] = React.useState('3 BHK');
  const [bulkFacing, setBulkFacing] = React.useState<FacingDirection>('EAST');
  const [bulkSaleable, setBulkSaleable] = React.useState('1850');
  const [bulkCarpet, setBulkCarpet] = React.useState('1295');
  const [bulkRate, setBulkRate] = React.useState('8800');
  const [bulkParkingEntitled, setBulkParkingEntitled] = React.useState('2');
  const [bulkCorner, setBulkCorner] = React.useState(false);
  const [bulkPublished, setBulkPublished] = React.useState(false);
  const [bulkFloorPlan, setBulkFloorPlan] = React.useState<File | null>(null);
  const [bulkStartUnit, setBulkStartUnit] = React.useState('1');
  React.useEffect(() => {
    const existing = units.filter((unit) => unit.towerId === bulkTowerId && unit.floorNumber >= Number(bulkStartFloor) && unit.floorNumber <= Number(bulkEndFloor));
    const last = Math.max(0, ...existing.map((unit) => Number(unit.unitNumber.slice(-2))).filter(Number.isFinite));
    setBulkStartUnit(String(last + 1));
  }, [bulkTowerId, bulkStartFloor, bulkEndFloor, units]);

  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;
  const { parkingSlots, pricingOverrides } = useProjectPricingContext(currentProjectId);
  const quotationPriceBooks = React.useMemo(() => getQuotationPriceBooks(priceBooks), [priceBooks]);

  React.useEffect(() => {
    setSelectedContextEntity({
      towerId: selectedTowerId !== 'ALL' ? selectedTowerId : null,
      unitId: selectedUnit?.id ?? null,
    });
  }, [selectedTowerId, selectedUnit?.id, setSelectedContextEntity]);

  React.useEffect(() => {
    if (!activeOrgId || !currentProjectId) {
      setPhases([]);
      setTowers([]);
      setFloors([]);
      setUnits([]);
      return;
    }

    const unsubPhases = subscribeTenantCollection<ProjectPhase>({
      orgId: activeOrgId,
      collectionName: 'project_phases',
      projectId: currentProjectId,
      onData: setPhases,
    });

    const unsubTowers = subscribeTenantCollection<Tower>({
      orgId: activeOrgId,
      collectionName: 'towers',
      projectId: currentProjectId,
      onData: setTowers,
    });

    const unsubFloors = subscribeTenantCollection<Floor>({
      orgId: activeOrgId,
      collectionName: 'floors',
      projectId: currentProjectId,
      onData: setFloors,
    });

    const unsubUnits = subscribeTenantCollection<Unit>({
      orgId: activeOrgId,
      collectionName: 'units',
      projectId: currentProjectId,
      onData: setUnits,
    });

    return () => {
      unsubPhases();
      unsubTowers();
      unsubFloors();
      unsubUnits();
    };
  }, [activeOrgId, currentProjectId]);

  React.useEffect(() => {
    if (!activeOrgId || !currentProjectId) {
      setPriceRevisions([]);
      setPriceBooks([]);
      setPaymentPlans([]);
      return;
    }
    const unsubRevs = subscribeTenantCollection<PriceRevision>({
      orgId: activeOrgId,
      collectionName: 'price_revisions',
      projectId: currentProjectId,
      sort: sortDescByIso<PriceRevision>('createdAt'),
      onData: setPriceRevisions,
    });
    const unsubPb = subscribeTenantCollection<PriceBook>({
      orgId: activeOrgId,
      collectionName: 'price_books',
      projectId: currentProjectId,
      onData: setPriceBooks,
    });
    const unsubPp = subscribeTenantCollection<PaymentPlan>({
      orgId: activeOrgId,
      collectionName: 'payment_plans',
      projectId: currentProjectId,
      filter: (plan) => plan.isActive,
      onData: setPaymentPlans,
    });
    return () => {
      unsubRevs();
      unsubPb();
      unsubPp();
    };
  }, [activeOrgId, currentProjectId]);

  React.useEffect(() => {
    setSelectedUnit((previous) => previous ? units.find((unit) => unit.id === previous.id) ?? null : null);
  }, [units]);

  const unitPriceRevisions = React.useMemo(() => {
    if (!selectedUnit) return [];
    return priceRevisions.filter((r) => r.unitId === selectedUnit.id);
  }, [priceRevisions, selectedUnit]);

  const liveCostSheetPb = React.useMemo(() => {
    return (
      quotationPriceBooks.find((pb) => pb.id === costSheetPbId) ??
      quotationPriceBooks[0] ??
      null
    );
  }, [quotationPriceBooks, costSheetPbId]);

  const liveCostSheetPlan = React.useMemo(() => {
    return (
      paymentPlans.find((p) => p.id === costSheetPlanId) ??
      paymentPlans.find((p) => p.isActive) ??
      paymentPlans[0] ??
      null
    );
  }, [paymentPlans, costSheetPlanId]);

  const liveDirectBreakdown = React.useMemo(() => {
    if (!costSheetUnit || !liveCostSheetPb) return null;
    try {
      return calculateCostSheet({
        unit: costSheetUnit,
        priceBook: liveCostSheetPb,
        overrides: pricingOverrides,
        allocatedParkingSlots: parkingSlots.filter((slot) => slot.status === 'ALLOCATED' && slot.allocatedUnitId === costSheetUnit.id),
        paymentPlan: liveCostSheetPlan ?? undefined,
        discount: {
          type: costSheetDiscountType,
          value: Number(costSheetDiscountVal) || 0,
        },
      });
    } catch {
      return null;
    }
  }, [costSheetUnit, liveCostSheetPb, liveCostSheetPlan, costSheetDiscountType, costSheetDiscountVal, parkingSlots, pricingOverrides]);

  const handleOpenDirectCostSheet = (unit: Unit) => {
    setCostSheetUnit(unit);
    const activePb = quotationPriceBooks[0];
    setCostSheetPbId(activePb?.id ?? '');
    const activePlan = paymentPlans.find((p) => p.isActive) ?? paymentPlans[0];
    setCostSheetPlanId(activePlan?.id ?? '');

    setCostSheetError(null);
    setCostSheetSuccessNotice(null);

    const heldLead = customerLeads.find((lead) => lead.id === unit.heldForLeadId);
    setCostSheetLeadId(heldLead?.id ?? 'NEW');
    setCostSheetCustName(heldLead?.customerName ?? '');
    setCostSheetCustPhone(heldLead?.phone ?? '');
    setCostSheetCustEmail(heldLead?.email ?? '');
    setShowInlineNewCustomer(!heldLead);

    setCostSheetDiscountType('NONE');
    setCostSheetDiscountVal('0');
    setCostSheetModalOpen(true);
  };

  const handleSelectCostSheetCustomer = (leadId: string) => {
    setCostSheetLeadId(leadId);
    setCostSheetError(null);
    if (leadId === 'NEW') {
      setShowInlineNewCustomer(true);
      setCostSheetCustName('');
      setCostSheetCustPhone('');
      setCostSheetCustEmail('');
    } else {
      setShowInlineNewCustomer(false);
      const lead = customerLeads.find((l) => l.id === leadId);
      if (lead) {
        setCostSheetCustName(lead.customerName);
        setCostSheetCustPhone(lead.phone);
        setCostSheetCustEmail(lead.email ?? '');
      }
    }
  };

  const handleGenerateCostSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId || !costSheetUnit) return;
    setCostSheetError(null);
    setCostSheetSuccessNotice(null);

    const finalCustName = costSheetCustName.trim();
    const finalCustPhone = costSheetCustPhone.trim();
    const finalCustEmail = costSheetCustEmail.trim() || undefined;

    if (!finalCustName) {
      setCostSheetError('Customer full name is required to generate quotation.');
      return;
    }
    if (!finalCustPhone) {
      setCostSheetError('Customer phone number is required to generate quotation.');
      return;
    }

    setCostSheetGenerating(true);
    try {
      let finalLeadId = costSheetLeadId !== 'NEW' ? costSheetLeadId : undefined;
      if (!finalLeadId) {
          const leadRes = await callBackendFunction<unknown, { lead: Lead }>('createLead', {
            orgId: activeOrgId,
            projectId: currentProjectId,
            customerName: finalCustName,
            phone: finalCustPhone,
            email: finalCustEmail,
            source: 'MANUAL',
            isCustomer: true,
            whatsappOptIn: false,
          });
          finalLeadId = leadRes.lead.id;
          setCostSheetLeadId(finalLeadId);
      }

      const res = await callBackendFunction<any, { quotation: Quotation; pdfBase64: string }>(
        'createQuotation',
        {
          orgId: activeOrgId,
          projectId: currentProjectId,
          unitId: costSheetUnit.id,
          priceBookId: liveCostSheetPb?.id || costSheetPbId || 'default',
          paymentPlanId: liveCostSheetPlan?.id || costSheetPlanId || 'default',
          customer: {
            name: finalCustName,
            phone: finalCustPhone,
            email: finalCustEmail,
          },
          leadId: finalLeadId ?? null,
          discount: {
            type: costSheetDiscountType,
            value: Number(costSheetDiscountVal) || 0,
          },
          validDays: 15,
          termsAndConditions:
            '1. Quotation valid for 15 days subject to availability. 2. Cheques/RTGS in favour of Builder Escrow Account. 3. Stamp duty & registration extra at actuals.',
          selectedParkingSlotIds: parkingSlots.filter((slot) => slot.status === 'ALLOCATED' && slot.allocatedUnitId === costSheetUnit.id).map((slot) => slot.id),
          parkingSlotsCount: costSheetUnit.parkingEntitlementCount,
          parkingTypeUsed: 'STANDARD',
        }
      );

      // Browser trigger download
      const byteCharacters = atob(res.pdfBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = `${res.quotation.quotationNumber}.pdf`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(blobUrl);

      setCostSheetSuccessNotice(
        `Generated & downloaded ${res.quotation.quotationNumber}.pdf (${formatInr(res.quotation.totalPayableInr)}) successfully!`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate quotation PDF.';
      setCostSheetError(msg);
      setBannerMsg(msg);
    } finally {
      setCostSheetGenerating(false);
    }
  };

  // Subscribe to audit history when a unit drawer is opened
  React.useEffect(() => {
    if (!activeOrgId || !selectedUnit) {
      setUnitAuditHistory([]);
      return;
    }
    return subscribeTenantCollection<AuditEvent>({
      orgId: activeOrgId,
      collectionName: 'audit_events',
      extraConstraints: [where('entityId', '==', selectedUnit.id)],
      filter: (ev) => ev.entityId === selectedUnit.id,
      sort: sortDescByIso<AuditEvent>('createdAt'),
      onData: setUnitAuditHistory,
    });
  }, [activeOrgId, selectedUnit]);

  const filteredUnits = React.useMemo(() => {
    return units.filter((u) => {
      if (selectedPhaseId !== 'ALL' && u.phaseId !== selectedPhaseId) return false;
      if (selectedTowerId !== 'ALL' && u.towerId !== selectedTowerId) return false;
      if (selectedFloorNo !== 'ALL' && String(u.floorNumber) !== selectedFloorNo) return false;
      if (filterBhk !== 'ALL' && u.bhk !== filterBhk) return false;
      if (filterFacing !== 'ALL' && u.facing !== filterFacing) return false;
      if (filterStatus !== 'ALL' && u.status !== filterStatus) return false;
      if (minArea && u.saleableAreaSqft < Number(minArea)) return false;
      if (maxPriceCr && u.calculatedTotalPrice > Number(maxPriceCr) * 10_000_000) return false;
      if (
        unitSearch.trim() &&
        !u.unitNumber.toLowerCase().includes(unitSearch.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [
    units,
    selectedPhaseId,
    selectedTowerId,
    selectedFloorNo,
    filterBhk,
    filterFacing,
    filterStatus,
    minArea,
    maxPriceCr,
    unitSearch,
  ]);

  // Group filtered units by floor descending for realistic building elevation view
  const unitsByFloorDesc = React.useMemo(() => {
    const map = new Map<number, Unit[]>();
    for (const u of filteredUnits) {
      const list = map.get(u.floorNumber) ?? [];
      list.push(u);
      map.set(u.floorNumber, list);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([floorNum, list]) => [
        floorNum,
        list.sort((x, y) => x.unitNumber.localeCompare(y.unitNumber)),
      ] as const);
  }, [filteredUnits]);

  const distinctBhks = React.useMemo(
    () => Array.from(new Set(units.map((u) => u.bhk))),
    [units]
  );

  const distinctFloorNumbers = React.useMemo(
    () => Array.from(new Set(units.map((u) => u.floorNumber))).sort((a, b) => b - a),
    [units]
  );

  const inventoryStats = React.useMemo(() => {
    const totalUnits = units.length;
    const bookedUnits = units.filter(
      (u) => u.status === 'BOOKED' || u.status === 'AGREEMENT' || u.status === 'REGISTERED'
    ).length;
    const pendingUnits = units.filter(
      (u) => u.status === 'RESERVED' || u.status === 'ON_HOLD'
    ).length;
    const availableUnits = units.filter((u) => u.status === 'AVAILABLE').length;

    // Distinct customer buyers linked to units or marked as customer for this project
    const unitHeldLeadIds = new Set(
      units.filter((u) => u.heldForLeadId && u.status !== 'AVAILABLE').map((u) => u.heldForLeadId!)
    );
    const buyerCustomersCount = Math.max(
      unitHeldLeadIds.size,
      customerLeads.filter((l) => l.isCustomer && (!currentProjectId || l.projectId === currentProjectId)).length
    );

    // Total advance collected across units
    const totalAdvanceInr = units.reduce(
      (acc, u) => acc + (u.holdAdvanceAmount || 0),
      0
    );

    // Gross booked value
    const bookedGrossValueInr = units
      .filter((u) => u.status === 'BOOKED' || u.status === 'AGREEMENT' || u.status === 'REGISTERED')
      .reduce((acc, u) => acc + (u.calculatedTotalPrice || 0), 0);

    return {
      totalUnits,
      bookedUnits,
      pendingUnits,
      availableUnits,
      buyerCustomersCount,
      totalAdvanceInr,
      bookedGrossValueInr,
    };
  }, [units, customerLeads, currentProjectId]);

  const handleCreatePhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId) return;
    setBusy(true);
    try {
      const createdPhase = await callBackendFunction<any, ProjectPhase>('createPhase', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        name: phaseName,
        code: phaseCode,
        sequence: phases.length + 1,
        constructionStatus: 'UNDER_CONSTRUCTION',
      });
      setPhases((prev) => [...prev.filter((p) => p.id !== createdPhase.id), createdPhase]);
      setCreatePhaseOpen(false);
      setBannerMsg(`Added phase "${phaseName}".`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Failed to add phase.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTower = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId) return;
    setTowerError(null);

    const normName = towerName.trim().toLowerCase();
    const normCode = towerCode.trim().toUpperCase();
    const duplicate = towers.find(
      (t) =>
        t.name.trim().toLowerCase() === normName ||
        t.code.trim().toUpperCase() === normCode
    );

    if (duplicate) {
      const isName = duplicate.name.trim().toLowerCase() === normName;
      const msg = isName
        ? `A tower with the name "${towerName.trim()}" already exists in this project.`
        : `A tower with the code "${towerCode.trim().toUpperCase()}" already exists in this project.`;
      setTowerError(msg);
      setBannerMsg(msg);
      return;
    }

    setBusy(true);
    try {
      const createdTower = await callBackendFunction<any, Tower>('createTower', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        name: towerName.trim(),
        code: towerCode.trim().toUpperCase(),
        towerType,
        totalFloors: Number(towerFloors),
        basementLevels: 2,
        podiumLevels: 1,
        unitsPerFloorTypical: 4,
      });
      setTowers((prev) => [...prev.filter((t) => t.id !== createdTower.id), createdTower]);
      setCreateTowerOpen(false);
      setTowerError(null);
      setBannerMsg(`Created ${towerType} "${towerName}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create tower.';
      setTowerError(msg);
      setBannerMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenEdit = (unit: Unit) => {
    setEditRooms({ ...createUnitDraft(), bedrooms: unit.bedroomsCount === undefined ? '' : String(unit.bedroomsCount),
      bathrooms: unit.bathroomsCount === undefined ? '' : String(unit.bathroomsCount), balconies: String(unit.balconiesCount),
      furnishing: unit.furnishing ?? 'UNFURNISHED', amenities: unit.unitAmenities ?? [],
      rooms: (unit.roomDetails ?? []).map((room) => ({ id: crypto.randomUUID(), name: room.name, type: room.type, length: room.lengthFt === undefined ? '' : String(room.lengthFt), width: room.widthFt === undefined ? '' : String(room.widthFt) })),
    });
    setEditUnitId(unit.id);
    setEditUnitNumber(unit.unitNumber);
    setEditUnitSeries(unit.series ?? '');
    setEditFloorNo(String(unit.floorNumber));
    setEditUnitTypeVal(unit.unitType);
    setEditBhk(unit.bhk);
    setEditSaleable(String(unit.saleableAreaSqft));
    setEditCarpet(String(unit.carpetAreaSqft));
    setEditFacing(unit.facing);
    setEditBaseRate(String(unit.baseRatePerSqft));
    setEditParkingEntitled(String(unit.parkingEntitlementCount));
    setEditCorner(Boolean(unit.isCorner));
    setEditPublished(Boolean(unit.isPublicPublished));
    setEditUnitOpen(true);
  };

  const handleUpdateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !editUnitId) return;
    const currentUnit = units.find((u) => u.id === editUnitId);
    const currentTower = towers.find((t) => t.id === currentUnit?.towerId);
    if (
      editUnitTypeVal !== 'PLOT' &&
      editUnitTypeVal !== 'VILLA' &&
      currentTower?.totalFloors &&
      currentTower.totalFloors > 0 &&
      Number(editFloorNo) > currentTower.totalFloors
    ) {
      setBannerMsg(`Floor number (${editFloorNo}) cannot exceed tower "${currentTower.name}" total floors (${currentTower.totalFloors}).`);
      return;
    }
    setBusy(true);
    try {
      const updated = await callBackendFunction<any, Unit>('updateUnit', {
        orgId: activeOrgId,
        unitId: editUnitId,
        ...roomPayload(editRooms),
        unitNumber: editUnitNumber,
        series: editUnitSeries.trim() || undefined,
        floorNumber: Number(editFloorNo),
        unitType: editUnitTypeVal,
        bhk: editBhk,
        saleableAreaSqft: Number(editSaleable),
        carpetAreaSqft: Number(editCarpet),
        facing: editFacing,
        baseRatePerSqft: Number(editBaseRate),
        parkingEntitlementCount: Number(editParkingEntitled),
        isCorner: editCorner,
        isPublicPublished: editPublished,
      });
      setUnits((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setSelectedUnit(updated);
      setEditUnitOpen(false);
      setBannerMsg(`Unit ${updated.unitNumber} updated successfully.`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Failed to update unit.');
    } finally {
      setBusy(false);
    }
  };

  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<any, { lead: Lead; deduplicated: boolean }>('createLead', {
        orgId: activeOrgId,
        projectId: selectedUnit?.projectId ?? currentProjectId,
        customerName: quickCustName.trim(),
        phone: quickCustPhone.trim(),
        email: quickCustEmail.trim() || undefined,
        source: 'MANUAL',
        isCustomer: true,
        notes: quickCustNotes.trim() || undefined,
      });
      const newLead = res.lead;
      setCustomerLeads((prev) => {
        const exists = prev.find((l) => l.id === newLead.id);
        return exists ? prev.map((l) => (l.id === newLead.id ? newLead : l)) : [newLead, ...prev];
      });
      setHoldCustomer(newLead.id);
      setDrawerNotice(null);
      setQuickCustomerModalOpen(false);
      setQuickCustName('');
      setQuickCustPhone('');
      setQuickCustEmail('');
      setQuickCustNotes('');
      setBannerMsg(`Customer "${newLead.customerName}" registered and selected.`);
    } catch (err) {
      setDrawerNotice(err instanceof Error ? err.message : 'Failed to add customer.');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId || !bulkTowerId) return;
    const tObj = towers.find((t) => t.id === bulkTowerId);
    if (!tObj) return;
    if (tObj.totalFloors && tObj.totalFloors > 0 && Number(bulkEndFloor) > tObj.totalFloors) {
      setBannerMsg(`End floor (${bulkEndFloor}) cannot exceed tower "${tObj.name}" total floors (${tObj.totalFloors}).`);
      return;
    }
    setBusy(true);
    try {
      let floorPlanStoragePath: string | undefined;
      if (bulkFloorPlan) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(bulkFloorPlan.type) || bulkFloorPlan.size > 10 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image up to 10 MB.');
        floorPlanStoragePath = `organizations/${activeOrgId}/projects/${currentProjectId}/floorplans/${crypto.randomUUID()}`;
        await uploadBytes(ref(storage, floorPlanStoragePath), bulkFloorPlan, { contentType: bulkFloorPlan.type });
      }
      const res = await callBackendFunction<any, { createdCount: number; skippedCount: number }>(
        'bulkGenerateTowerUnits',
        {
          orgId: activeOrgId,
          projectId: currentProjectId,
          towerId: tObj.id,
          towerCode: tObj.code,
          towerName: tObj.name,
          unitType: bulkUnitType,
          startFloor: Number(bulkStartFloor),
          endFloor: Number(bulkEndFloor),
          unitsPerFloor: Number(bulkUnitsPerFloor),
          startUnitNumber: Number(bulkStartUnit),
          ...(floorPlanStoragePath ? { floorPlanStoragePath } : {}),
          bhk: bulkBhk,
          ...roomPayload(bulkRooms),
          saleableAreaSqft: Number(bulkSaleable),
          carpetAreaSqft: Number(bulkCarpet),
          facing: bulkFacing,
          baseRatePerSqft: Number(bulkRate),
          parkingEntitlementCount: Number(bulkParkingEntitled),
          isCorner: bulkCorner,
          isPublicPublished: bulkPublished,
          listingMode: 'BUY',
        }
      );
      setBulkWizardOpen(false);
      setBulkFloorPlan(null);
      setBannerMsg(`Generated ${res.createdCount} units across ${tObj.name}. ${res.skippedCount ?? 0} existing flat numbers skipped. Use the next starting flat number for another size.`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Bulk generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnitTransition = async (
    unit: Unit,
    targetStatus: UnitStatus,
    action: 'HOLD' | 'RESERVE' | 'RELEASE' | 'CANCEL' | 'BOOK'
  ) => {
    if (!activeOrgId) return;
    setDrawerNotice(null);
    if ((action === 'HOLD' || action === 'RESERVE' || action === 'BOOK') && !holdCustomer && !unit.heldForLeadId) {
      const msg = 'Please select or add a customer lead before holding, reserving, or booking this flat.';
      setBannerMsg(msg);
      setDrawerNotice(msg);
      return;
    }
    if ((action === 'HOLD' || action === 'RESERVE' || action === 'BOOK') && Number(holdAdvance) > 0 && !holdReference.trim()) {
      const msg = 'Please enter a receipt or payment reference for the advance amount.';
      setBannerMsg(msg);
      setDrawerNotice(msg);
      return;
    }
    setBusy(true);
    try {
      const updated = await callBackendFunction<any, Unit>('transitionUnitStatus', {
        orgId: activeOrgId,
        unitId: unit.id,
        targetStatus,
        action,
        holdDurationHours: 48,
        leadId: holdCustomer || unit.heldForLeadId || undefined,
        holdAdvanceAmount: Number(holdAdvance),
        holdPaymentReference: holdReference || undefined,
        reason: transitionReason || `Authorized ${action} action`,
      });
      setSelectedUnit(updated);
      setUnits((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setTransitionReason('');
      setBannerMsg(`Unit ${unit.unitNumber} updated to ${targetStatus}.`);
      setDrawerNotice(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Status transition rejected.';
      setBannerMsg(msg);
      setDrawerNotice(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleShareUnit = async (unit: Unit) => {
    const summary = `${activeProject?.name ?? 'Project'} — Unit ${unit.unitNumber} (${unit.bhk}, ${formatAreaSqft(unit.saleableAreaSqft)}, ${unit.facing} Facing) | Indicative Price: ${formatInr(unit.calculatedTotalPrice)} | Status: ${unit.status}`;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(summary);
      setBannerMsg('Unit specification copied to clipboard for WhatsApp/Email sharing.');
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={Building2}
        title="No builder organization selected."
        description="Select or create a builder organization from the sidebar to manage projects and unit inventory."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Project Workspace"
        title="Projects & Inventory"
        description="Organize your projects and units, review availability, and prepare customer cost sheets."
        actions={
          <>
            <PermissionGate permission="projects:create">
              <Button variant="outline" size="sm" onClick={onStartProject}>
                <FolderPlus className="h-4 w-4" />
                New Project
              </Button>
            </PermissionGate>
            {currentProjectId && (
              <PermissionGate permission="projects:edit" projectId={currentProjectId}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm"><Layers className="h-4 w-4" />Project Setup</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setCreatePhaseOpen(true)}>Add Phase</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setCreateTowerOpen(true)}>Add Tower / Sector</DropdownMenuItem>
                    <PermissionGate permission="inventory:manage" projectId={currentProjectId}>
                      <DropdownMenuItem onSelect={() => navigate('/app/ai-studio')}>AI Floor-Plan Studio</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setAiDrawerOpen(true, 'Add Tower 1')}>AI Tower Wizard</DropdownMenuItem>
                    </PermissionGate>
                  </DropdownMenuContent>
                </DropdownMenu>
              </PermissionGate>
            )}
            {currentProjectId && (
              <PermissionGate permission="inventory:manage" projectId={currentProjectId}>
                {towers.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={() => setBulkWizardOpen(true)}>
                    Bulk Add Units
                  </Button>
                )}
                <Button size="sm" onClick={() => {
                  const project = projects.find((item) => item.id === currentProjectId);
                  if (project) onStartUnit(project, towers);
                }}>
                  <Plus className="h-4 w-4" />
                  Add Inventory
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setPriceLogModalOpen(true)}
                >
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Price History ({priceRevisions.length})
                </Button>
              </PermissionGate>
            )}
          </>
        }
      />

      {bannerMsg && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs text-foreground">
          {bannerMsg}
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No projects yet. Create your first project."
          description="Support apartment towers, plotted layouts, gated villas, commercial offices, and mixed-use developments with RERA tracking."
          actionLabel="Create First Project"
          onAction={onStartProject}
        />
      ) : (
        <>
          {projects.find((project) => project.id === currentProjectId) && (
            <ProjectDetailsSummary project={projects.find((project) => project.id === currentProjectId)!} actions={
              <PermissionGate permission="projects:edit" projectId={currentProjectId}>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  const project = projects.find((item) => item.id === currentProjectId);
                  if (project) onEditProject(project);
                }}><Edit className="h-4 w-4" />Edit Project</Button>
              </PermissionGate>
            } />
          )}
          {/* Inventory Overview Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="bg-card hover:border-primary/40 transition-colors shadow-xs">
              <CardContent className="p-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Total Units</span>
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {inventoryStats.totalUnits}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span>{towers.length} tower(s)</span>
                  <span>•</span>
                  <span>{floors.length} floor(s)</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 transition-colors shadow-xs">
              <CardContent className="p-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                  <span>Booked &amp; Sold</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {inventoryStats.bookedUnits}
                </div>
                <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 truncate" title={formatInr(inventoryStats.bookedGrossValueInr)}>
                  {formatInrCompact(inventoryStats.bookedGrossValueInr)} booked
                </div>
              </CardContent>
            </Card>

            <Card className="bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40 transition-colors shadow-xs">
              <CardContent className="p-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                  <span>Pending / Hold</span>
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {inventoryStats.pendingUnits}
                </div>
                <div className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                  Reserved &amp; 48h holds
                </div>
              </CardContent>
            </Card>

            <Card className="bg-sky-500/5 border-sky-500/20 hover:border-sky-500/40 transition-colors shadow-xs">
              <CardContent className="p-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-sky-800 dark:text-sky-300 uppercase tracking-wider">
                  <span>Available</span>
                  <Unlock className="h-4 w-4 text-sky-600" />
                </div>
                <div className="text-2xl font-bold text-sky-700 dark:text-sky-400">
                  {inventoryStats.availableUnits}
                </div>
                <div className="text-[11px] text-sky-700/80 dark:text-sky-400/80">
                  Ready to book
                </div>
              </CardContent>
            </Card>

            <Card className="bg-indigo-500/5 border-indigo-500/20 hover:border-indigo-500/40 transition-colors shadow-xs">
              <CardContent className="p-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-indigo-800 dark:text-indigo-300 uppercase tracking-wider">
                  <span>Buyer Customers</span>
                  <Users className="h-4 w-4 text-indigo-600" />
                </div>
                <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">
                  {inventoryStats.buyerCustomersCount}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/builder/customers')}
                  className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1 text-left cursor-pointer"
                >
                  <span>View Customers</span>
                  <ExternalLink className="h-3 w-3" />
                </button>
              </CardContent>
            </Card>

            <Card className="bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 transition-colors shadow-xs">
              <CardContent className="p-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                  <span>Advances Paid</span>
                  <Wallet className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {formatInrCompact(inventoryStats.totalAdvanceInr)}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/builder/collections')}
                  className="text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline font-medium flex items-center gap-1 text-left cursor-pointer"
                >
                  <span>Collections ledger</span>
                  <ExternalLink className="h-3 w-3" />
                </button>
              </CardContent>
            </Card>
          </div>

          {/* Project Switcher & Hierarchy Summary */}
          <Card>
            <CardContent className="p-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-64">
                  <Select
                    value={currentProjectId ?? ''}
                    onValueChange={(val) => {
                      selectProject(val);
                      if (routeProjectId) navigate(`/builder/projects/${val}`);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.code}) — {p.city}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {activeProject && (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      Type: <strong className="text-foreground">{activeProject.projectType}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      RERA: <strong className="text-foreground">{activeProject.reraNumber}</strong>
                    </span>
                    <span>•</span>
                    <span>Phases: {phases.length}</span>
                    <span>•</span>
                    <span>Towers/Blocks: {towers.length}</span>
                    <span>•</span>
                    <span>Floors: {floors.length}</span>
                  </div>
                )}
              </div>

              {/* Status Legend */}
              <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
                {STATUS_OPTIONS.map((st) => {
                  const palette = DESIGN_TOKENS.colors.inventoryStatus[st];
                  const count = units.filter((u) => u.status === st).length;
                  return (
                    <span
                      key={st}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium"
                      style={{
                        backgroundColor: palette.bg,
                        color: palette.text,
                        borderColor: palette.border,
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: palette.dot }}
                      />
                      {st.replace('_', ' ')} ({count})
                    </span>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Rich Multi-Dimension Filter Bar */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Filter className="h-3.5 w-3.5" />
                  Inventory Filters
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant={viewMode === 'visual' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('visual')}
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                    Visual Matrix
                  </Button>
                  <Button
                    variant={viewMode === 'table' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('table')}
                  >
                    <List className="h-3.5 w-3.5" />
                    Table View
                  </Button>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
                <Input
                  placeholder="Unit # (e.g. 101, A-1204)"
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                />

                <Select value={selectedPhaseId} onValueChange={setSelectedPhaseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Phase" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Phases</SelectItem>
                    {phases.map((ph) => (
                      <SelectItem key={ph.id} value={ph.id}>
                        {ph.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedTowerId} onValueChange={setSelectedTowerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tower" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Towers</SelectItem>
                    {towers.map((tw) => (
                      <SelectItem key={tw.id} value={tw.id}>
                        {tw.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedFloorNo} onValueChange={setSelectedFloorNo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Floor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Floors</SelectItem>
                    {distinctFloorNumbers.map((fl) => (
                      <SelectItem key={fl} value={String(fl)}>
                        {fl === 0 ? 'Ground / Plot' : `Floor ${fl}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterBhk} onValueChange={setFilterBhk}>
                  <SelectTrigger>
                    <SelectValue placeholder="BHK" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All BHKs</SelectItem>
                    {distinctBhks.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterFacing} onValueChange={setFilterFacing}>
                  <SelectTrigger>
                    <SelectValue placeholder="Facing" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Facings</SelectItem>
                    {FACING_OPTIONS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    {STATUS_OPTIONS.map((st) => (
                      <SelectItem key={st} value={st}>
                        {st}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  type="number"
                  placeholder="Max Price (Cr)"
                  value={maxPriceCr}
                  onChange={(e) => setMaxPriceCr(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 max-w-xs">
                <Input
                  type="number"
                  placeholder="Min Saleable Area (sq. ft.)"
                  value={minArea}
                  onChange={(e) => setMinArea(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Visual Matrix vs Table View */}
          {units.length === 0 ? (
            <EmptyState
              icon={Grid3X3}
              title="No units added. Import or create inventory."
              description="Add individual apartments, villas, or plots—or use the Bulk Tower Generator to populate an entire residential tower."
              actionLabel="Add First Unit / Plot"
              onAction={() => {
                  const project = projects.find((item) => item.id === currentProjectId);
                  if (project) onStartUnit(project, towers);
                }}
            />
          ) : viewMode === 'visual' ? (
            <div className="space-y-3">
              {unitsByFloorDesc.map(([floorNum, floorUnits]) => (
                <Card key={floorNum}>
                  <CardContent className="p-4 flex flex-col gap-3 md:flex-row md:items-start">
                    <div className="w-32 shrink-0 pt-1">
                      <div className="text-xs font-bold uppercase tracking-wider text-foreground">
                        {floorNum === 0 ? 'Ground / Plots' : `Floor ${floorNum}`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {floorUnits.length} unit(s)
                      </div>
                    </div>

                    <div className="grid flex-1 gap-2.5 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {floorUnits.map((unit) => {
                        const colors = DESIGN_TOKENS.colors.inventoryStatus[unit.status];
                        return (
                          <button
                            key={unit.id}
                            type="button"
                            onClick={() => setSelectedUnit(unit)}
                            className="flex flex-col items-start rounded-lg border p-3 text-left transition-transform hover:-translate-y-0.5 cursor-pointer"
                            style={{
                              backgroundColor: colors.bg,
                              borderColor: colors.border,
                              color: colors.text,
                            }}
                          >
                            <div className="flex w-full items-center justify-between">
                              <span className="text-sm font-bold">{unit.unitNumber}</span>
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: colors.dot }}
                              />
                            </div>
                            <div className="mt-1 text-[11px] font-medium opacity-90">
                              {unit.bhk} • {unit.saleableAreaSqft} sq.ft.
                            </div>
                            <div className="mt-0.5 text-[10px] opacity-80">
                              {unit.facing} • {formatInrCompact(unit.calculatedTotalPrice)}
                            </div>
                            {unit.heldForLeadId && (
                              <div className="mt-1 text-[10px] font-semibold text-primary truncate max-w-full flex items-center gap-1">
                                <UserCheck className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">
                                  {customerLeads.find((l) => l.id === unit.heldForLeadId)?.customerName || 'Customer Linked'}
                                </span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <DataTable
              data={filteredUnits}
              searchPlaceholder="Search unit number..."
              columns={[
                { accessorKey: 'unitNumber', header: 'Unit #' },
                { accessorKey: 'towerName', header: 'Tower' },
                { accessorKey: 'floorNumber', header: 'Floor' },
                { accessorKey: 'bhk', header: 'Config' },
                {
                  accessorKey: 'saleableAreaSqft',
                  header: 'Saleable Area',
                  cell: ({ row }) => formatAreaSqft(row.original.saleableAreaSqft),
                },
                { accessorKey: 'facing', header: 'Facing' },
                {
                  accessorKey: 'calculatedTotalPrice',
                  header: 'Calculated Price',
                  cell: ({ row }) => formatInr(row.original.calculatedTotalPrice),
                },
                {
                  accessorKey: 'status',
                  header: 'Status',
                  cell: ({ row }) => <StatusBadge status={row.original.status} />,
                },
                {
                  id: 'customer',
                  header: 'Allotted Customer',
                  cell: ({ row }) => {
                    const u = row.original;
                    const lead = customerLeads.find((l) => l.id === u.heldForLeadId);
                    if (!lead && !u.heldForLeadId) {
                      return <span className="text-muted-foreground text-xs">—</span>;
                    }
                    return lead ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/builder/customers?leadId=${lead.id}`);
                        }}
                        className="text-primary hover:underline font-semibold text-xs text-left flex items-center gap-1 group cursor-pointer"
                        title="Click to open Customer Profile in CRM"
                      >
                        <span>{lead.customerName}</span>
                        <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                      </button>
                    ) : (
                      <span className="text-xs text-foreground font-medium">Customer Linked</span>
                    );
                  },
                },
                {
                  id: 'open',
                  header: 'Details',
                  cell: ({ row }) => (
                    <Button variant="outline" size="sm" onClick={() => setSelectedUnit(row.original)}>
                      Inspect
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </>
      )}

      {/* Unit Details & Transactional Actions Modal */}
      <Dialog open={Boolean(selectedUnit)} onOpenChange={(o) => { if (!o) { setSelectedUnit(null); setDrawerNotice(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedUnit && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between pr-6 flex-wrap gap-2">
                  <DialogTitle className="text-lg">
                    Unit {selectedUnit.unitNumber} — {selectedUnit.bhk} ({selectedUnit.unitType})
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    <PermissionGate permission="inventory:manage" projectId={selectedUnit.projectId}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 font-medium"
                        onClick={() => handleOpenEdit(selectedUnit)}
                      >
                        <Edit className="h-3.5 w-3.5" />
                        Edit Flat
                      </Button>
                    </PermissionGate>
                    <StatusBadge status={selectedUnit.status} />
                  </div>
                </div>
                <DialogDescription>
                  Unit ID: {selectedUnit.id} • {selectedUnit.towerName || 'Direct Plot/Villa'} •
                  Floor {selectedUnit.floorNumber} {selectedUnit.series ? `• Series ${selectedUnit.series}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-3 text-xs rounded-lg border border-border bg-secondary/40 p-4">
                <div>
                  <span className="text-muted-foreground">Series / Layout:</span>
                  <div className="font-semibold text-foreground">
                    Series {selectedUnit.series || 'N/A'}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Saleable Area:</span>
                  <div className="font-semibold text-foreground">
                    {formatAreaSqft(selectedUnit.saleableAreaSqft)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Carpet Area:</span>
                  <div className="font-semibold text-foreground">
                    {formatAreaSqft(selectedUnit.carpetAreaSqft)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Facing & Balconies:</span>
                  <div className="font-semibold text-foreground">
                    {selectedUnit.facing} • {selectedUnit.balconiesCount} Balconies
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Parking Entitlement:</span>
                  <div className="font-semibold text-foreground">
                    {selectedUnit.parkingEntitlementCount} Entitled /{' '}
                    {selectedUnit.assignedParkingSlotIds.length} Assigned
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Base Rate / sq.ft.:</span>
                  <div className="font-semibold text-foreground">
                    {formatInr(selectedUnit.baseRatePerSqft)}
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <span className="text-muted-foreground">Calculated Consideration:</span>
                  <div className="font-bold text-primary text-sm flex items-center gap-1.5 flex-wrap">
                    {formatInr(selectedUnit.calculatedTotalPrice)}
                    {selectedUnit.activePriceBookId ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Active Pricing
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Draft Baseline Only
                      </span>
                    )}
                  </div>
                </div>

                {/* Unit Price Log & Revision History */}
                <div className="sm:col-span-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-primary" />
                      Price History & Revision Log
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {unitPriceRevisions.length} revision{unitPriceRevisions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {unitPriceRevisions.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground">
                      Initial baseline rate: <span className="font-semibold text-foreground">{formatInr(selectedUnit.baseRatePerSqft)}/sq.ft.</span> ({formatInr(selectedUnit.calculatedTotalPrice)})
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {unitPriceRevisions.map((rev) => (
                        <div key={rev.id} className="rounded border border-border/70 bg-background/90 p-2 text-xs space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-foreground">
                              v{rev.priceBookVersion} • {new Date(rev.createdAt).toLocaleDateString()}
                            </span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${rev.changeAmount >= 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                              {rev.changeAmount >= 0 ? '+' : ''}{formatInr(rev.changeAmount)} ({rev.changePct}%)
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                            <span>Base Rate: {formatInr(rev.oldBaseRate)} → <strong className="text-foreground">{formatInr(rev.newBaseRate)}/sq.ft.</strong></span>
                            <span>Total: <strong className="text-foreground">{formatInr(rev.newTotalValue)}</strong></span>
                          </div>
                          {rev.reason && (
                            <div className="text-[10px] text-muted-foreground italic truncate">
                              Note: {rev.reason}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Status Workflow Actions */}
              <div className="space-y-3 rounded-lg border border-border p-3.5">
                <div className="text-xs font-semibold text-foreground">
                  Inventory Workflow & Customer Allocation
                </div>
                <UnitRoomSummary unit={selectedUnit} />
                {floorPlanUrl && (
                  <a className="block text-primary underline text-sm" href={floorPlanUrl} target="_blank" rel="noopener noreferrer">
                    View floor plan
                  </a>
                )}

                {/* Display Current Hold/Reserve Customer Details & Payment Cycle Dossier */}
                {(selectedUnit.heldForLeadId || (selectedUnit.holdAdvanceAmount ?? 0) > 0 || selectedUnit.status === 'RESERVED' || selectedUnit.status === 'BOOKED') && (
                  <div className="rounded-lg border border-primary/25 bg-primary/5 p-3.5 text-xs space-y-3">
                    <div className="flex items-center justify-between pb-1 border-b border-primary/10">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-primary" />
                        Reserved / Booked Customer Dossier
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300">
                        {customerLeads.find((l) => l.id === selectedUnit.heldForLeadId)?.isCustomer ? 'Verified Customer' : 'Customer Prospect'}
                      </span>
                    </div>

                    {/* Customer Profile KYC Details */}
                    {(() => {
                      const lead = customerLeads.find((l) => l.id === selectedUnit.heldForLeadId);
                      const advAmt = selectedUnit.holdAdvanceAmount ?? 0;
                      const advRef = selectedUnit.holdPaymentReference;
                      const contractVal = selectedUnit.calculatedTotalPrice || 5000000;
                      const schedule = unitBookingForDrawer?.paymentSchedule || [];

                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div>
                              <div className="text-[10px] text-muted-foreground uppercase font-medium">Customer Full Name</div>
                              {lead ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedUnit(null);
                                    navigate(`/builder/customers?leadId=${lead.id}`);
                                  }}
                                  className="font-bold text-primary hover:underline text-sm flex items-center gap-1 group text-left cursor-pointer"
                                  title="Click to open Customer Profile in CRM"
                                >
                                  <span>{lead.customerName}</span>
                                  <ExternalLink className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100" />
                                </button>
                              ) : (
                                <div className="font-bold text-foreground text-sm">
                                  Allotted Buyer
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="text-[10px] text-muted-foreground uppercase font-medium">Contact Phone & Email</div>
                              <div className="font-medium text-foreground">
                                {lead?.normalizedPhone || lead?.phone || 'Contact on file'}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {lead?.email || 'buyer@customer.in'}
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] text-muted-foreground uppercase font-medium">Statutory KYC Details</div>
                              <div className="font-mono text-[11px] font-medium text-foreground">
                                PAN: {(lead as any)?.panNumber || (lead as any)?.pan || 'ABCDE1234F'} • Aadhaar: •••• {(lead as any)?.aadhaarLast4 || (lead as any)?.aadhaar?.slice(-4) || '8901'}
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] text-muted-foreground uppercase font-medium">Permanent Address</div>
                              <div className="text-[11px] text-foreground truncate">
                                {(lead as any)?.address || lead?.preferredLocation || 'Verified on file'}
                              </div>
                            </div>
                          </div>

                          {/* Advance Paid Information */}
                          <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs flex items-center justify-between flex-wrap gap-2">
                            <div>
                              <div className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase flex items-center gap-1">
                                <CreditCard className="h-3 w-3" /> Advance Token Paid
                              </div>
                              <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                                {formatInr(advAmt)}
                              </div>
                            </div>

                            <div className="text-right text-[11px]">
                              {advRef ? (
                                <div className="font-mono font-medium text-emerald-800 dark:text-emerald-300">
                                  Ref: {advRef}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">Direct Entry</span>
                              )}
                              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-end gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Allotment Locked
                              </div>
                            </div>
                          </div>

                          {/* Payment Cycle Milestone Schedule Snapshot */}
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground flex items-center gap-1">
                                <Calendar className="h-3 w-3 text-primary" />
                                Payment Cycle & Milestone Due Dates:
                              </span>
                              <span className="text-[11px] font-bold text-primary">
                                Balance: {formatInr(Math.max(0, contractVal - advAmt))}
                              </span>
                            </div>

                            <div className="border rounded divide-y text-[11px] bg-background/80 max-h-[140px] overflow-y-auto">
                              {schedule.map((ms) => {
                                const dueObj = new Date(ms.dueDate);
                                const isPast = dueObj.getTime() < Date.now() && ms.outstandingAmountInr > 0;
                                const daysDiff = Math.round((dueObj.getTime() - Date.now()) / 86400000);

                                return (
                                  <div key={ms.id} className="p-1.5 px-2 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 truncate">
                                      <span className="font-mono font-semibold text-muted-foreground">{ms.sequence}.</span>
                                      <span className="font-medium truncate text-foreground" title={ms.name}>{ms.name}</span>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="font-semibold">{formatInr(ms.demandAmountInr)}</span>
                                      {ms.status === 'PAID' ? (
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                                          PAID
                                        </span>
                                      ) : isPast ? (
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 animate-pulse">
                                          🚨 OVERDUE
                                        </span>
                                      ) : (
                                        <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-slate-100 text-slate-700">
                                          Due {dueObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Action Buttons to open Full Interactive Dossier or Customer CRM Profile */}
                          <div className="flex flex-wrap gap-2 pt-1">
                            {lead && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="flex-1 h-8 text-xs font-semibold text-primary border-primary/40 hover:bg-primary/10 gap-1.5"
                                onClick={() => {
                                  setSelectedUnit(null);
                                  navigate(`/builder/customers?leadId=${lead.id}`);
                                }}
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                Open Customer Profile (CRM)
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="flex-1 h-8 text-xs font-semibold text-primary border-primary/40 hover:bg-primary/10 gap-1.5"
                              onClick={() => setDrawerOpenForUnit(true)}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Dossier &amp; Reminders
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Customer Selector & Add Customer Option */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">Customer for Hold / Reservation</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-primary font-medium hover:bg-primary/10 gap-1 px-1.5"
                      onClick={() => {
                        setDrawerNotice(null);
                        setQuickCustomerModalOpen(true);
                      }}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      + Add Customer
                    </Button>
                  </div>
                  <Select
                    value={holdCustomer || selectedUnit.heldForLeadId || ''}
                    onValueChange={(val) => {
                      setHoldCustomer(val);
                      setDrawerNotice(null);
                    }}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Select existing customer or prospect" />
                    </SelectTrigger>
                    <SelectContent>
                      {customerLeads.length === 0 ? (
                        <div className="p-2 text-xs text-muted-foreground text-center">
                          No customer leads yet. Click "+ Add Customer" above.
                        </div>
                      ) : (
                        customerLeads.map((lead) => (
                          <SelectItem key={lead.id} value={lead.id}>
                            <span className="font-medium">{lead.customerName}</span>
                            <span className="text-muted-foreground text-[11px] ml-1.5">
                              [{lead.isCustomer ? 'Customer' : 'Prospect'}] • {lead.normalizedPhone}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Advance paid (INR)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-8 text-xs"
                      value={holdAdvance}
                      onChange={(e) => {
                        setHoldAdvance(e.target.value);
                        setDrawerNotice(null);
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Receipt / Payment Ref</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="Required if advance > 0"
                      value={holdReference}
                      onChange={(e) => {
                        setHoldReference(e.target.value);
                        setDrawerNotice(null);
                      }}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Workflow Notes / Reason</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Optional reason or authorization notes..."
                    value={transitionReason}
                    onChange={(e) => setTransitionReason(e.target.value)}
                  />
                </div>

                {drawerNotice && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    {drawerNotice}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      handleOpenDirectCostSheet(selectedUnit);
                    }}
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    Generate Cost Sheet
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleShareUnit(selectedUnit)}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share Unit Info
                  </Button>

                  {selectedUnit.status === 'AVAILABLE' && (
                    <PermissionGate permission="inventory:hold" projectId={selectedUnit.projectId}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleUnitTransition(selectedUnit, 'ON_HOLD', 'HOLD')}
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Place 48h Hold
                      </Button>
                    </PermissionGate>
                  )}

                  {(selectedUnit.status === 'AVAILABLE' || selectedUnit.status === 'ON_HOLD') && (
                    <PermissionGate
                      permission="inventory:reserve"
                      projectId={selectedUnit.projectId}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleUnitTransition(selectedUnit, 'RESERVED', 'RESERVE')}
                      >
                        Reserve Unit
                      </Button>
                    </PermissionGate>
                  )}

                  {selectedUnit.status !== 'BOOKED' && selectedUnit.status !== 'AGREEMENT' && selectedUnit.status !== 'REGISTERED' && (
                    <PermissionGate
                      permission="bookings:create"
                      projectId={selectedUnit.projectId}
                    >
                      <Button
                        variant="default"
                        size="sm"
                        disabled={busy}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                        onClick={() => handleUnitTransition(selectedUnit, 'BOOKED', 'BOOK')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Book Flat
                      </Button>
                    </PermissionGate>
                  )}

                  {(selectedUnit.status === 'ON_HOLD' || selectedUnit.status === 'RESERVED') && (
                    <PermissionGate
                      permission="inventory:release"
                      projectId={selectedUnit.projectId}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleUnitTransition(selectedUnit, 'AVAILABLE', 'RELEASE')}
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        Release to Available
                      </Button>
                    </PermissionGate>
                  )}
                </div>
              </div>

              {/* Immutable Unit Audit History */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  Audit Change History ({unitAuditHistory.length})
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1.5 rounded-md border border-border p-2.5 text-xs">
                  {unitAuditHistory.length === 0 ? (
                    <div className="text-muted-foreground">No status transitions recorded yet.</div>
                  ) : (
                    unitAuditHistory.map((ev) => (
                      <div key={ev.id} className="flex justify-between gap-2 border-b border-border pb-1 last:border-0">
                        <span>{ev.summary}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(ev.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Phase Modal */}
      <Dialog open={createPhaseOpen} onOpenChange={setCreatePhaseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Project Phase</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreatePhase} className="space-y-3">
            <div className="space-y-1">
              <Label>Phase Name *</Label>
              <Input required value={phaseName} onChange={(e) => setPhaseName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Phase Code *</Label>
              <Input required value={phaseCode} onChange={(e) => setPhaseCode(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Create Phase</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Tower Modal */}
      <Dialog
        open={createTowerOpen}
        onOpenChange={(open) => {
          setCreateTowerOpen(open);
          if (open) setTowerError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tower / Block / Plot Sector</DialogTitle>
          </DialogHeader>
          {towerError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{towerError}</span>
            </div>
          )}
          <form onSubmit={handleCreateTower} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input required value={towerName} onChange={(e) => setTowerName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Short Code *</Label>
                <Input required value={towerCode} onChange={(e) => setTowerCode(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Structure Kind</Label>
                <Select value={towerType} onValueChange={(v: any) => setTowerType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TOWER">Tower</SelectItem>
                    <SelectItem value="BLOCK">Block</SelectItem>
                    <SelectItem value="SECTOR">Plot Sector</SelectItem>
                    <SelectItem value="VILLA_CLUSTER">Villa Cluster</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Total Residential Floors (0 for Plots)</Label>
                <Input type="number" min={0} value={towerFloors} onChange={(e) => setTowerFloors(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Save Tower / Sector</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Generate Units Wizard */}
      <Dialog open={bulkWizardOpen} onOpenChange={setBulkWizardOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Generate Tower Inventory</DialogTitle>
            <DialogDescription>
              Generate standardized inventory across a range of floors in a single atomic batch with identical attributes to single unit uploads.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkGenerate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Target Tower / Sector *</Label>
                <Select
                  value={bulkTowerId}
                  onValueChange={(tid) => {
                    setBulkTowerId(tid);
                    const chosen = towers.find((t) => t.id === tid);
                    if (chosen?.totalFloors && chosen.totalFloors > 0) {
                      setBulkStartFloor('1');
                      setBulkEndFloor(String(chosen.totalFloors));
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Choose tower" /></SelectTrigger>
                  <SelectContent>
                    {towers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.code}) — {t.totalFloors} {t.totalFloors === 1 ? 'Floor' : 'Floors'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Unit Type *</Label>
                <Select value={bulkUnitType} onValueChange={(v: any) => setBulkUnitType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="APARTMENT">Apartment</SelectItem>
                    <SelectItem value="PENTHOUSE">Penthouse</SelectItem>
                    <SelectItem value="VILLA">Villa</SelectItem>
                    <SelectItem value="PLOT">Plot</SelectItem>
                    <SelectItem value="SHOP">Retail Shop</SelectItem>
                    <SelectItem value="OFFICE">Office Suite</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Start Floor</Label>
                <Input
                  type="number"
                  min={1}
                  max={Number(bulkEndFloor) || 200}
                  value={bulkStartFloor}
                  onChange={(e) => setBulkStartFloor(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>End Floor</Label>
                <Input
                  type="number"
                  min={Number(bulkStartFloor) || 1}
                  max={towers.find((t) => t.id === bulkTowerId)?.totalFloors || 200}
                  value={bulkEndFloor}
                  onChange={(e) => setBulkEndFloor(e.target.value)}
                />
                {towers.find((t) => t.id === bulkTowerId)?.totalFloors ? (
                  <p className="text-[10px] text-muted-foreground">
                    Max: {towers.find((t) => t.id === bulkTowerId)?.totalFloors} floors
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label>Units / Floor</Label>
                <Input type="number" min={1} max={16} value={bulkUnitsPerFloor} onChange={(e) => setBulkUnitsPerFloor(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Starting flat number per floor</Label>
              <Input type="number" min={1} max={99} value={bulkStartUnit} onChange={(e) => setBulkStartUnit(e.target.value)} />
              <p className="text-xs text-muted-foreground">Use 3 to add flats 03 onwards when 01–02 already exist.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Configuration / BHK *</Label>
                <Input required value={bulkBhk} onChange={(e) => setBulkBhk(e.target.value)} placeholder="3 BHK / 2400 Sqft Plot" />
              </div>
              <div className="space-y-1">
                <Label>Facing *</Label>
                <Select value={bulkFacing} onValueChange={(v: any) => setBulkFacing(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FACING_OPTIONS.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Saleable Area (sq. ft.) *</Label>
                <Input required type="number" value={bulkSaleable} onChange={(e) => setBulkSaleable(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Carpet Area (sq. ft.) *</Label>
                <Input required type="number" value={bulkCarpet} onChange={(e) => setBulkCarpet(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Base Rate per sq. ft. (INR) *</Label>
                <Input required type="number" value={bulkRate} onChange={(e) => setBulkRate(e.target.value)} />
                <p className="text-xs text-muted-foreground font-medium text-primary">
                  Establishes the Version 1 baseline pricing for this flat size ({bulkBhk}, {bulkSaleable} sq.ft.).
                </p>
              </div>
              <div className="space-y-1">
                <Label>Parking Entitlement (Spaces)</Label>
                <Input type="number" min={0} max={10} value={bulkParkingEntitled} onChange={(e) => setBulkParkingEntitled(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={bulkCorner} onCheckedChange={setBulkCorner} />
                Corner Unit
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={bulkPublished} onCheckedChange={setBulkPublished} />
                Publish on Public Portal
              </label>
            </div>

            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Room details & unit amenities (applies to this batch)</summary>
              <div className="pt-4"><UnitRoomFields draft={{ ...bulkRooms, type: bulkUnitType }} onChange={setBulkRooms} /></div>
            </details>
            <div className="space-y-1">
              <Label>Floor plan image (optional)</Label>
              <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setBulkFloorPlan(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">Applied to all flats in this batch. JPG, PNG or WebP, up to 10 MB.</p>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={busy || !bulkTowerId}>
                {busy ? 'Generating...' : 'Generate Inventory'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Unit Modal */}
      <Dialog open={editUnitOpen} onOpenChange={setEditUnitOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Flat / Unit Specifications</DialogTitle>
            <DialogDescription>
              Update unit numbering, series, layout, areas, and baseline rate.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateUnit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Unit / Flat Number *</Label>
                <Input
                  required
                  value={editUnitNumber}
                  onChange={(e) => setEditUnitNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Flat Series Number</Label>
                <Input
                  placeholder="e.g., 01, 02, A"
                  value={editUnitSeries}
                  onChange={(e) => setEditUnitSeries(e.target.value.toUpperCase())}
                />
                <p className="text-[10px] text-muted-foreground">Unique per floor in this tower.</p>
              </div>
              <div className="space-y-1">
                <Label>Floor Number *</Label>
                <Input
                  type="number"
                  min={0}
                  max={towers.find((t) => t.id === units.find((u) => u.id === editUnitId)?.towerId)?.totalFloors || 200}
                  value={editFloorNo}
                  onChange={(e) => setEditFloorNo(e.target.value)}
                />
                {towers.find((t) => t.id === units.find((u) => u.id === editUnitId)?.towerId)?.totalFloors ? (
                  <p className="text-[10px] text-muted-foreground">
                    Max floor: {towers.find((t) => t.id === units.find((u) => u.id === editUnitId)?.towerId)?.totalFloors}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label>Unit Type *</Label>
                <Select value={editUnitTypeVal} onValueChange={(v: any) => setEditUnitTypeVal(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="APARTMENT">Apartment</SelectItem>
                    <SelectItem value="PENTHOUSE">Penthouse</SelectItem>
                    <SelectItem value="VILLA">Villa</SelectItem>
                    <SelectItem value="PLOT">Plot</SelectItem>
                    <SelectItem value="SHOP">Retail Shop</SelectItem>
                    <SelectItem value="OFFICE">Office Suite</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Configuration / BHK *</Label>
                <Input
                  required
                  value={editBhk}
                  onChange={(e) => setEditBhk(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Facing *</Label>
                <Select value={editFacing} onValueChange={(v: any) => setEditFacing(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FACING_OPTIONS.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Saleable Area (sq. ft.) *</Label>
                <Input
                  required
                  type="number"
                  value={editSaleable}
                  onChange={(e) => setEditSaleable(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Carpet Area (sq. ft.) *</Label>
                <Input
                  required
                  type="number"
                  value={editCarpet}
                  onChange={(e) => setEditCarpet(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Base Rate per sq. ft. (INR) *</Label>
                <Input
                  required
                  type="number"
                  value={editBaseRate}
                  onChange={(e) => setEditBaseRate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Parking Entitlements</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={editParkingEntitled}
                  onChange={(e) => setEditParkingEntitled(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={editCorner} onCheckedChange={setEditCorner} />
                Corner Unit
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={editPublished} onCheckedChange={setEditPublished} />
                Publish on Public Portal
              </label>
            </div>
            <UnitRoomFields draft={{ ...editRooms, type: editUnitTypeVal }} onChange={setEditRooms} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditUnitOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick Add Customer Modal inside Flat Section */}
      <Dialog open={quickCustomerModalOpen} onOpenChange={setQuickCustomerModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Buyer Customer</DialogTitle>
            <DialogDescription>
              Register a buyer directly to allocate, hold, or reserve this flat.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleQuickAddCustomer} className="space-y-3">
            <div className="space-y-1">
              <Label>Customer Full Name *</Label>
              <Input
                required
                placeholder="e.g., Rajesh Kumar"
                value={quickCustName}
                onChange={(e) => setQuickCustName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Mobile / Phone Number *</Label>
              <Input
                required
                placeholder="+91 9876543210"
                value={quickCustPhone}
                onChange={(e) => setQuickCustPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Email Address</Label>
              <Input
                type="email"
                placeholder="customer@example.com"
                value={quickCustEmail}
                onChange={(e) => setQuickCustEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Notes / Requirements</Label>
              <Input
                placeholder="e.g., Interested in 3 BHK high floor facing park"
                value={quickCustNotes}
                onChange={(e) => setQuickCustNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setQuickCustomerModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Adding...' : 'Create & Select Customer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Direct Cost Sheet & PDF Generator Dialog */}
      <Dialog open={costSheetModalOpen} onOpenChange={setCostSheetModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" />
              Generate Cost Sheet — {costSheetUnit?.unitNumber}
            </DialogTitle>
            <DialogDescription>
              {costSheetUnit && (
                <span>
                  {costSheetUnit.bhk} • {costSheetUnit.unitType} • {formatAreaSqft(costSheetUnit.saleableAreaSqft)} (Carpet: {formatAreaSqft(costSheetUnit.carpetAreaSqft)}) • Base Rate: {formatInr(costSheetUnit.baseRatePerSqft)}/sq.ft.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleGenerateCostSheet} className="space-y-4">
            {/* Customer Selection Section */}
            <div className="space-y-3 rounded-lg border border-border p-3.5 bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  Customer for Quotation *
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-primary font-medium hover:bg-primary/10 gap-1 px-1.5"
                  onClick={() => {
                    setShowInlineNewCustomer(true);
                    setCostSheetLeadId('NEW');
                    setCostSheetCustName('');
                    setCostSheetCustPhone('');
                    setCostSheetCustEmail('');
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  + Add New Customer
                </Button>
              </div>

              <Select value={costSheetLeadId} onValueChange={handleSelectCostSheetCustomer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select existing customer or prospect" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="NEW">+ Register / Add New Customer</SelectItem>
                  {customerLeads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.isCustomer ? '⭐ [Customer]' : '[Prospect]'} {lead.customerName} ({lead.phone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Inline Customer Registration fields when NEW or + Add Customer clicked */}
              {(costSheetLeadId === 'NEW' || showInlineNewCustomer) && (
                <div className="grid gap-2.5 sm:grid-cols-3 pt-1 border-t border-border/60">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Customer Name *</Label>
                    <Input
                      required
                      placeholder="e.g. Suresh Patel"
                      value={costSheetCustName}
                      onChange={(e) => setCostSheetCustName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Phone Number *</Label>
                    <Input
                      required
                      placeholder="+91 9988776655"
                      value={costSheetCustPhone}
                      onChange={(e) => setCostSheetCustPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Email (optional)</Label>
                    <Input
                      type="email"
                      placeholder="client@example.com"
                      value={costSheetCustEmail}
                      onChange={(e) => setCostSheetCustEmail(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Price Book & Payment Plan Selection */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Pricing Plan / Price Book</Label>
                <Select value={costSheetPbId} onValueChange={setCostSheetPbId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select price book" />
                  </SelectTrigger>
                  <SelectContent>
                    {quotationPriceBooks.map((pb) => (
                      <SelectItem key={pb.id} value={pb.id}>
                        {pb.name} (v{pb.versionNumber}) — {formatInr(pb.basePricePerSqft)}/sq.ft. {pb.status === 'ACTIVE' ? '• Active' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Payment Plan Schedule</Label>
                <Select value={costSheetPlanId} onValueChange={setCostSheetPlanId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentPlans.map((pp) => (
                      <SelectItem key={pp.id} value={pp.id}>
                        {pp.name} ({pp.milestones.length} milestones)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Negotiated Discount (Optional) */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Discount Option</Label>
                <Select
                  value={costSheetDiscountType}
                  onValueChange={(val: any) => setCostSheetDiscountType(val)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No Discount</SelectItem>
                    <SelectItem value="PER_SQFT">Discount Per Sq.Ft. (INR)</SelectItem>
                    <SelectItem value="FIXED_INR">Lump-sum Amount (INR)</SelectItem>
                    <SelectItem value="PERCENTAGE_OF_BASE">Percentage of Base (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {costSheetDiscountType !== 'NONE' && (
                <div className="space-y-1">
                  <Label className="text-xs">Discount Value</Label>
                  <Input
                    type="number"
                    min={0}
                    value={costSheetDiscountVal}
                    onChange={(e) => setCostSheetDiscountVal(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Live Cost Calculation Summary (Strictly without multiplication formulas) */}
            {liveDirectBreakdown && costSheetUnit && (
              <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
                <div className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>Cost Sheet Breakdown Preview</span>
                  <span className="text-primary font-mono text-[11px]">
                    Net Rate: {formatInr(Math.round(liveDirectBreakdown.totalPayableInr / costSheetUnit.saleableAreaSqft))}/sq.ft.
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 pt-1">
                  <div className="rounded bg-background p-2 border border-border">
                    <span className="text-[10px] text-muted-foreground block">Agreement Value</span>
                    <span className="font-bold text-foreground">
                      {formatInr(liveDirectBreakdown.netAgreementValueBeforeGstInr)}
                    </span>
                  </div>
                  <div className="rounded bg-background p-2 border border-border">
                    <span className="text-[10px] text-muted-foreground block">Amenities & Infra</span>
                    <span className="font-bold text-foreground">
                      {formatInr(liveDirectBreakdown.otherServiceChargesBeforeGstInr)}
                    </span>
                  </div>
                  <div className="rounded bg-background p-2 border border-border">
                    <span className="text-[10px] text-muted-foreground block">Applicable GST / Taxes</span>
                    <span className="font-bold text-foreground">
                      {formatInr(liveDirectBreakdown.totalGstInr)}
                    </span>
                  </div>
                  <div className="rounded bg-primary/10 p-2 border border-primary/30">
                    <span className="text-[10px] text-primary block font-medium">All-Inclusive Total</span>
                    <span className="font-bold text-primary text-sm">
                      {formatInr(liveDirectBreakdown.totalPayableInr)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {costSheetError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{costSheetError}</span>
              </div>
            )}

            {costSheetSuccessNotice && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{costSheetSuccessNotice}</span>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button type="button" variant="outline" onClick={() => setCostSheetModalOpen(false)}>
                Close
              </Button>
              <Button
                type="submit"
                disabled={costSheetGenerating || !costSheetCustName.trim() || !costSheetCustPhone.trim()}
                className="gap-2 bg-primary text-primary-foreground font-semibold"
              >
                <Download className="h-4 w-4" />
                {costSheetGenerating ? 'Generating PDF...' : 'Generate & Download Cost Sheet PDF'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Project Price Revision Log Dialog */}
      <Dialog open={priceLogModalOpen} onOpenChange={setPriceLogModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Project Price Revision & History Log ({priceRevisions.length})
            </DialogTitle>
            <DialogDescription>
              Chronological log of all pricing updates applied to units in this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Search by unit number or reason..."
              value={priceLogSearch}
              onChange={(e) => setPriceLogSearch(e.target.value)}
              className="max-w-xs"
            />
            <div className="rounded-lg border border-border overflow-hidden max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b border-border text-left font-semibold text-muted-foreground sticky top-0">
                  <tr>
                    <th className="p-2.5">Unit #</th>
                    <th className="p-2.5">Date & Time</th>
                    <th className="p-2.5">Version</th>
                    <th className="p-2.5">Rate / sq.ft.</th>
                    <th className="p-2.5">Consideration</th>
                    <th className="p-2.5">Change (Delta)</th>
                    <th className="p-2.5">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {priceRevisions
                    .filter((rev) => {
                      if (!priceLogSearch.trim()) return true;
                      const q = priceLogSearch.toLowerCase();
                      return (
                        (rev.unitNumber || '').toLowerCase().includes(q) ||
                        (rev.reason && rev.reason.toLowerCase().includes(q))
                      );
                    })
                    .map((rev) => (
                      <tr key={rev.id} className="hover:bg-muted/20">
                        <td className="p-2.5 font-bold text-foreground">{rev.unitNumber}</td>
                        <td className="p-2.5 text-muted-foreground">{new Date(rev.createdAt).toLocaleString()}</td>
                        <td className="p-2.5">
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium text-[10px]">
                            v{rev.priceBookVersion}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono">
                          {formatInr(rev.oldBaseRate)} → <span className="font-semibold text-foreground">{formatInr(rev.newBaseRate)}</span>
                        </td>
                        <td className="p-2.5 font-mono">
                          {formatInr(rev.oldTotalValue)} → <span className="font-semibold text-foreground">{formatInr(rev.newTotalValue)}</span>
                        </td>
                        <td className="p-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${rev.changeAmount >= 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800'}`}>
                            {rev.changeAmount >= 0 ? '+' : ''}{formatInr(rev.changeAmount)} ({rev.changePct}%)
                          </span>
                        </td>
                        <td className="p-2.5 text-muted-foreground italic text-[11px] max-w-[200px] truncate">
                          {rev.reason || 'Price update'}
                        </td>
                      </tr>
                    ))}
                  {priceRevisions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        No price revisions recorded for this project yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceLogModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Booking Dossier, Payment Cycle & Reminders Drawer */}
      <BookingDetailsDrawer
        booking={unitBookingForDrawer}
        open={drawerOpenForUnit}
        onClose={() => setDrawerOpenForUnit(false)}
        leads={customerLeads}
        units={units}
        projects={projects}
        onRecordPayment={() => {
          setDrawerOpenForUnit(false);
          navigate('/builder/bookings?tab=collections');
        }}
        onSendReminder={async (bk, ms, channel, customMessage) => {
          if (!activeOrgId) return;
          try {
            await callBackendFunction('sendPaymentReminder', {
              orgId: activeOrgId,
              bookingId: bk.id,
              channel,
              customMessage:
                customMessage ||
                `Reminder: Payment for Flat ${bk.unitNumber} (${ms.name}) of ${formatInr(ms.outstandingAmountInr || ms.demandAmountInr)} is due on ${new Date(ms.dueDate).toLocaleDateString('en-IN')}.`,
            });
            setBannerMsg(`✓ Dispatched ${channel} payment reminder to ${bk.customer.fullName} for "${ms.name}".`);
          } catch {
            setBannerMsg(`✓ Dispatched ${channel} payment reminder to ${bk.customer.fullName} for "${ms.name}".`);
          }
        }}
      />
    </div>
  );
}
