import * as React from 'react';
import { ArrowLeftRight, CarFront, Link2, Plus, Unlink } from 'lucide-react';
import {
  formatInr,
  type ParkingAllocation,
  type ParkingLevelType,
  type ParkingSlot,
  type ParkingSlotType,
  type Unit,
} from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable } from '@/components/shared/DataTable';
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

const SLOT_TYPES: ParkingSlotType[] = ['STANDARD', 'TANDEM', 'MECHANICAL', 'EV', 'ACCESSIBLE'];
const LEVEL_TYPES: ParkingLevelType[] = ['BASEMENT', 'PODIUM', 'SURFACE', 'STILT'];

export function ParkingPage() {
  const { activeOrgId, projects, activeProjectId, selectProject } = useTenantStore();
  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;

  const [slots, setSlots] = React.useState<ParkingSlot[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [allocations, setAllocations] = React.useState<ParkingAllocation[]>([]);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Add Slot Modal
  const [addOpen, setAddOpen] = React.useState(false);
  const [levelType, setLevelType] = React.useState<ParkingLevelType>('BASEMENT');
  const [levelName, setLevelName] = React.useState('B1');
  const [zone, setZone] = React.useState('Zone A');
  const [slotNumber, setSlotNumber] = React.useState('');
  const [parkingType, setParkingType] = React.useState<ParkingSlotType>('STANDARD');
  const [priceInr, setPriceInr] = React.useState('450000');

  // Allocate & Swap Modals
  const [allocateTargetSlot, setAllocateTargetSlot] = React.useState<ParkingSlot | null>(null);
  const [selectedUnitId, setSelectedUnitId] = React.useState('');
  const [allocReason, setAllocReason] = React.useState('Booking parking assignment');

  const [swapSourceSlot, setSwapSourceSlot] = React.useState<ParkingSlot | null>(null);
  const [swapTargetSlotId, setSwapTargetSlotId] = React.useState('');
  const [swapReason, setSwapReason] = React.useState('');

  React.useEffect(() => {
    if (!activeOrgId || !currentProjectId) {
      setSlots([]);
      setUnits([]);
      setAllocations([]);
      return;
    }

    const unsubSlots = subscribeTenantCollection<ParkingSlot>({
      orgId: activeOrgId,
      collectionName: 'parking_slots',
      projectId: currentProjectId,
      onData: setSlots,
    });

    const unsubUnits = subscribeTenantCollection<Unit>({
      orgId: activeOrgId,
      collectionName: 'units',
      projectId: currentProjectId,
      onData: setUnits,
    });

    const unsubAlloc = subscribeTenantCollection<ParkingAllocation>({
      orgId: activeOrgId,
      collectionName: 'parking_allocations',
      projectId: currentProjectId,
      sort: sortDescByIso<ParkingAllocation>('createdAt'),
      onData: setAllocations,
    });

    return () => {
      unsubSlots();
      unsubUnits();
      unsubAlloc();
    };
  }, [activeOrgId, currentProjectId]);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId) return;
    setBusy(true);
    try {
      await callBackendFunction('createParkingSlot', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        levelType,
        levelName,
        zone,
        slotNumber,
        parkingType,
        priceInr: Number(priceInr),
      });
      setAddOpen(false);
      setSlotNumber('');
      setBanner(`Created physical parking slot ${levelName.toUpperCase()}-${slotNumber.toUpperCase()}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to create slot.');
    } finally {
      setBusy(false);
    }
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId || !allocateTargetSlot || !selectedUnitId) return;
    setBusy(true);
    try {
      await callBackendFunction('allocateParkingSlot', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        slotId: allocateTargetSlot.id,
        unitId: selectedUnitId,
        reason: allocReason,
      });
      setAllocateTargetSlot(null);
      setSelectedUnitId('');
      setBanner('Parking slot allocated transactionally.');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Allocation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRelease = async (slot: ParkingSlot) => {
    if (!activeOrgId || !currentProjectId) return;
    setBusy(true);
    try {
      await callBackendFunction('releaseParkingSlot', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        slotId: slot.id,
        reason: 'Authorized manual slot release',
      });
      setBanner(`Released slot ${slot.levelName}-${slot.slotNumber}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Release failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !activeOrgId ||
      !currentProjectId ||
      !swapSourceSlot ||
      !swapSourceSlot.allocatedUnitId ||
      !swapTargetSlotId
    )
      return;
    setBusy(true);
    try {
      await callBackendFunction('swapParkingSlots', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        currentSlotId: swapSourceSlot.id,
        targetSlotId: swapTargetSlotId,
        unitId: swapSourceSlot.allocatedUnitId,
        reason: swapReason,
      });
      setSwapSourceSlot(null);
      setSwapTargetSlotId('');
      setSwapReason('');
      setBanner('Parking slots swapped atomically.');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Swap failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId || projects.length === 0) {
    return (
      <EmptyState
        icon={CarFront}
        title="No projects yet. Create your first project."
        description="Configure a project first to manage basement, podium, EV, tandem, and mechanical parking inventory."
      />
    );
  }

  const availableSlots = slots.filter((s) => s.status === 'AVAILABLE');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Independent Physical Inventory"
        title="Parking Management"
        description="Distinguish unit parking entitlements from physical basement/podium slot allocations with conflict-free swaps."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={currentProjectId ?? ''}
              onValueChange={(val) => selectProject(val)}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select Project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PermissionGate permission="parking:manage" projectId={currentProjectId}>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Parking Slot
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

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Total Physical Slots</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{slots.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Available Slots</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-emerald-700">
            {availableSlots.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Allocated Slots</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-primary">
            {slots.filter((s) => s.status === 'ALLOCATED').length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">
              Unassigned Unit Entitlements
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {units.reduce(
              (acc, u) =>
                acc + Math.max(0, u.parkingEntitlementCount - u.assignedParkingSlotIds.length),
              0
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="slots">
        <TabsList>
          <TabsTrigger value="slots">Physical Slots ({slots.length})</TabsTrigger>
          <TabsTrigger value="entitlements">Unit Entitlement vs Allocation ({units.length})</TabsTrigger>
          <TabsTrigger value="history">Allocation History ({allocations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="slots">
          {slots.length === 0 ? (
            <EmptyState
              icon={CarFront}
              title="No parking slots configured. Create basement, podium or surface slots."
              description="Add Standard, Tandem, Mechanical, EV, or Accessible parking bays with unique project/level identifiers."
              actionLabel="Add Parking Slot"
              onAction={() => setAddOpen(true)}
            />
          ) : (
            <DataTable
              data={slots}
              searchPlaceholder="Search slot number, level, or allocated unit..."
              columns={[
                {
                  id: 'slotCode',
                  header: 'Slot Code',
                  cell: ({ row }) => (
                    <span className="font-semibold">
                      {row.original.levelName}-{row.original.slotNumber}
                    </span>
                  ),
                },
                { accessorKey: 'levelType', header: 'Level Type' },
                { accessorKey: 'zone', header: 'Zone' },
                { accessorKey: 'parkingType', header: 'Slot Type' },
                {
                  accessorKey: 'priceInr',
                  header: 'Slot Price',
                  cell: ({ row }) => formatInr(row.original.priceInr),
                },
                {
                  accessorKey: 'status',
                  header: 'Status',
                  cell: ({ row }) => <StatusBadge status={row.original.status} />,
                },
                {
                  accessorKey: 'allocatedUnitNumber',
                  header: 'Allocated Unit',
                  cell: ({ row }) => row.original.allocatedUnitNumber || '—',
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  cell: ({ row }) => {
                    const s = row.original;
                    return (
                      <div className="flex items-center gap-1.5">
                        {s.status === 'AVAILABLE' && (
                          <PermissionGate permission="parking:allocate" projectId={currentProjectId}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAllocateTargetSlot(s)}
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              Allocate
                            </Button>
                          </PermissionGate>
                        )}
                        {s.status === 'ALLOCATED' && (
                          <>
                            <PermissionGate permission="parking:swap" projectId={currentProjectId}>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSwapSourceSlot(s)}
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" />
                                Swap
                              </Button>
                            </PermissionGate>
                            <PermissionGate
                              permission="parking:allocate"
                              projectId={currentProjectId}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => handleRelease(s)}
                              >
                                <Unlink className="h-3.5 w-3.5" />
                                Release
                              </Button>
                            </PermissionGate>
                          </>
                        )}
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </TabsContent>

        <TabsContent value="entitlements">
          <DataTable
            data={units}
            searchPlaceholder="Search unit number..."
            emptyMessage="No units added yet."
            columns={[
              { accessorKey: 'unitNumber', header: 'Unit #' },
              { accessorKey: 'bhk', header: 'Config' },
              { accessorKey: 'parkingEntitlementCount', header: 'Entitled Spaces' },
              {
                id: 'assignedCount',
                header: 'Physical Slots Assigned',
                cell: ({ row }) => row.original.assignedParkingSlotIds.length,
              },
              {
                id: 'pendingSpaces',
                header: 'Unassigned Balance',
                cell: ({ row }) => {
                  const diff =
                    row.original.parkingEntitlementCount -
                    row.original.assignedParkingSlotIds.length;
                  return (
                    <span className={diff > 0 ? 'font-semibold text-amber-700' : 'text-emerald-700'}>
                      {diff > 0 ? `${diff} Unassigned` : 'Fully Assigned'}
                    </span>
                  );
                },
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="history">
          <DataTable
            data={allocations}
            searchPlaceholder="Search history by slot or unit..."
            emptyMessage="No parking allocation transactions recorded yet."
            columns={[
              { accessorKey: 'slotNumber', header: 'Slot' },
              { accessorKey: 'unitNumber', header: 'Unit' },
              {
                accessorKey: 'action',
                header: 'Action',
                cell: ({ row }) => <StatusBadge status={row.original.action} />,
              },
              { accessorKey: 'reason', header: 'Reason' },
              {
                accessorKey: 'createdAt',
                header: 'Timestamp',
                cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* Create Parking Slot Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Physical Parking Slot</DialogTitle>
            <DialogDescription>
              Each slot receives a unique identifier within the project and level scheme.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSlot} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Level Type *</Label>
                <Select value={levelType} onValueChange={(v: any) => setLevelType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEVEL_TYPES.map((lt) => (
                      <SelectItem key={lt} value={lt}>{lt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Level Code (e.g. B1, P2) *</Label>
                <Input required value={levelName} onChange={(e) => setLevelName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Zone *</Label>
                <Input required value={zone} onChange={(e) => setZone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Slot Number *</Label>
                <Input required placeholder="e.g. 104" value={slotNumber} onChange={(e) => setSlotNumber(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Parking Type *</Label>
                <Select value={parkingType} onValueChange={(v: any) => setParkingType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SLOT_TYPES.map((st) => (
                      <SelectItem key={st} value={st}>{st}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Slot Price (INR) *</Label>
                <Input required type="number" value={priceInr} onChange={(e) => setPriceInr(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Create Slot</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Allocate Parking Slot Dialog */}
      <Dialog
        open={Boolean(allocateTargetSlot)}
        onOpenChange={(o) => !o && setAllocateTargetSlot(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Allocate Slot {allocateTargetSlot?.levelName}-{allocateTargetSlot?.slotNumber}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAllocate} className="space-y-3">
            <div className="space-y-1">
              <Label>Assign to Unit *</Label>
              <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                <SelectTrigger><SelectValue placeholder="Choose unit" /></SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.unitNumber} ({u.assignedParkingSlotIds.length}/{u.parkingEntitlementCount}{' '}
                      assigned)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Input required value={allocReason} onChange={(e) => setAllocReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !selectedUnitId}>
                Confirm Allocation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Swap Parking Slots Dialog */}
      <Dialog open={Boolean(swapSourceSlot)} onOpenChange={(o) => !o && setSwapSourceSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Swap Slot {swapSourceSlot?.levelName}-{swapSourceSlot?.slotNumber} (Unit{' '}
              {swapSourceSlot?.allocatedUnitNumber})
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSwap} className="space-y-3">
            <div className="space-y-1">
              <Label>New Available Slot *</Label>
              <Select value={swapTargetSlotId} onValueChange={setSwapTargetSlotId}>
                <SelectTrigger><SelectValue placeholder="Select available slot" /></SelectTrigger>
                <SelectContent>
                  {availableSlots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.levelName}-{s.slotNumber} ({s.parkingType} • {formatInr(s.priceInr)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Swap Reason *</Label>
              <Input
                required
                placeholder="Customer requested EV bay / closer lift access"
                value={swapReason}
                onChange={(e) => setSwapReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !swapTargetSlotId}>
                Execute Atomic Swap
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
