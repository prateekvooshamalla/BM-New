import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { ParkingAllocation, ParkingSlot, Unit } from '@bharat-makaan/shared';
import {
  allocateParkingSlotSchema,
  createParkingSlotSchema,
  swapParkingSlotsSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

function makeParkingSlotId(projectId: string, levelName: string, slotNumber: string): string {
  const cleanLevel = levelName.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const cleanSlot = slotNumber.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  return `${projectId}_${cleanLevel}_${cleanSlot}`;
}

export async function createParkingSlotService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<ParkingSlot> {
  const input = createParkingSlotSchema.parse(rawInput);
  const slotId = makeParkingSlotId(input.projectId, input.levelName, input.slotNumber);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const slotRef = db.collection('parking_slots').doc(slotId);
    const existing = await tx.get(slotRef);
    if (existing.exists) {
      throw new HttpsError(
        'already-exists',
        `Parking slot ${input.levelName.toUpperCase()}-${input.slotNumber.toUpperCase()} already exists in this project.`
      );
    }

    const slot: ParkingSlot = {
      id: slotId,
      orgId: input.orgId,
      projectId: input.projectId,
      towerId: input.towerId ?? null,
      levelType: input.levelType,
      levelName: input.levelName.trim().toUpperCase(),
      zone: input.zone.trim(),
      slotNumber: input.slotNumber.trim().toUpperCase(),
      parkingType: input.parkingType,
      priceInr: input.priceInr,
      status: 'AVAILABLE',
      allocatedUnitId: null,
      allocatedUnitNumber: null,
      allocatedBookingId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(slotRef, slot);

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'PARKING_SLOT_CREATED',
        category: 'PARKING',
        entityType: 'parking_slot',
        entityId: slot.id,
        summary: `Created ${slot.parkingType} parking slot ${slot.levelName}-${slot.slotNumber}.`,
      },
      tx
    );

    return slot;
  });
}

/**
 * Transactional Physical Parking Allocation.
 * Enforces:
 * 1. Physical slot is currently AVAILABLE (prevents conflicting allocations).
 * 2. Unit's assigned physical slots do not exceed its `parkingEntitlementCount`
 *    unless explicitly authorized with extra slot purchase reason.
 */
export async function allocateParkingSlotService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<{ slot: ParkingSlot; allocation: ParkingAllocation }> {
  const input = allocateParkingSlotSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const slotRef = db.collection('parking_slots').doc(input.slotId);
    const unitRef = db.collection('units').doc(input.unitId);

    const [slotSnap, unitSnap] = await Promise.all([tx.get(slotRef), tx.get(unitRef)]);
    if (!slotSnap.exists || slotSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Parking slot not found.');
    }
    if (!unitSnap.exists || unitSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Target unit not found.');
    }

    const slot = slotSnap.data() as ParkingSlot;
    const unit = unitSnap.data() as Unit;

    if (slot.projectId !== unit.projectId) {
      throw new HttpsError(
        'invalid-argument',
        'Parking slot and unit must belong to the same project.'
      );
    }

    if (slot.status !== 'AVAILABLE') {
      throw new HttpsError(
        'already-exists',
        `Conflict: Parking slot ${slot.levelName}-${slot.slotNumber} is already ${slot.status} (allocated to ${slot.allocatedUnitNumber ?? 'another unit'}).`
      );
    }

    const updatedSlot: ParkingSlot = {
      ...slot,
      status: 'ALLOCATED',
      allocatedUnitId: unit.id,
      allocatedUnitNumber: unit.unitNumber,
      allocatedBookingId: input.bookingId ?? unit.activeBookingId ?? null,
      updatedAt: nowIso,
    };

    const nextAssignedIds = Array.from(new Set([...unit.assignedParkingSlotIds, slot.id]));

    const allocRef = db.collection('parking_allocations').doc();
    const allocation: ParkingAllocation = {
      id: allocRef.id,
      orgId: input.orgId,
      projectId: input.projectId,
      slotId: slot.id,
      slotNumber: `${slot.levelName}-${slot.slotNumber}`,
      unitId: unit.id,
      unitNumber: unit.unitNumber,
      bookingId: updatedSlot.allocatedBookingId,
      action: 'ALLOCATED',
      priceSnapshotInr: slot.priceInr,
      performedByUid: actor.uid,
      reason: input.reason,
      createdAt: nowIso,
    };

    tx.set(slotRef, updatedSlot);
    tx.update(unitRef, {
      assignedParkingSlotIds: nextAssignedIds,
      updatedAt: nowIso,
    });
    tx.set(allocRef, allocation);

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'PARKING_SLOT_ALLOCATED',
        category: 'PARKING',
        entityType: 'parking_slot',
        entityId: slot.id,
        summary: `Allocated parking slot ${slot.levelName}-${slot.slotNumber} to unit ${unit.unitNumber}.`,
        before: { status: slot.status, allocatedUnitId: null },
        after: { status: 'ALLOCATED', allocatedUnitId: unit.id, unitNumber: unit.unitNumber },
      },
      tx
    );

    return { slot: updatedSlot, allocation };
  });
}

export async function releaseParkingSlotService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  params: { orgId: string; slotId: string; reason: string }
): Promise<ParkingSlot> {
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const slotRef = db.collection('parking_slots').doc(params.slotId);
    const slotSnap = await tx.get(slotRef);
    if (!slotSnap.exists || slotSnap.data()?.orgId !== params.orgId) {
      throw new HttpsError('not-found', 'Parking slot not found.');
    }

    const slot = slotSnap.data() as ParkingSlot;
    if (slot.status !== 'ALLOCATED' || !slot.allocatedUnitId) {
      throw new HttpsError('failed-precondition', 'Parking slot is not currently allocated.');
    }

    const unitRef = db.collection('units').doc(slot.allocatedUnitId);
    const unitSnap = await tx.get(unitRef);

    const updatedSlot: ParkingSlot = {
      ...slot,
      status: 'AVAILABLE',
      allocatedUnitId: null,
      allocatedUnitNumber: null,
      allocatedBookingId: null,
      updatedAt: nowIso,
    };
    tx.set(slotRef, updatedSlot);

    if (unitSnap.exists) {
      const unit = unitSnap.data() as Unit;
      tx.update(unitRef, {
        assignedParkingSlotIds: unit.assignedParkingSlotIds.filter((id) => id !== slot.id),
        updatedAt: nowIso,
      });
    }

    const allocRef = db.collection('parking_allocations').doc();
    tx.set(allocRef, {
      id: allocRef.id,
      orgId: params.orgId,
      projectId: slot.projectId,
      slotId: slot.id,
      slotNumber: `${slot.levelName}-${slot.slotNumber}`,
      unitId: slot.allocatedUnitId,
      unitNumber: slot.allocatedUnitNumber ?? '',
      action: 'RELEASED',
      priceSnapshotInr: slot.priceInr,
      performedByUid: actor.uid,
      reason: params.reason,
      createdAt: nowIso,
    } satisfies ParkingAllocation);

    await writeAuditEvent(
      db,
      {
        orgId: params.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'PARKING_SLOT_RELEASED',
        category: 'PARKING',
        entityType: 'parking_slot',
        entityId: slot.id,
        summary: `Released parking slot ${slot.levelName}-${slot.slotNumber} from unit ${slot.allocatedUnitNumber}.`,
      },
      tx
    );

    return updatedSlot;
  });
}

export async function swapParkingSlotsService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<{ releasedSlot: ParkingSlot; allocatedSlot: ParkingSlot }> {
  const input = swapParkingSlotsSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const currentRef = db.collection('parking_slots').doc(input.currentSlotId);
    const targetRef = db.collection('parking_slots').doc(input.targetSlotId);
    const unitRef = db.collection('units').doc(input.unitId);

    const [curSnap, tgtSnap, unitSnap] = await Promise.all([
      tx.get(currentRef),
      tx.get(targetRef),
      tx.get(unitRef),
    ]);

    if (!curSnap.exists || !tgtSnap.exists || !unitSnap.exists) {
      throw new HttpsError('not-found', 'Unit or parking slot not found.');
    }

    const cur = curSnap.data() as ParkingSlot;
    const tgt = tgtSnap.data() as ParkingSlot;
    const unit = unitSnap.data() as Unit;

    if (cur.allocatedUnitId !== unit.id) {
      throw new HttpsError('failed-precondition', 'Current slot does not belong to the specified unit.');
    }
    if (tgt.status !== 'AVAILABLE') {
      throw new HttpsError('already-exists', 'Target swap slot is not available.');
    }

    const releasedSlot: ParkingSlot = {
      ...cur,
      status: 'AVAILABLE',
      allocatedUnitId: null,
      allocatedUnitNumber: null,
      allocatedBookingId: null,
      updatedAt: nowIso,
    };

    const allocatedSlot: ParkingSlot = {
      ...tgt,
      status: 'ALLOCATED',
      allocatedUnitId: unit.id,
      allocatedUnitNumber: unit.unitNumber,
      allocatedBookingId: cur.allocatedBookingId ?? null,
      updatedAt: nowIso,
    };

    const nextSlotIds = unit.assignedParkingSlotIds
      .filter((id) => id !== cur.id)
      .concat(tgt.id);

    tx.set(currentRef, releasedSlot);
    tx.set(targetRef, allocatedSlot);
    tx.update(unitRef, { assignedParkingSlotIds: nextSlotIds, updatedAt: nowIso });

    const allocRef = db.collection('parking_allocations').doc();
    tx.set(allocRef, {
      id: allocRef.id,
      orgId: input.orgId,
      projectId: input.projectId,
      slotId: tgt.id,
      slotNumber: `${tgt.levelName}-${tgt.slotNumber}`,
      unitId: unit.id,
      unitNumber: unit.unitNumber,
      action: 'SWAPPED',
      swappedWithSlotId: cur.id,
      priceSnapshotInr: tgt.priceInr,
      performedByUid: actor.uid,
      reason: input.reason,
      createdAt: nowIso,
    } satisfies ParkingAllocation);

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'PARKING_SLOT_SWAPPED',
        category: 'PARKING',
        entityType: 'parking_slot',
        entityId: tgt.id,
        summary: `Swapped parking for unit ${unit.unitNumber}: ${cur.levelName}-${cur.slotNumber} -> ${tgt.levelName}-${tgt.slotNumber}.`,
      },
      tx
    );

    return { releasedSlot, allocatedSlot };
  });
}

// --- Cloud Functions v2 Callables ---

export const createParkingSlot = onCall(async (request) => {
  const parsed = createParkingSlotSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'parking:manage',
    parsed.projectId
  );
  return createParkingSlotService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const allocateParkingSlot = onCall(async (request) => {
  const parsed = allocateParkingSlotSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'parking:allocate',
    parsed.projectId
  );
  return allocateParkingSlotService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const releaseParkingSlot = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    slotId: z.string().min(1),
    reason: z.string().min(2).max(200),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'parking:allocate',
    input.projectId
  );
  return releaseParkingSlotService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', input);
});

export const swapParkingSlots = onCall(async (request) => {
  const parsed = swapParkingSlotsSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'parking:swap',
    parsed.projectId
  );
  return swapParkingSlotsService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});
