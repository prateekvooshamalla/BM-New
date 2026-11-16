import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  Building2,
  Calculator,
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
  Unlock,
} from 'lucide-react';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import {
  formatAreaSqft,
  formatInr,
  formatInrCompact,
  type AuditEvent,
  type FacingDirection,
  type Floor,
  type ProjectPhase,
  type Tower,
  type Unit,
  type UnitStatus,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
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

  // Bulk Generator Form
  const [bulkTowerId, setBulkTowerId] = React.useState('');
  const [bulkStartFloor, setBulkStartFloor] = React.useState('1');
  const [bulkEndFloor, setBulkEndFloor] = React.useState('10');
  const [bulkUnitsPerFloor, setBulkUnitsPerFloor] = React.useState('4');
  const [bulkBhk, setBulkBhk] = React.useState('3 BHK');
  const [bulkSaleable, setBulkSaleable] = React.useState('1850');
  const [bulkCarpet, setBulkCarpet] = React.useState('1295');
  const [bulkRate, setBulkRate] = React.useState('8800');

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

    const unsubPhases = onSnapshot(
      query(
        collection(db, 'project_phases'),
        where('orgId', '==', activeOrgId),
        where('projectId', '==', currentProjectId)
      ),
      (s) => setPhases(s.docs.map((d) => d.data() as ProjectPhase))
    );

    const unsubTowers = onSnapshot(
      query(
        collection(db, 'towers'),
        where('orgId', '==', activeOrgId),
        where('projectId', '==', currentProjectId)
      ),
      (s) => setTowers(s.docs.map((d) => d.data() as Tower))
    );

    const unsubFloors = onSnapshot(
      query(
        collection(db, 'floors'),
        where('orgId', '==', activeOrgId),
        where('projectId', '==', currentProjectId)
      ),
      (s) => setFloors(s.docs.map((d) => d.data() as Floor))
    );

    const unsubUnits = onSnapshot(
      query(
        collection(db, 'units'),
        where('orgId', '==', activeOrgId),
        where('projectId', '==', currentProjectId)
      ),
      (s) => setUnits(s.docs.map((d) => d.data() as Unit))
    );

    return () => {
      unsubPhases();
      unsubTowers();
      unsubFloors();
      unsubUnits();
    };
  }, [activeOrgId, currentProjectId]);

  // Subscribe to audit history when a unit drawer is opened
  React.useEffect(() => {
    if (!activeOrgId || !selectedUnit) {
      setUnitAuditHistory([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, 'audit_events'),
        where('orgId', '==', activeOrgId),
        where('entityId', '==', selectedUnit.id),
        orderBy('createdAt', 'desc')
      ),
      (s) => setUnitAuditHistory(s.docs.map((d) => d.data() as AuditEvent)),
      () => setUnitAuditHistory([])
    );
    return () => unsub();
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
      const created = await callBackendFunction<any, { id: string; name: string }>(
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
      selectProject(created.id);
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
      await callBackendFunction('createPhase', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        name: phaseName,
        code: phaseCode,
        sequence: phases.length + 1,
        constructionStatus: 'UNDER_CONSTRUCTION',
      });
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
      await callBackendFunction('createTower', {
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
    try {
      const selectedTowerObj = towers.find((t) => t.id === unitTowerId);
      await callBackendFunction('createUnit', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        towerId: unitTowerId || null,
        towerName: selectedTowerObj?.name,
        floorNumber: unitTypeVal === 'PLOT' || unitTypeVal === 'VILLA' ? 0 : Number(unitFloorNo),
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
      });
      setCreateUnitOpen(false);
      setUnitNumber('');
      setBannerMsg(`Added unit ${unitNumber.toUpperCase()} to inventory.`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Failed to create unit.');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId || !bulkTowerId) return;
    const tObj = towers.find((t) => t.id === bulkTowerId);
    if (!tObj) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<any, { createdCount: number }>(
        'bulkGenerateTowerUnits',
        {
          orgId: activeOrgId,
          projectId: currentProjectId,
          towerId: tObj.id,
          towerCode: tObj.code,
          towerName: tObj.name,
          startFloor: Number(bulkStartFloor),
          endFloor: Number(bulkEndFloor),
          unitsPerFloor: Number(bulkUnitsPerFloor),
          bhk: bulkBhk,
          saleableAreaSqft: Number(bulkSaleable),
          carpetAreaSqft: Number(bulkCarpet),
          facing: 'EAST',
          baseRatePerSqft: Number(bulkRate),
          parkingEntitlementCount: 2,
        }
      );
      setBulkWizardOpen(false);
      setBannerMsg(`Generated ${res.createdCount} units across ${tObj.name}.`);
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
    setBusy(true);
    try {
      const updated = await callBackendFunction<any, Unit>('transitionUnitStatus', {
        orgId: activeOrgId,
        unitId: unit.id,
        targetStatus,
        action,
        holdDurationHours: 48,
        reason: transitionReason || `Authorized ${action} action`,
      });
      setSelectedUnit(updated);
      setTransitionReason('');
      setBannerMsg(`Unit ${unit.unitNumber} updated to ${targetStatus}.`);
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Status transition rejected.');
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
      <Dialog open={Boolean(selectedUnit)} onOpenChange={(o) => !o && setSelectedUnit(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selectedUnit && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between pr-6">
                  <DialogTitle className="text-lg">
                    Unit {selectedUnit.unitNumber} — {selectedUnit.bhk} ({selectedUnit.unitType})
                  </DialogTitle>
                  <StatusBadge status={selectedUnit.status} />
                </div>
                <DialogDescription>
                  Unit ID: {selectedUnit.id} • {selectedUnit.towerName || 'Direct Plot/Villa'} •
                  Floor {selectedUnit.floorNumber}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-3 text-xs rounded-lg border border-border bg-secondary/40 p-4">
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
                <div>
                  <span className="text-muted-foreground">Calculated Price:</span>
                  <div className="font-bold text-primary text-sm">
                    {formatInr(selectedUnit.calculatedTotalPrice)}
                  </div>
                </div>
              </div>

              {/* Status Workflow Actions */}
              <div className="space-y-2.5 rounded-lg border border-border p-3.5">
                <div className="text-xs font-semibold text-foreground">
                  Inventory Workflow & Cost Sheet Actions
                </div>
                <Input
                  placeholder="Optional / required reason for hold, release, or cancellation..."
                  value={transitionReason}
                  onChange={(e) => setTransitionReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const uid = selectedUnit.id;
                      setSelectedUnit(null);
                      navigate(`/app/pricing?tab=quotations&unitId=${uid}`);
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
                  <Input type="number" min={0} value={unitFloorNo} onChange={(e) => setUnitFloorNo(e.target.value)} />
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
              <Button type="submit" disabled={busy}>Create Unit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Generate Units Wizard */}
      <Dialog open={bulkWizardOpen} onOpenChange={setBulkWizardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Generate Tower Inventory</DialogTitle>
            <DialogDescription>
              Generate standardized apartments across a range of floors in a single atomic batch.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkGenerate} className="space-y-3">
            <div className="space-y-1">
              <Label>Target Tower *</Label>
              <Select value={bulkTowerId} onValueChange={setBulkTowerId}>
                <SelectTrigger><SelectValue placeholder="Choose tower" /></SelectTrigger>
                <SelectContent>
                  {towers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Start Floor</Label>
                <Input type="number" min={1} value={bulkStartFloor} onChange={(e) => setBulkStartFloor(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End Floor</Label>
                <Input type="number" min={1} value={bulkEndFloor} onChange={(e) => setBulkEndFloor(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Units / Floor</Label>
                <Input type="number" min={1} max={16} value={bulkUnitsPerFloor} onChange={(e) => setBulkUnitsPerFloor(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>BHK</Label>
                <Input value={bulkBhk} onChange={(e) => setBulkBhk(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Base Rate / sq.ft.</Label>
                <Input type="number" value={bulkRate} onChange={(e) => setBulkRate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Saleable Area (sq.ft.)</Label>
                <Input type="number" value={bulkSaleable} onChange={(e) => setBulkSaleable(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Carpet Area (sq.ft.)</Label>
                <Input type="number" value={bulkCarpet} onChange={(e) => setBulkCarpet(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !bulkTowerId}>
                {busy ? 'Generating...' : 'Generate Inventory'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
