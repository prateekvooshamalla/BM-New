import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';
import {
  toMinorUnits,
  validateUnitTransition,
  type Project,
  type ProjectStats,
  type Unit,
  type UnitStatus,
} from '@bharat-makaan/shared';
import {
  createUnitSchema,
  unitStatusTransitionSchema,
  unitTypeSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';
import { ensureBaselinePriceBookForProject } from '../pricing';

function statusStatField(status: UnitStatus): keyof ProjectStats {
  switch (status) {
    case 'AVAILABLE':
      return 'availableUnits';
    case 'ON_HOLD':
      return 'onHoldUnits';
    case 'RESERVED':
      return 'reservedUnits';
    case 'BOOKED':
      return 'bookedUnits';
    case 'AGREEMENT':
      return 'agreementUnits';
    case 'REGISTERED':
      return 'registeredUnits';
  }
}

export async function createUnitService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Unit> {
  const input = createUnitSchema.parse(rawInput);
  if (input.floorPlanStoragePath && !input.floorPlanStoragePath.startsWith(`organizations/${input.orgId}/projects/${input.projectId}/floorplans/`)) {
    throw new HttpsError('invalid-argument', 'Floor plan must belong to this project.');
  }
  const nowIso = new Date().toISOString();

  const createdUnit = await db.runTransaction(async (tx) => {
    const projRef = db.collection('projects').doc(input.projectId);
    const projSnap = await tx.get(projRef);
    if (!projSnap.exists || projSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Project not found.');
    }
    const proj = projSnap.data() as Project;

    const dupSnap = await tx.get(
      db
        .collection('units')
        .where('orgId', '==', input.orgId)
        .where('projectId', '==', input.projectId)
        .where('unitNumber', '==', input.unitNumber.trim().toUpperCase())
        .limit(1)
    );
    if (!dupSnap.empty) {
      throw new HttpsError(
        'already-exists',
        `Unit "${input.unitNumber.trim().toUpperCase()}" already exists in this project.`
      );
    }

    const currencyCode = input.currencyCode ?? proj.currencyCode ?? 'INR';
    const areaUnit = input.areaUnit ?? proj.areaUnit ?? 'SQFT';
    const pricingMode = input.pricingMode ?? 'PER_AREA';
    const primaryArea = input.primaryArea ?? input.saleableAreaSqft;
    const secondaryArea = input.secondaryArea ?? input.carpetAreaSqft;
    const basePrice =
      pricingMode === 'BASE_UNIT_PRICE'
        ? Math.round((input.baseUnitPrice ?? primaryArea * input.baseRatePerSqft) * 100) / 100
        : Math.round(primaryArea * input.baseRatePerSqft * 100) / 100;
    const unitRef = db.collection('units').doc();

    const unit: Unit = {
      id: unitRef.id,
      orgId: input.orgId,
      projectId: input.projectId,
      phaseId: input.phaseId ?? null,
      towerId: input.towerId ?? null,
      towerName: input.towerName,
      floorId: input.floorId ?? null,
      floorNumber: input.floorNumber,
      unitNumber: input.unitNumber.trim().toUpperCase(),
      unitType: input.unitType,
      inventorySource: input.inventorySource ?? 'PRIMARY_DEVELOPER',
      bhk: input.bhk.trim(),
      currencyCode,
      areaUnit,
      primaryArea,
      secondaryArea,
      saleableAreaSqft: input.saleableAreaSqft,
      carpetAreaSqft: input.carpetAreaSqft,
      plotAreaSqft: input.plotAreaSqft,
      facing: input.facing,
      viewType: input.viewType,
      isCorner: input.isCorner,
      balconiesCount: input.balconiesCount,
      parkingEntitlementCount: input.parkingEntitlementCount,
      assignedParkingSlotIds: [],
      pricingMode,
      baseUnitPrice: input.baseUnitPrice,
      baseRatePerSqft: input.baseRatePerSqft,
      floorRiseAmount: 0,
      premiumChargesAmount: 0,
      calculatedTotalPrice: basePrice,
      calculatedTotalMinor: toMinorUnits(basePrice, currencyCode),
      status: 'AVAILABLE',
      holdExpiresAt: null,
      heldByUid: null,
      heldForLeadId: null,
      activeBookingId: null,
      floorPlanVersionId: null,
      floorPlanStoragePath: input.floorPlanStoragePath ?? null,
      isPublicPublished: input.isPublicPublished,
      listingMode: input.listingMode,
      monthlyRentInr: input.monthlyRentInr,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(unitRef, unit);

    const nextStartingPrice =
      !proj.startingPriceInr || (basePrice > 0 && basePrice < proj.startingPriceInr)
        ? basePrice
        : proj.startingPriceInr;

    tx.update(projRef, {
      totalUnits: proj.totalUnits + 1,
      startingPriceInr: nextStartingPrice,
      'stats.totalUnits': (proj.stats?.totalUnits ?? 0) + 1,
      'stats.availableUnits': (proj.stats?.availableUnits ?? 0) + 1,
      updatedAt: nowIso,
    });

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'UNIT_CREATED',
        category: 'INVENTORY',
        entityType: 'unit',
        entityId: unit.id,
        summary: `Created unit ${unit.unitNumber} (${unit.bhk}, ${unit.saleableAreaSqft} sq.ft.) in ${proj.name}.`,
        after: {
          unitNumber: unit.unitNumber,
          bhk: unit.bhk,
          saleableAreaSqft: unit.saleableAreaSqft,
          status: unit.status,
        },
      },
      tx
    );

    return unit;
  });

  await ensureBaselinePriceBookForProject(db, {
    orgId: input.orgId,
    projectId: input.projectId,
    baseRatePerSqft: input.baseRatePerSqft,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
  }).catch(() => {
    // Non-blocking baseline pricing initialization
  });

  return createdUnit;
}

/**
 * Atomic Firestore Transaction for Unit Status Changes.
 * Prevents concurrent conflicting holds/reservations/bookings.
 */
export async function transitionUnitStatusService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Unit> {
  const input = unitStatusTransitionSchema.parse(rawInput);
  const now = new Date();
  const nowIso = now.toISOString();

  return db.runTransaction(async (tx) => {
    const unitRef = db.collection('units').doc(input.unitId);
    const unitSnap = await tx.get(unitRef);
    if (!unitSnap.exists || unitSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Unit not found in organization.');
    }

    const unit = unitSnap.data() as Unit;
    const rule = validateUnitTransition(unit.status, input.targetStatus, input.action);
    if (!rule) {
      throw new HttpsError(
        'failed-precondition',
        `Conflict or invalid transition: Unit ${unit.unitNumber} is currently ${unit.status} and cannot transition to ${input.targetStatus} via ${input.action}.`
      );
    }

    if (rule.requiresReason && (!input.reason || input.reason.trim().length < 3)) {
      throw new HttpsError(
        'invalid-argument',
        `A valid reason is required for action ${input.action}.`
      );
    }

    // Prevent another agent from hijacking an active non-expired hold unless they hold release/reserve override
    if (
      unit.status === 'ON_HOLD' &&
      input.action === 'RESERVE' &&
      unit.heldByUid &&
      unit.heldByUid !== actor.uid &&
      !actor.isSuperAdmin &&
      actorRole !== 'BUILDER_ADMIN' &&
      actorRole !== 'SALES_MANAGER' &&
      actorRole !== 'PROJECT_DIRECTOR' &&
      actorRole !== 'INVENTORY_MANAGER'
    ) {
      throw new HttpsError(
        'aborted',
        `Unit ${unit.unitNumber} is currently held by another representative.`
      );
    }

    const projRef = db.collection('projects').doc(unit.projectId);
    if (input.action === 'HOLD' || input.action === 'RESERVE') {
      const leadId = input.leadId ?? unit.heldForLeadId;
      if (leadId) {
        const lead = await tx.get(db.collection('leads').doc(leadId));
        if (!lead.exists || lead.data()?.orgId !== input.orgId) {
          throw new HttpsError('permission-denied', 'Customer must belong to this organization.');
        }
      }
      if ((input.holdAdvanceAmount ?? 0) > 0 && !leadId) throw new HttpsError('invalid-argument', 'Select a customer for the advance.');
      if ((input.holdAdvanceAmount ?? 0) > 0 && !input.holdPaymentReference?.trim()) {
        throw new HttpsError('invalid-argument', 'Enter a receipt or payment reference for the advance.');
      }
    }
    const projSnap = await tx.get(projRef);

    const holdHours = input.holdDurationHours ?? 48;
    const holdExpiresAt =
      input.targetStatus === 'ON_HOLD'
        ? new Date(now.getTime() + holdHours * 60 * 60 * 1000).toISOString()
        : null;

    const updatedUnit: Unit = {
      ...unit,
      status: input.targetStatus,
      holdAdvanceAmount: input.targetStatus === 'AVAILABLE' ? 0 : (input.holdAdvanceAmount ?? unit.holdAdvanceAmount ?? 0),
      holdPaymentReference: input.targetStatus === 'AVAILABLE' ? null : (input.holdPaymentReference ?? unit.holdPaymentReference ?? null),
      holdExpiresAt,
      heldByUid:
        input.targetStatus === 'ON_HOLD' || input.targetStatus === 'RESERVED'
          ? actor.uid
          : null,
      heldForLeadId:
        input.targetStatus === 'ON_HOLD' || input.targetStatus === 'RESERVED'
          ? (input.leadId ?? unit.heldForLeadId ?? null)
          : null,
      activeBookingId:
        input.targetStatus === 'AVAILABLE' ? null : unit.activeBookingId,
      updatedAt: nowIso,
    };

    tx.set(unitRef, updatedUnit);

    if (projSnap.exists) {
      const proj = projSnap.data() as Project;
      const fromKey = statusStatField(unit.status);
      const toKey = statusStatField(input.targetStatus);
      if (fromKey !== toKey) {
        tx.update(projRef, {
          [`stats.${fromKey}`]: Math.max(0, (proj.stats?.[fromKey] ?? 1) - 1),
          [`stats.${toKey}`]: (proj.stats?.[toKey] ?? 0) + 1,
          updatedAt: nowIso,
        });
      }
    }

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: `UNIT_STATUS_${input.action}`,
        category: 'INVENTORY',
        entityType: 'unit',
        entityId: unit.id,
        summary: `Unit ${unit.unitNumber}: ${unit.status} -> ${input.targetStatus} (${input.action}).`,
        before: { status: unit.status, heldByUid: unit.heldByUid },
        after: {
          status: updatedUnit.status,
          heldByUid: updatedUnit.heldByUid,
          holdExpiresAt: updatedUnit.holdExpiresAt,
          heldForLeadId: updatedUnit.heldForLeadId,
          advanceAmount: updatedUnit.holdAdvanceAmount,
          paymentReference: updatedUnit.holdPaymentReference,
          reason: input.reason ?? null,
        },
      },
      tx
    );

    return updatedUnit;
  });
}

// --- Cloud Functions v2 Callables & Scheduled Jobs ---

export const createUnit = onCall(async (request) => {
  const parsed = createUnitSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'inventory:manage',
    parsed.projectId
  );
  return createUnitService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

const bulkGenerateUnitsSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  towerId: z.string().nullable().optional(),
  towerCode: z.string().min(1),
  towerName: z.string().optional(),
  unitType: unitTypeSchema.default('APARTMENT'),
  startFloor: z.coerce.number().int().min(0).max(200),
  endFloor: z.coerce.number().int().min(0).max(200),
  unitsPerFloor: z.coerce.number().int().min(1).max(50),
  floorPlanStoragePath: z.string().max(500).optional(),
  startUnitNumber: z.coerce.number().int().min(1).max(99).default(1),
  bhk: z.string().min(1),
  saleableAreaSqft: z.coerce.number().positive(),
  carpetAreaSqft: z.coerce.number().positive(),
  facing: z.enum([
    'EAST',
    'WEST',
    'NORTH',
    'SOUTH',
    'NORTH_EAST',
    'NORTH_WEST',
    'SOUTH_EAST',
    'SOUTH_WEST',
  ]).default('EAST'),
  baseRatePerSqft: z.coerce.number().nonnegative(),
  parkingEntitlementCount: z.coerce.number().int().min(0).max(20).default(1),
  isCorner: z.boolean().optional(),
  isPublicPublished: z.boolean().default(false),
  listingMode: z.enum(['BUY', 'RENT', 'LEASE']).default('BUY'),
});

export async function bulkGenerateTowerUnitsService(db: Firestore, actor: AuthenticatedActor, actorRole: string, rawInput: unknown) {
  const input = bulkGenerateUnitsSchema.parse(rawInput);
  if (input.endFloor < input.startFloor) {
    throw new HttpsError('invalid-argument', 'End floor must be >= start floor.');
  }
  const totalCount = (input.endFloor - input.startFloor + 1) * input.unitsPerFloor;
  if (totalCount > 240) {
    throw new HttpsError('invalid-argument', 'Maximum 240 units per bulk generation batch.');
  }

  if (input.startUnitNumber + input.unitsPerFloor - 1 > 99) {
    throw new HttpsError('invalid-argument', 'Flat numbers per floor must be between 01 and 99.');
  }
  let created = 0;
  let skipped = 0;
  for (let fl = input.startFloor; fl <= input.endFloor; fl++) {
    for (let idx = input.startUnitNumber; idx < input.startUnitNumber + input.unitsPerFloor; idx++) {
      const flatNo =
        fl === 0
          ? `${input.towerCode.toUpperCase()}-${String(idx).padStart(2, '0')}`
          : `${input.towerCode.toUpperCase()}-${fl}${String(idx).padStart(2, '0')}`;
      try {
        await createUnitService(
          db,
          actor,
          actorRole,
          {
            orgId: input.orgId,
            projectId: input.projectId,
            towerId: input.towerId ?? null,
            towerName: input.towerName,
            floorNumber: fl,
            unitNumber: flatNo,
            unitType: input.unitType,
            bhk: input.bhk,
            saleableAreaSqft: input.saleableAreaSqft,
            carpetAreaSqft: input.carpetAreaSqft,
            facing: input.facing,
            isCorner:
              input.isCorner !== undefined
                ? input.isCorner
                : idx === input.startUnitNumber || idx === input.startUnitNumber + input.unitsPerFloor - 1,
            balconiesCount: input.unitType === 'PLOT' ? 0 : 2,
            parkingEntitlementCount: input.parkingEntitlementCount,
            baseRatePerSqft: input.baseRatePerSqft,
            floorPlanStoragePath: input.floorPlanStoragePath,
            listingMode: input.listingMode ?? 'BUY',
            isPublicPublished: Boolean(input.isPublicPublished),
          }
        );
        created++;
      } catch (error) {
        if (error instanceof HttpsError && error.code === 'already-exists') skipped++;
        else throw error;
      }
    }
  }

  if (created > 0) {
    await ensureBaselinePriceBookForProject(db, {
      orgId: input.orgId,
      projectId: input.projectId,
      baseRatePerSqft: input.baseRatePerSqft,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole,
    }).catch(() => {
      // Non-blocking baseline pricing initialization
    });
  }

  return { createdCount: created, skippedCount: skipped };
}

export const bulkGenerateTowerUnits = onCall(async (request) => {
  const input = bulkGenerateUnitsSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(request, input.orgId, 'inventory:manage', input.projectId);
  return bulkGenerateTowerUnitsService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', input);
});

export const transitionUnitStatus = onCall(async (request) => {
  const parsed = unitStatusTransitionSchema.parse(request.data);
  const unitSnap = await adminDb.collection('units').doc(parsed.unitId).get();
  if (!unitSnap.exists || unitSnap.data()?.orgId !== parsed.orgId) {
    throw new HttpsError('not-found', 'Unit not found.');
  }
  const unit = unitSnap.data() as Unit;
  const rule = validateUnitTransition(unit.status, parsed.targetStatus, parsed.action);
  if (!rule) {
    throw new HttpsError(
      'failed-precondition',
      `Invalid status transition from ${unit.status} to ${parsed.targetStatus}.`
    );
  }

  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    rule.requiredPermission,
    unit.projectId
  );

  return transitionUnitStatusService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );
});

export const expireStaleUnitHolds = onSchedule('every 15 minutes', async () => {
  const nowIso = new Date().toISOString();
  const expiredSnap = await adminDb
    .collection('units')
    .where('status', '==', 'ON_HOLD')
    .where('holdExpiresAt', '<=', nowIso)
    .limit(100)
    .get();

  for (const docSnap of expiredSnap.docs) {
    const unit = docSnap.data() as Unit;
    try {
      await transitionUnitStatusService(
        adminDb,
        { uid: 'SYSTEM_SCHEDULER', isSuperAdmin: true, mfaVerified: true },
        'SYSTEM',
        {
          orgId: unit.orgId,
          unitId: unit.id,
          targetStatus: 'AVAILABLE',
          action: 'EXPIRE',
          reason: 'Automated hold expiry elapsed.',
        }
      );
    } catch {
      // Ignore concurrent state transition if already booked/released
    }
  }
});
