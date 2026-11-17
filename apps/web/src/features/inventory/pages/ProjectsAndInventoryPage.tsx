import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  Building2,
  Calculator,
  Check,
  Download,
  Edit,
  Filter,
  FolderPlus,
  Grid3X3,
  History,
  Layers,
  List,
  Lock,
  Plus,
  Share2,
  Sparkles,
  TrendingUp,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import {
  calculateCostSheet,
  formatAreaSqft,
  formatInr,
  formatInrCompact,
  type AuditEvent,
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
  const navigate = useNavigate();
  const { id: routeProjectId } = useParams<{ id?: string }>();
  const {
    activeOrgId,
    activeOrganization,
    projects,
    activeProjectId,
    activeProject,
    setProjects,
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
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [createPhaseOpen, setCreatePhaseOpen] = React.useState(false);
  const [createTowerOpen, setCreateTowerOpen] = React.useState(false);
  const [createUnitOpen, setCreateUnitOpen] = React.useState(false);
  const [bulkWizardOpen, setBulkWizardOpen] = React.useState(false);
  const [selectedUnit, setSelectedUnit] = React.useState<Unit | null>(null);
  const [unitAuditHistory, setUnitAuditHistory] = React.useState<AuditEvent[]>([]);
  const [transitionReason, setTransitionReason] = React.useState('');
  const [bannerMsg, setBannerMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Create Project Form
  const [projName, setProjName] = React.useState('');
  const [projCode, setProjCode] = React.useState('');
  const [projCity, setProjCity] = React.useState('');
  const [projLocality, setProjLocality] = React.useState('');
  const [projAddress, setProjAddress] = React.useState('');
  const [projType, setProjType] = React.useState<'APARTMENT' | 'VILLA' | 'PLOTTED' | 'COMMERCIAL' | 'MIXED'>('APARTMENT');
  const [projRera, setProjRera] = React.useState('');
  const [projLandAcres, setProjLandAcres] = React.useState('');
  const [projConfigs, setProjConfigs] = React.useState('2 BHK, 3 BHK, 4 BHK');
  const [projAmenities, setProjAmenities] = React.useState('Clubhouse, Swimming Pool, EV Charging, Gymnasium, Children Play Area');
  const [projStatus, setProjStatus] = React.useState<'PRE_LAUNCH' | 'NEW_LAUNCH' | 'UNDER_CONSTRUCTION' | 'NEARING_POSSESSION' | 'READY_TO_MOVE'>('UNDER_CONSTRUCTION');
  const [projPossession, setProjPossession] = React.useState('');
  const [projPublished, setProjPublished] = React.useState(false);

  // Create Phase / Tower Form
  const [phaseName, setPhaseName] = React.useState('Phase 1');
  const [phaseCode, setPhaseCode] = React.useState('PH1');
  const [towerName, setTowerName] = React.useState('Tower 1');
  const [towerCode, setTowerCode] = React.useState('T1');
  const [towerType, setTowerType] = React.useState<'TOWER' | 'BLOCK' | 'SECTOR' | 'VILLA_CLUSTER'>('TOWER');
  const [towerFloors, setTowerFloors] = React.useState('15');

  // Create Unit Form
  const [unitTowerId, setUnitTowerId] = React.useState('');
  const [unitFloorNo, setUnitFloorNo] = React.useState('1');
  const [unitSeries, setUnitSeries] = React.useState('01');
  const [unitNumber, setUnitNumber] = React.useState('');
  const [unitTypeVal, setUnitTypeVal] = React.useState<'APARTMENT' | 'PENTHOUSE' | 'VILLA' | 'PLOT' | 'SHOP' | 'OFFICE'>('APARTMENT');
  const [unitBhk, setUnitBhk] = React.useState('3 BHK');
  const [unitSaleable, setUnitSaleable] = React.useState('2200');
  const [unitCarpet, setUnitCarpet] = React.useState('1540');
  const [unitFacing, setUnitFacing] = React.useState<FacingDirection>('EAST');
  const [unitBaseRate, setUnitBaseRate] = React.useState('9500');
  const [unitParkingEntitled, setUnitParkingEntitled] = React.useState('2');
  const [unitCorner, setUnitCorner] = React.useState(false);
  const [unitPublished, setUnitPublished] = React.useState(false);

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
  const [floorPlan, setFloorPlan] = React.useState<File | null>(null);
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
      onData: setPaymentPlans,
    });
    return () => {
      unsubRevs();
      unsubPb();
      unsubPp();
    };
  }, [activeOrgId, currentProjectId]);

  const unitPriceRevisions = React.useMemo(() => {
    if (!selectedUnit) return [];
    return priceRevisions.filter((r) => r.unitId === selectedUnit.id);
  }, [priceRevisions, selectedUnit]);

  const liveCostSheetPb = React.useMemo(() => {
    return (
      priceBooks.find((pb) => pb.id === costSheetPbId) ??
      priceBooks.find((pb) => pb.status === 'ACTIVE') ??
      priceBooks[0] ??
      null
    );
  }, [priceBooks, costSheetPbId]);

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
        paymentPlan: liveCostSheetPlan ?? undefined,
        discount: {
          type: costSheetDiscountType,
          value: Number(costSheetDiscountVal) || 0,
        },
      });
    } catch {
      return null;
    }
  }, [costSheetUnit, liveCostSheetPb, liveCostSheetPlan, costSheetDiscountType, costSheetDiscountVal]);

  const handleOpenDirectCostSheet = (unit: Unit) => {
    setCostSheetUnit(unit);
    const activePb = priceBooks.find((pb) => pb.status === 'ACTIVE') ?? priceBooks[0];
    setCostSheetPbId(activePb?.id ?? '');
    const activePlan = paymentPlans.find((p) => p.isActive) ?? paymentPlans[0];
    setCostSheetPlanId(activePlan?.id ?? '');

    if (unit.heldForLeadId) {
      const heldLead = customerLeads.find((l) => l.id === unit.heldForLeadId);
      if (heldLead) {
        setCostSheetLeadId(heldLead.id);
        setCostSheetCustName(heldLead.customerName);
        setCostSheetCustPhone(heldLead.phone);
        setCostSheetCustEmail(heldLead.email ?? '');
        setShowInlineNewCustomer(false);
      } else {
        setCostSheetLeadId('NEW');
        setCostSheetCustName('');
        setCostSheetCustPhone('');
        setCostSheetCustEmail('');
        setShowInlineNewCustomer(false);
      }
    } else {
      setCostSheetLeadId('NEW');
      setCostSheetCustName('');
      setCostSheetCustPhone('');
      setCostSheetCustEmail('');
      setShowInlineNewCustomer(false);
    }

    setCostSheetDiscountType('NONE');
    setCostSheetDiscountVal('0');
    setCostSheetSuccessNotice(null);
    setCostSheetModalOpen(true);
  };

  const handleSelectCostSheetCustomer = (leadId: string) => {
    setCostSheetLeadId(leadId);
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
    if (!activeOrgId || !currentProjectId || !costSheetUnit || !liveCostSheetPb) return;
    if (costSheetLeadId === 'NEW' && (!costSheetCustName.trim() || !costSheetCustPhone.trim())) {
      setBannerMsg('Customer name and phone number are required.');
      return;
    }

    setCostSheetGenerating(true);
    setCostSheetSuccessNotice(null);
    try {
      let finalLeadId = costSheetLeadId !== 'NEW' ? costSheetLeadId : undefined;
      if (!finalLeadId) {
        const leadRes = await callBackendFunction<any, { lead: Lead }>('ingestLead', {
          orgId: activeOrgId,
          projectId: currentProjectId,
          customerName: costSheetCustName.trim(),
          phone: costSheetCustPhone.trim(),
          email: costSheetCustEmail.trim() || undefined,
          source: 'MANUAL',
          isCustomer: true,
          whatsappOptIn: true,
        });
        finalLeadId = leadRes.lead.id;
      }

      const res = await callBackendFunction<any, { quotation: Quotation; pdfBase64: string }>('createQuotation', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        unitId: costSheetUnit.id,
        priceBookId: liveCostSheetPb.id,
        paymentPlanId: liveCostSheetPlan?.id ?? 'default',
        customer: {
          name: costSheetCustName.trim(),
          phone: costSheetCustPhone.trim(),
          email: costSheetCustEmail.trim() || undefined,
        },
        leadId: finalLeadId,
        discount: {
          type: costSheetDiscountType,
          value: Number(costSheetDiscountVal) || 0,
        },
        validDays: 15,
        termsAndConditions:
          '1. Quotation valid for 15 days subject to availability. 2. Cheques/RTGS in favour of Builder Escrow Account. 3. Stamp duty & registration extra at actuals.',
        selectedParkingSlotIds: [],
        parkingSlotsCount: costSheetUnit.parkingEntitlementCount || 1,
        parkingTypeUsed: 'STANDARD',
      });

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
      setBannerMsg(err instanceof Error ? err.message : 'Failed to generate quotation PDF.');
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

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !activeOrganization) return;
    setBusy(true);
    setBannerMsg(null);
    try {
      const created = await callBackendFunction<any, Project>(
        'createProject',
        {
          orgId: activeOrgId,
          builderName: activeOrganization.name,
          name: projName,
          code: projCode,
          city: projCity,
          locality: projLocality,
          address: projAddress,
          projectType: projType,
          reraNumber: projRera,
          landAreaAcres: projLandAcres ? Number(projLandAcres) : undefined,
          configurations: projConfigs
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          amenities: projAmenities
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          constructionStatus: projStatus,
          possessionDate: projPossession || undefined,
          isPublicPublished: projPublished,
          listingIntent: 'BUY',
        }
      );
      setProjects([created, ...projects.filter((p) => p.id !== created.id)]);
      selectProject(created.id, 'SINGLE_PROJECT');
      setCreateProjectOpen(false);
      setProjName('');
      setProjCode('');
      setBannerMsg(`Created project "${created.name}".`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setBusy(false);
    }
  };

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
    setBusy(true);
    try {
      const createdTower = await callBackendFunction<any, Tower>('createTower', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        name: towerName,
        code: towerCode,
        towerType,
        totalFloors: Number(towerFloors),
        basementLevels: 2,
        podiumLevels: 1,
        unitsPerFloorTypical: 4,
      });
      setTowers((prev) => [...prev.filter((t) => t.id !== createdTower.id), createdTower]);
      setCreateTowerOpen(false);
      setBannerMsg(`Created ${towerType} "${towerName}".`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Failed to create tower.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId) return;
    setBusy(true);
    let uploadedPath: string | undefined;
    try {
      if (floorPlan) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(floorPlan.type) || floorPlan.size > 10 * 1024 * 1024) {
          throw new Error('Choose a JPG, PNG or WebP floor plan smaller than 10 MB.');
        }
        uploadedPath = `organizations/${activeOrgId}/projects/${currentProjectId}/floorplans/${crypto.randomUUID()}`;
        await uploadBytes(ref(storage, uploadedPath), floorPlan, { contentType: floorPlan.type });
      }
      const selectedTowerObj = towers.find((t) => t.id === unitTowerId);
      if (
        unitTypeVal !== 'PLOT' &&
        unitTypeVal !== 'VILLA' &&
        selectedTowerObj?.totalFloors &&
        selectedTowerObj.totalFloors > 0 &&
        Number(unitFloorNo) > selectedTowerObj.totalFloors
      ) {
        setBannerMsg(`Floor number (${unitFloorNo}) cannot exceed tower "${selectedTowerObj.name}" total floors (${selectedTowerObj.totalFloors}).`);
        setBusy(false);
        return;
      }
      const createdUnit = await callBackendFunction<any, Unit>('createUnit', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        towerId: unitTowerId || null,
        towerName: selectedTowerObj?.name,
        floorNumber: unitTypeVal === 'PLOT' || unitTypeVal === 'VILLA' ? 0 : Number(unitFloorNo),
        series: unitSeries.trim().toUpperCase() || undefined,
        unitNumber,
        unitType: unitTypeVal,
        bhk: unitBhk,
        saleableAreaSqft: Number(unitSaleable),
        carpetAreaSqft: Number(unitCarpet),
        facing: unitFacing,
        isCorner: unitCorner,
        balconiesCount: 2,
        parkingEntitlementCount: Number(unitParkingEntitled),
        baseRatePerSqft: Number(unitBaseRate),
        listingMode: 'BUY',
        isPublicPublished: unitPublished,
        ...(uploadedPath ? { floorPlanStoragePath: uploadedPath } : {}),
      });
      setUnits((prev) => [...prev.filter((u) => u.id !== createdUnit.id), createdUnit]);
      setCreateUnitOpen(false);
      setUnitNumber('');
      setUnitSeries('01');
      setFloorPlan(null);
      setBannerMsg(`Added unit ${unitNumber.toUpperCase()} (Series ${createdUnit.series || 'N/A'}) to inventory.`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Failed to create unit.');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenEdit = (unit: Unit) => {
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
    action: 'HOLD' | 'RESERVE' | 'RELEASE' | 'CANCEL'
  ) => {
    if (!activeOrgId) return;
    setDrawerNotice(null);
    if ((action === 'HOLD' || action === 'RESERVE') && !holdCustomer && !unit.heldForLeadId) {
      const msg = 'Please select or add a customer lead before holding or reserving this flat.';
      setBannerMsg(msg);
      setDrawerNotice(msg);
      return;
    }
    if ((action === 'HOLD' || action === 'RESERVE') && Number(holdAdvance) > 0 && !holdReference.trim()) {
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
        eyebrow="Enterprise Inventory Engine"
        title="Projects & Visual Inventory"
        description="Manage multi-city projects, phases, towers, floors, apartments, villas, and plots with transactional reservation locks."
        actions={
          <>
            <PermissionGate permission="projects:create">
              <Button variant="outline" size="sm" onClick={() => setCreateProjectOpen(true)}>
                <FolderPlus className="h-4 w-4" />
                New Project
              </Button>
            </PermissionGate>
            {currentProjectId && (
              <PermissionGate permission="projects:edit" projectId={currentProjectId}>
                <Button variant="outline" size="sm" onClick={() => setCreatePhaseOpen(true)}>
                  + Phase
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCreateTowerOpen(true)}>
                  <Layers className="h-4 w-4" />
                  + Tower / Sector
                </Button>
              </PermissionGate>
            )}
            {currentProjectId && (
              <PermissionGate permission="inventory:manage" projectId={currentProjectId}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/app/ai-studio')}
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI Floor-Plan Studio
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAiDrawerOpen(true, 'Add Tower 1')}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Tower Wizard
                </Button>
                {towers.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={() => setBulkWizardOpen(true)}>
                    Bulk Generate Floor Units
                  </Button>
                )}
                <Button size="sm" onClick={() => setCreateUnitOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Add Unit / Plot
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setPriceLogModalOpen(true)}
                >
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Price Log ({priceRevisions.length})
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
          onAction={() => setCreateProjectOpen(true)}
        />
      ) : (
        <>
          {/* Project Switcher & Hierarchy Summary */}
          <Card>
            <CardContent className="p-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-64">
                  <Select
                    value={currentProjectId ?? ''}
                    onValueChange={(val) => selectProject(val)}
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
              onAction={() => setCreateUnitOpen(true)}
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
                {floorPlanUrl && (
                  <a className="block text-primary underline text-sm" href={floorPlanUrl} target="_blank" rel="noopener noreferrer">
                    View floor plan
                  </a>
                )}

                {/* Display Current Hold/Reserve Customer Details */}
                {selectedUnit.heldForLeadId && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-primary" />
                        Current Assigned Buyer / Lead:
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {customerLeads.find((l) => l.id === selectedUnit.heldForLeadId)?.isCustomer ? 'Verified Customer' : 'Prospect'}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-foreground">
                      {customerLeads.find((l) => l.id === selectedUnit.heldForLeadId)?.customerName || 'Assigned Customer'}
                      {customerLeads.find((l) => l.id === selectedUnit.heldForLeadId)?.phone && (
                        <span className="text-xs font-normal text-muted-foreground ml-2">
                          ({customerLeads.find((l) => l.id === selectedUnit.heldForLeadId)?.phone})
                        </span>
                      )}
                    </div>
                    {selectedUnit.holdExpiresAt && (
                      <div className="text-muted-foreground text-[11px]">
                        Hold expiration: {new Date(selectedUnit.holdExpiresAt).toLocaleString()}
                      </div>
                    )}
                    {(selectedUnit.holdAdvanceAmount ?? 0) > 0 && (
                      <div className="text-muted-foreground text-[11px]">
                        Advance Paid: {formatInr(selectedUnit.holdAdvanceAmount ?? 0)}
                        {selectedUnit.holdPaymentReference ? ` (Ref: ${selectedUnit.holdPaymentReference})` : ''}
                      </div>
                    )}
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

      {/* Create Project Modal */}
      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Real Estate Project</DialogTitle>
            <DialogDescription>
              Configure RERA details, location, configurations, and hierarchy support for apartments, villas, or plotted developments.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Project Name *</Label>
                <Input required value={projName} onChange={(e) => setProjName(e.target.value)} placeholder="Emerald Heights" />
              </div>
              <div className="space-y-1">
                <Label>Project Code *</Label>
                <Input required value={projCode} onChange={(e) => setProjCode(e.target.value)} placeholder="EMH-BLR" />
              </div>
              <div className="space-y-1">
                <Label>City *</Label>
                <Input required value={projCity} onChange={(e) => setProjCity(e.target.value)} placeholder="Bengaluru" />
              </div>
              <div className="space-y-1">
                <Label>Locality / Micro-Market *</Label>
                <Input required value={projLocality} onChange={(e) => setProjLocality(e.target.value)} placeholder="Whitefield" />
              </div>
              <div className="space-y-1">
                <Label>Project Type *</Label>
                <Select value={projType} onValueChange={(v: any) => setProjType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="APARTMENT">Residential Apartments</SelectItem>
                    <SelectItem value="VILLA">Gated Villas</SelectItem>
                    <SelectItem value="PLOTTED">Plotted Development</SelectItem>
                    <SelectItem value="COMMERCIAL">Commercial Spaces</SelectItem>
                    <SelectItem value="MIXED">Mixed Use</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>RERA Registration Number *</Label>
                <Input required value={projRera} onChange={(e) => setProjRera(e.target.value)} placeholder="PRM/KA/RERA/1251/..." />
              </div>
              <div className="space-y-1">
                <Label>Construction Status</Label>
                <Select value={projStatus} onValueChange={(v: any) => setProjStatus(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRE_LAUNCH">Pre-Launch</SelectItem>
                    <SelectItem value="NEW_LAUNCH">New Launch</SelectItem>
                    <SelectItem value="UNDER_CONSTRUCTION">Under Construction</SelectItem>
                    <SelectItem value="NEARING_POSSESSION">Nearing Possession</SelectItem>
                    <SelectItem value="READY_TO_MOVE">Ready to Move</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Land Area (Acres) & Possession Date</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" step="0.01" placeholder="Acres" value={projLandAcres} onChange={(e) => setProjLandAcres(e.target.value)} />
                  <Input type="date" value={projPossession} onChange={(e) => setProjPossession(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Site Address *</Label>
              <Input required value={projAddress} onChange={(e) => setProjAddress(e.target.value)} placeholder="Full site address" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Configurations (comma-separated)</Label>
                <Input value={projConfigs} onChange={(e) => setProjConfigs(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Amenities (comma-separated)</Label>
                <Input value={projAmenities} onChange={(e) => setProjAmenities(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="text-xs">
                <div className="font-medium">Publish on Public Property Portal</div>
                <div className="text-muted-foreground">Only published projects appear on public search & comparisons.</div>
              </div>
              <Switch checked={projPublished} onCheckedChange={setProjPublished} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateProjectOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create Project'}</Button>
            </DialogFooter>
          </form>
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
      <Dialog open={createTowerOpen} onOpenChange={setCreateTowerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tower / Block / Plot Sector</DialogTitle>
          </DialogHeader>
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

      {/* Create Single Unit / Plot Modal */}
      <Dialog open={createUnitOpen} onOpenChange={setCreateUnitOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Unit / Villa / Plot</DialogTitle>
            <DialogDescription>
              Plotted developments and independent villas do not require artificial apartment floors.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUnit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Unit / Plot Number *</Label>
                <Input required placeholder="e.g., 101, A-1204, VILLA-08 or PLOT-12" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Flat / Unit Series *</Label>
                <Input
                  required
                  placeholder="e.g., 01, 02, 1, 2, A"
                  value={unitSeries}
                  onChange={(e) => {
                    const s = e.target.value.trim().toUpperCase();
                    setUnitSeries(s);
                    if (s && unitFloorNo && (!unitNumber || unitNumber.endsWith(s))) {
                      const tCode = unitTowerId ? towers.find((t) => t.id === unitTowerId)?.code : '';
                      const fl = unitFloorNo === '0' ? '' : unitFloorNo;
                      setUnitNumber(tCode ? `${tCode}-${fl}${s}` : `${fl}${s}`);
                    }
                  }}
                />
                <p className="text-[10px] text-muted-foreground">Unique series per floor in this tower/project.</p>
              </div>
              <div className="space-y-1">
                <Label>Unit Type *</Label>
                <Select value={unitTypeVal} onValueChange={(v: any) => setUnitTypeVal(v)}>
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
              {towers.length > 0 && (
                <div className="space-y-1">
                  <Label>Tower / Sector</Label>
                  <Select value={unitTowerId || '__NONE__'} onValueChange={(v) => setUnitTowerId(v === '__NONE__' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NONE__">Direct (No Tower)</SelectItem>
                      {towers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {unitTypeVal !== 'PLOT' && unitTypeVal !== 'VILLA' && (
                <div className="space-y-1">
                  <Label>Floor Number *</Label>
                  <Input
                    type="number"
                    min={0}
                    max={towers.find((t) => t.id === unitTowerId)?.totalFloors || 200}
                    value={unitFloorNo}
                    onChange={(e) => setUnitFloorNo(e.target.value)}
                  />
                  {towers.find((t) => t.id === unitTowerId)?.totalFloors ? (
                    <p className="text-[10px] text-muted-foreground">
                      Max floor: {towers.find((t) => t.id === unitTowerId)?.totalFloors}
                    </p>
                  ) : null}
                </div>
              )}
              <div className="space-y-1">
                <Label>Configuration / BHK *</Label>
                <Input required value={unitBhk} onChange={(e) => setUnitBhk(e.target.value)} placeholder="3 BHK / 2400 Sqft Plot" />
              </div>
              <div className="space-y-1">
                <Label>Facing *</Label>
                <Select value={unitFacing} onValueChange={(v: any) => setUnitFacing(v)}>
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
                <Input required type="number" value={unitSaleable} onChange={(e) => setUnitSaleable(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Carpet Area (sq. ft.) *</Label>
                <Input required type="number" value={unitCarpet} onChange={(e) => setUnitCarpet(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Base Rate per sq. ft. (INR) *</Label>
                <Input required type="number" value={unitBaseRate} onChange={(e) => setUnitBaseRate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Parking Entitlement (Spaces)</Label>
                <Input type="number" min={0} max={10} value={unitParkingEntitled} onChange={(e) => setUnitParkingEntitled(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={unitCorner} onCheckedChange={setUnitCorner} />
                Corner Unit
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={unitPublished} onCheckedChange={setUnitPublished} />
                Publish on Public Portal
              </label>
            </div>
            <DialogFooter>
              <div><Label>Floor plan image (optional, up to 10 MB)</Label><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFloorPlan(e.target.files?.[0] ?? null)} /></div>
              <Button type="submit" disabled={busy}>Create Unit</Button>
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
                    {priceBooks.map((pb) => (
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
                disabled={costSheetGenerating}
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
    </div>
  );
}
