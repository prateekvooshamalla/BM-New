import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';
import {
  toMinorUnits,
  validateUnitTransition,
  type Booking,
  type CollectionRecord,
  type Lead,
  type Project,
  type ProjectStats,
  type Tower,
  type Unit,
  type UnitStatus,
} from '@bharat-makaan/shared';
import {
  createUnitSchema,
  updateUnitSchema,
  unitStatusTransitionSchema,
  unitTypeSchema,
  unitRoomFields,
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
  const unitRef = input.requestId
    ? db.collection('units').doc(createHash('sha256').update(`${input.orgId}:${input.projectId}:${actor.uid}:${input.requestId}`).digest('hex').slice(0, 32))
    : db.collection('units').doc();
  if (input.floorPlanStoragePath && !input.floorPlanStoragePath.startsWith(`organizations/${input.orgId}/projects/${input.projectId}/floorplans/`)) {
    throw new HttpsError('invalid-argument', 'Floor plan must belong to this project.');
  }
  const nowIso = new Date().toISOString();

  const createdUnit = await db.runTransaction(async (tx) => {
    if (input.requestId) {
      const existing = await tx.get(unitRef);
      if (existing.exists) return existing.data() as Unit;
    }
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

    const series = input.series ? input.series.trim().toUpperCase() : undefined;
    if (series) {
      let seriesQuery = db
        .collection('units')
        .where('orgId', '==', input.orgId)
        .where('projectId', '==', input.projectId)
        .where('floorNumber', '==', input.floorNumber)
        .where('series', '==', series);
      if (input.towerId) {
        seriesQuery = seriesQuery.where('towerId', '==', input.towerId);
      }
      const seriesSnap = await tx.get(seriesQuery.limit(1));
      if (!seriesSnap.empty) {
        throw new HttpsError(
          'already-exists',
          `Series "${series}" already exists on floor ${input.floorNumber} of this ${input.towerId ? 'tower' : 'project'}.`
        );
      }
    }

    for (const [collection, id, label] of [
      ['project_phases', input.phaseId, 'Phase'],
      ['towers', input.towerId, 'Tower'],
      ['floors', input.floorId, 'Floor'],
    ] as const) {
      if (!id) continue;
      const parent = await tx.get(db.collection(collection).doc(id));
      const data = parent.data();
      if (!parent.exists || data?.orgId !== input.orgId || data?.projectId !== input.projectId) {
        throw new HttpsError('invalid-argument', `${label} must belong to this project.`);
      }
      if (collection === 'floors' && ((data?.towerId ?? null) !== (input.towerId ?? null) || data?.floorNumber !== input.floorNumber)) {
        throw new HttpsError('invalid-argument', 'Floor must match the selected tower and floor number.');
      }
      if (collection === 'towers' && input.phaseId && data?.phaseId !== input.phaseId) {
        throw new HttpsError('invalid-argument', 'Tower must belong to the selected phase.');
      }
    }

    if (input.towerId) {
      const towerSnap = await tx.get(db.collection('towers').doc(input.towerId));
      if (towerSnap.exists) {
        const towerData = towerSnap.data() as Tower;
        if (towerData.totalFloors && towerData.totalFloors > 0 && input.floorNumber > towerData.totalFloors) {
          throw new HttpsError(
            'invalid-argument',
            `Floor number ${input.floorNumber} exceeds tower "${towerData.name}" total floors (${towerData.totalFloors}).`
          );
        }
      }
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

    const unit: Unit = {
      id: unitRef.id,
      orgId: input.orgId,
      projectId: input.projectId,
      phaseId: input.phaseId ?? null,
      towerId: input.towerId ?? null,
      towerName: input.towerName,
      floorId: input.floorId ?? null,
      floorNumber: input.floorNumber,
      series: series ?? undefined,
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
      bedroomsCount: input.bedroomsCount,
      bathroomsCount: input.bathroomsCount,
      furnishing: input.furnishing,
      roomDetails: input.roomDetails ?? [],
      unitAmenities: input.unitAmenities ?? [],
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

export async function updateUnitService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Unit> {
  const input = updateUnitSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const unitRef = db.collection('units').doc(input.unitId);
    const unitSnap = await tx.get(unitRef);
    if (!unitSnap.exists || unitSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Unit not found in this organization.');
    }
    const unit = unitSnap.data() as Unit;

    // Disallow altering core unit specs if booked or registered unless super admin / builder admin
    if (
      ['BOOKED', 'AGREEMENT', 'REGISTERED'].includes(unit.status) &&
      (input.saleableAreaSqft || input.carpetAreaSqft || input.unitType || input.bhk) &&
      !actor.isSuperAdmin &&
      actorRole !== 'BUILDER_ADMIN'
    ) {
      throw new HttpsError(
        'failed-precondition',
        `Unit ${unit.unitNumber} is currently ${unit.status} and cannot be modified without builder admin override.`
      );
    }

    const nextFloor = input.floorNumber !== undefined ? input.floorNumber : unit.floorNumber;
    const nextSeries = input.series ? input.series.trim().toUpperCase() : unit.series;
    const nextUnitNumber = input.unitNumber ? input.unitNumber.trim().toUpperCase() : unit.unitNumber;

    // Check duplicate unitNumber if changed
    if (input.unitNumber && nextUnitNumber !== unit.unitNumber) {
      const dupSnap = await tx.get(
        db
          .collection('units')
          .where('orgId', '==', input.orgId)
          .where('projectId', '==', unit.projectId)
          .where('unitNumber', '==', nextUnitNumber)
          .limit(1)
      );
      if (!dupSnap.empty && dupSnap.docs[0]!.id !== unit.id) {
        throw new HttpsError('already-exists', `Unit "${nextUnitNumber}" already exists in this project.`);
      }
    }

    if (input.parkingEntitlementCount !== undefined && input.parkingEntitlementCount < (unit.assignedParkingSlotIds ?? []).length) {
      throw new HttpsError('failed-precondition', 'Release assigned parking slots before reducing the unit entitlement.');
    }

    // Check duplicate series on same floor/tower if changed
    if (nextSeries && (input.series || input.floorNumber !== undefined)) {
      let seriesQuery = db
        .collection('units')
        .where('orgId', '==', input.orgId)
        .where('projectId', '==', unit.projectId)
        .where('floorNumber', '==', nextFloor)
        .where('series', '==', nextSeries);
      if (unit.towerId) {
        seriesQuery = seriesQuery.where('towerId', '==', unit.towerId);
      }
      const seriesSnap = await tx.get(seriesQuery);
      const dupSeries = seriesSnap.docs.find((d) => d.id !== unit.id);
      if (dupSeries) {
        throw new HttpsError(
          'already-exists',
          `Series "${nextSeries}" already exists on floor ${nextFloor} of this ${unit.towerId ? 'tower' : 'project'}.`
        );
      }
    }

    if (unit.towerId && nextFloor > 0 && (input.floorNumber !== undefined)) {
      const towerSnap = await tx.get(db.collection('towers').doc(unit.towerId));
      if (towerSnap.exists) {
        const towerData = towerSnap.data() as Tower;
        if (towerData.totalFloors && towerData.totalFloors > 0 && nextFloor > towerData.totalFloors) {
          throw new HttpsError(
            'invalid-argument',
            `Floor number ${nextFloor} exceeds tower "${towerData.name}" total floors (${towerData.totalFloors}).`
          );
        }
      }
    }

    const nextSaleable = input.saleableAreaSqft ?? unit.saleableAreaSqft;
    const nextCarpet = input.carpetAreaSqft ?? unit.carpetAreaSqft;
    if (nextCarpet > nextSaleable) {
      throw new HttpsError('invalid-argument', 'Carpet area cannot exceed saleable area.');
    }

    const nextBaseRate = input.baseRatePerSqft !== undefined ? input.baseRatePerSqft : unit.baseRatePerSqft;
    const nextBasePrice = input.baseUnitPrice !== undefined ? input.baseUnitPrice : unit.baseUnitPrice;
    const pricingMode = unit.pricingMode ?? 'PER_AREA';
    const primaryArea = input.saleableAreaSqft ?? unit.primaryArea ?? nextSaleable;
    const calculatedPrice =
      pricingMode === 'BASE_UNIT_PRICE' && nextBasePrice !== undefined
        ? nextBasePrice
        : Math.round(primaryArea * nextBaseRate * 100) / 100;

    const updatedUnit: Unit = {
      ...unit,
      unitNumber: nextUnitNumber,
      series: nextSeries,
      floorNumber: nextFloor,
      bhk: input.bhk ? input.bhk.trim() : unit.bhk,
      balconiesCount: input.balconiesCount ?? unit.balconiesCount,
      bedroomsCount: input.bedroomsCount ?? unit.bedroomsCount,
      bathroomsCount: input.bathroomsCount ?? unit.bathroomsCount,
      furnishing: input.furnishing ?? unit.furnishing,
      roomDetails: input.roomDetails ?? unit.roomDetails ?? [],
      unitAmenities: input.unitAmenities ?? unit.unitAmenities ?? [],
      unitType: input.unitType ?? unit.unitType,
      facing: input.facing ?? unit.facing,
      saleableAreaSqft: nextSaleable,
      carpetAreaSqft: nextCarpet,
      primaryArea: nextSaleable,
      secondaryArea: nextCarpet,
      baseRatePerSqft: nextBaseRate,
      baseUnitPrice: nextBasePrice,
      calculatedTotalPrice: calculatedPrice + (unit.floorRiseAmount ?? 0) + (unit.premiumChargesAmount ?? 0),
      calculatedTotalMinor: toMinorUnits(
        calculatedPrice + (unit.floorRiseAmount ?? 0) + (unit.premiumChargesAmount ?? 0),
        unit.currencyCode ?? 'INR'
      ),
      parkingEntitlementCount: input.parkingEntitlementCount ?? unit.parkingEntitlementCount,
      isCorner: input.isCorner !== undefined ? input.isCorner : unit.isCorner,
      isPublicPublished: input.isPublicPublished !== undefined ? input.isPublicPublished : unit.isPublicPublished,
      listingMode: input.listingMode ?? unit.listingMode,
      floorPlanStoragePath: input.floorPlanStoragePath !== undefined ? input.floorPlanStoragePath : unit.floorPlanStoragePath,
      updatedAt: nowIso,
    };

    tx.set(unitRef, updatedUnit);

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'UNIT_UPDATED',
        category: 'INVENTORY',
        entityType: 'unit',
        entityId: unit.id,
        summary: `Updated unit ${updatedUnit.unitNumber} (Floor ${updatedUnit.floorNumber}, Series ${updatedUnit.series || 'N/A'}).`,
        before: { unitNumber: unit.unitNumber, series: unit.series, baseRatePerSqft: unit.baseRatePerSqft },
        after: { unitNumber: updatedUnit.unitNumber, series: updatedUnit.series, baseRatePerSqft: updatedUnit.baseRatePerSqft },
      },
      tx
    );

    return updatedUnit;
  });
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
    const projSnap = await tx.get(projRef);
    const proj = projSnap.exists ? (projSnap.data() as Project) : null;

    let activeBookingId: string | null = unit.activeBookingId ?? null;
    const leadId = input.leadId ?? unit.heldForLeadId ?? null;

    if (input.action === 'HOLD' || input.action === 'RESERVE' || input.action === 'BOOK') {
      if (leadId) {
        const leadRef = db.collection('leads').doc(leadId);
        const leadSnap = await tx.get(leadRef);
        if (!leadSnap.exists || leadSnap.data()?.orgId !== input.orgId) {
          throw new HttpsError('permission-denied', 'Customer must belong to this organization.');
        }
        const leadData = leadSnap.data() as Lead;
        // Automatically mark customer status upon reservation / booking / hold
        const nextStage: Lead['stage'] =
          input.action === 'BOOK' || input.targetStatus === 'BOOKED'
            ? 'BOOKED'
            : input.action === 'RESERVE' && !['BOOKED', 'CLOSED'].includes(leadData.stage)
            ? 'NEGOTIATION'
            : leadData.stage;
        tx.update(leadRef, {
          isCustomer: true,
          customerConvertedAt: leadData.customerConvertedAt || nowIso,
          stage: nextStage,
          updatedAt: nowIso,
        });

        // If target status is BOOKED and no active booking exists, create official Booking record
        if (input.targetStatus === 'BOOKED' && !activeBookingId) {
          const bkRef = db.collection('bookings').doc();
          const bookingNumber = `BM-BK-${proj?.code || 'PRJ'}-${now.getFullYear()}-${bkRef.id.slice(0, 5).toUpperCase()}`;
          const contractVal = unit.calculatedTotalPrice || 5000000;
          const advanceVal = input.holdAdvanceAmount ?? unit.holdAdvanceAmount ?? 500000;
          const hasRef = Boolean(input.holdPaymentReference?.trim() || unit.holdPaymentReference?.trim());
          const paidVal = hasRef ? advanceVal : 0;

          const bk: Booking = {
            id: bkRef.id,
            orgId: input.orgId,
            bookingNumber,
            projectId: unit.projectId,
            towerId: unit.towerId ?? null,
            unitId: unit.id,
            unitNumber: unit.unitNumber,
            quotationId: 'DIRECT_INVENTORY' as any,
            leadId: leadData.id,
            partnerOrgId: null,
            customer: {
              fullName: leadData.customerName,
              phone: leadData.normalizedPhone || leadData.phone,
              email: leadData.email || `${leadData.customerName.toLowerCase().replace(/\s+/g, '')}@buyer.in`,
              permanentAddress: leadData.address || 'Address on file',
            },
            allocatedParkingSlotIds: unit.assignedParkingSlotIds || [],
            agreementValueInr: contractVal,
            totalPayableInr: contractVal,
            tokenAmountExpectedInr: advanceVal,
            totalCollectedVerifiedInr: paidVal,
            outstandingBalanceInr: Math.max(0, contractVal - paidVal),
            status: 'BOOKED',
            requestedByUid: actor.uid,
            approvedByUid: actor.uid,
            bookedAt: nowIso,
            cancelledAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          tx.set(bkRef, bk);
          activeBookingId = bk.id;

          // Create collection record for advance/token
          const colRef = db.collection('collection_records').doc();
          const col: CollectionRecord = {
            id: colRef.id,
            orgId: input.orgId,
            bookingId: bk.id,
            projectId: unit.projectId,
            unitId: unit.id,
            recordType: 'TOKEN',
            milestoneSequence: 1,
            milestoneName: 'Booking Token / Advance',
            demandAmountInr: advanceVal,
            paidAmountInr: paidVal,
            allocatedAmountInr: paidVal,
            paymentMode: 'NEFT',
            razorpaySignatureVerified: false,
            receiptNumber: hasRef ? `BM-RCP-${colRef.id.slice(0, 6).toUpperCase()}` : undefined,
            status: hasRef ? 'VERIFIED' : 'DUE',
            dueDate: nowIso,
            paidAt: hasRef ? nowIso : undefined,
            recordedByUid: actor.uid,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          tx.set(colRef, col);
        }
      }
      if ((input.holdAdvanceAmount ?? 0) > 0 && !leadId) throw new HttpsError('invalid-argument', 'Select a customer for the advance.');
      if ((input.holdAdvanceAmount ?? 0) > 0 && !input.holdPaymentReference?.trim()) {
        throw new HttpsError('invalid-argument', 'Enter a receipt or payment reference for the advance.');
      }
    }

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
        input.targetStatus === 'ON_HOLD' || input.targetStatus === 'RESERVED' || input.targetStatus === 'BOOKED'
          ? actor.uid
          : null,
      heldForLeadId:
        input.targetStatus === 'ON_HOLD' || input.targetStatus === 'RESERVED' || input.targetStatus === 'BOOKED'
          ? (leadId ?? null)
          : null,
      activeBookingId:
        input.targetStatus === 'AVAILABLE' ? null : (activeBookingId || unit.activeBookingId || null),
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

export const updateUnit = onCall(async (request) => {
  const parsed = updateUnitSchema.parse(request.data);
  const unitSnap = await adminDb.collection('units').doc(parsed.unitId).get();
  if (!unitSnap.exists || unitSnap.data()?.orgId !== parsed.orgId) {
    throw new HttpsError('not-found', 'Unit not found in organization.');
  }
  const unitData = unitSnap.data() as Unit;
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'inventory:manage',
    unitData.projectId
  );
  return updateUnitService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

const bulkGenerateUnitsSchema = z.object({
  ...unitRoomFields,
  balconiesCount: z.coerce.number().int().min(0).max(20).optional(),
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

  if (input.towerId) {
    const towerSnap = await db.collection('towers').doc(input.towerId).get();
    if (towerSnap.exists) {
      const towerData = towerSnap.data() as Tower;
      if (towerData.totalFloors && towerData.totalFloors > 0 && input.endFloor > towerData.totalFloors) {
        throw new HttpsError(
          'invalid-argument',
          `End floor (${input.endFloor}) cannot exceed tower "${towerData.name}" total floors (${towerData.totalFloors}).`
        );
      }
    }
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
      const seriesNo = String(idx).padStart(2, '0');
      const flatNo =
        fl === 0
          ? `${input.towerCode.toUpperCase()}-${seriesNo}`
          : `${input.towerCode.toUpperCase()}-${fl}${seriesNo}`;
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
            series: seriesNo,
            unitNumber: flatNo,
            unitType: input.unitType,
            bhk: input.bhk,
            bedroomsCount: input.bedroomsCount,
            bathroomsCount: input.bathroomsCount,
            furnishing: input.furnishing,
            roomDetails: input.roomDetails,
            unitAmenities: input.unitAmenities,
            saleableAreaSqft: input.saleableAreaSqft,
            carpetAreaSqft: input.carpetAreaSqft,
            facing: input.facing,
            isCorner:
              input.isCorner !== undefined
                ? input.isCorner
                : idx === input.startUnitNumber || idx === input.startUnitNumber + input.unitsPerFloor - 1,
            balconiesCount: input.balconiesCount ?? (input.unitType === 'PLOT' ? 0 : 2),
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
