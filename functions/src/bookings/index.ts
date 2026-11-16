import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  canTransitionBooking,
  type Booking,
  type BookingStatus,
  type CollectionRecord,
  type ParkingSlot,
  type PartnerOrganization,
  type Project,
  type Quotation,
  type Unit,
} from '@bharat-makaan/shared';
import { createBookingSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { createApprovalRequestService } from '../approvals';
import { writeAuditEvent } from '../audit';

/**
 * Controlled Transactional Booking Creation.
 * Atomically verifies unit availability (AVAILABLE / ON_HOLD / RESERVED),
 * verifies linked quotation is ISSUED/SHARED/APPROVED, prevents double active bookings,
 * transitions unit & creates initial token demand.
 */
export async function createBookingService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorName: string,
  actorRole: string,
  rawInput: unknown,
  autoApprove = false
): Promise<Booking> {
  const input = createBookingSchema.parse(rawInput);
  const now = new Date();
  const nowIso = now.toISOString();

  const booking = await db.runTransaction(async (tx) => {
    const unitRef = db.collection('units').doc(input.unitId);
    const qtRef = db.collection('quotations').doc(input.quotationId);
    const projRef = db.collection('projects').doc(input.projectId);

    const [unitSnap, qtSnap, projSnap] = await Promise.all([
      tx.get(unitRef),
      tx.get(qtRef),
      tx.get(projRef),
    ]);

    if (!unitSnap.exists || !qtSnap.exists || !projSnap.exists) {
      throw new HttpsError('not-found', 'Unit, quotation, or project not found.');
    }

    const unit = unitSnap.data() as Unit;
    const qt = qtSnap.data() as Quotation;
    const proj = projSnap.data() as Project;

    if (unit.orgId !== input.orgId || qt.orgId !== input.orgId) {
      throw new HttpsError('permission-denied', 'Cross-tenant entity mismatch.');
    }

    if (qt.unitId !== unit.id) {
      throw new HttpsError('invalid-argument', 'Quotation does not match selected unit.');
    }

    if (qt.status === 'PENDING_APPROVAL' || qt.status === 'DRAFT' || qt.status === 'EXPIRED') {
      throw new HttpsError(
        'failed-precondition',
        `Quotation must be approved/issued before booking (current: ${qt.status}).`
      );
    }

    if (
      unit.activeBookingId ||
      unit.status === 'BOOKED' ||
      unit.status === 'AGREEMENT' ||
      unit.status === 'REGISTERED'
    ) {
      throw new HttpsError(
        'already-exists',
        `Conflict: Unit ${unit.unitNumber} already has an active booking (${unit.status}).`
      );
    }

    const bkRef = db.collection('bookings').doc();
    const bookingNumber = `BM-BK-${proj.code}-${now.getFullYear()}-${bkRef.id.slice(0, 5).toUpperCase()}`;
    const initialStatus: BookingStatus = autoApprove ? 'BOOKED' : 'PENDING_APPROVAL';
    const nextUnitStatus = autoApprove ? 'BOOKED' : 'RESERVED';

    const bk: Booking = {
      id: bkRef.id,
      orgId: input.orgId,
      bookingNumber,
      projectId: proj.id,
      towerId: unit.towerId ?? null,
      unitId: unit.id,
      unitNumber: unit.unitNumber,
      quotationId: qt.id,
      leadId: input.leadId,
      partnerOrgId: input.partnerOrgId ?? qt.partnerOrgId ?? null,
      customer: {
        fullName: input.customer.fullName.trim(),
        coApplicantName: input.customer.coApplicantName?.trim() || undefined,
        phone: input.customer.phone.trim(),
        email: input.customer.email.trim().toLowerCase(),
        panNumber: input.customer.panNumber || undefined,
        aadhaarLast4: input.customer.aadhaarLast4 || undefined,
        permanentAddress: input.customer.permanentAddress.trim(),
      },
      allocatedParkingSlotIds: input.allocatedParkingSlotIds,
      agreementValueInr: qt.breakdown.netAgreementValueBeforeGstInr,
      totalPayableInr: qt.totalPayableInr,
      tokenAmountExpectedInr: input.tokenAmountExpectedInr,
      totalCollectedVerifiedInr: 0,
      outstandingBalanceInr: qt.totalPayableInr,
      status: initialStatus,
      requestedByUid: actor.uid,
      approvedByUid: autoApprove ? actor.uid : null,
      bookedAt: autoApprove ? nowIso : null,
      cancelledAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(bkRef, bk);
    tx.update(unitRef, {
      status: nextUnitStatus,
      activeBookingId: bk.id,
      heldByUid: actor.uid,
      updatedAt: nowIso,
    });
    tx.update(qtRef, {
      status: 'ACCEPTED',
      updatedAt: nowIso,
    });

    if (autoApprove) {
      tx.update(projRef, {
        'stats.availableUnits': Math.max(
          0,
          (proj.stats?.availableUnits ?? 0) - (unit.status === 'AVAILABLE' ? 1 : 0)
        ),
        'stats.bookedUnits': (proj.stats?.bookedUnits ?? 0) + 1,
        'stats.bookedSalesValueInr': (proj.stats?.bookedSalesValueInr ?? 0) + qt.totalPayableInr,
        updatedAt: nowIso,
      });
    }

    // Create initial Token Demand record in collection_records
    const tokenColRef = db.collection('collection_records').doc();
    const tokenDemand: CollectionRecord = {
      id: tokenColRef.id,
      orgId: input.orgId,
      bookingId: bk.id,
      projectId: proj.id,
      unitId: unit.id,
      recordType: 'TOKEN',
      milestoneSequence: 1,
      milestoneName: 'Booking Token Advance',
      demandAmountInr: input.tokenAmountExpectedInr,
      paidAmountInr: 0,
      allocatedAmountInr: 0,
      paymentMode: 'NEFT',
      razorpaySignatureVerified: false,
      status: 'DUE',
      dueDate: nowIso,
      recordedByUid: actor.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    tx.set(tokenColRef, tokenDemand);

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'BOOKING_CREATED',
        category: 'BOOKING',
        entityType: 'booking',
        entityId: bk.id,
        summary: `Created booking ${bk.bookingNumber} for Unit ${unit.unitNumber} (${bk.status}).`,
      },
      tx
    );

    return bk;
  });

  // Update lead & partner commission eligibility outside unit lock
  const leadSnap = await db.collection('leads').doc(booking.leadId).get();
  if (leadSnap.exists) {
    await leadSnap.ref.update({
      stage: 'BOOKED',
      linkedBookingIds: [...(leadSnap.data()?.linkedBookingIds ?? []), booking.id],
      updatedAt: nowIso,
    });
  }

  if (booking.partnerOrgId) {
    const poRef = db.collection('partner_organizations').doc(booking.partnerOrgId);
    const poSnap = await poRef.get();
    if (poSnap.exists) {
      const po = poSnap.data() as PartnerOrganization;
      const pct = po.builderScopes?.[booking.orgId]?.commissionPct ?? 0;
      const commissionInr = Math.round((booking.agreementValueInr * pct) / 100);
      await poRef.update({
        'metrics.bookingsCount': (po.metrics?.bookingsCount ?? 0) + 1,
        'metrics.eligibleCommissionInr':
          (po.metrics?.eligibleCommissionInr ?? 0) + commissionInr,
        updatedAt: nowIso,
      });
    }
  }

  if (booking.status === 'PENDING_APPROVAL') {
    await createApprovalRequestService(db, {
      orgId: booking.orgId,
      entityType: 'BOOKING',
      entityId: booking.id,
      projectId: booking.projectId,
      requestedByUid: actor.uid,
      requestedByName: actorName,
      requiredPermission: 'bookings:approve',
      requestSummary: `Approve Booking ${booking.bookingNumber} — Unit ${booking.unitNumber} (${booking.customer.fullName})`,
      payloadSnapshot: {
        bookingNumber: booking.bookingNumber,
        unitNumber: booking.unitNumber,
        totalPayableInr: booking.totalPayableInr,
      },
    });
  }

  return booking;
}

export async function transitionBookingStatusService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  params: {
    orgId: string;
    bookingId: string;
    targetStatus: BookingStatus;
    reason?: string;
  }
): Promise<Booking> {
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const bkRef = db.collection('bookings').doc(params.bookingId);
    const bkSnap = await tx.get(bkRef);
    if (!bkSnap.exists || bkSnap.data()?.orgId !== params.orgId) {
      throw new HttpsError('not-found', 'Booking not found.');
    }

    const bk = bkSnap.data() as Booking;
    if (!canTransitionBooking(bk.status, params.targetStatus)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot transition booking from ${bk.status} to ${params.targetStatus}.`
      );
    }

    const unitRef = db.collection('units').doc(bk.unitId);
    const projRef = db.collection('projects').doc(bk.projectId);
    const [unitSnap, projSnap] = await Promise.all([tx.get(unitRef), tx.get(projRef)]);

    const updated: Booking = {
      ...bk,
      status: params.targetStatus,
      cancellationReason:
        params.targetStatus === 'CANCELLED' ? params.reason ?? 'Authorized cancellation' : bk.cancellationReason,
      approvedByUid:
        params.targetStatus === 'BOOKED' || params.targetStatus === 'APPROVED'
          ? actor.uid
          : bk.approvedByUid,
      bookedAt:
        params.targetStatus === 'BOOKED' && !bk.bookedAt ? nowIso : bk.bookedAt,
      cancelledAt: params.targetStatus === 'CANCELLED' ? nowIso : bk.cancelledAt,
      updatedAt: nowIso,
    };

    tx.set(bkRef, updated);

    if (unitSnap.exists) {
      if (params.targetStatus === 'CANCELLED') {
        tx.update(unitRef, {
          status: 'AVAILABLE',
          activeBookingId: null,
          heldByUid: null,
          assignedParkingSlotIds: [],
          updatedAt: nowIso,
        });

        // Release any physical parking slots allocated to this booking/unit
        for (const slotId of bk.allocatedParkingSlotIds) {
          const sRef = db.collection('parking_slots').doc(slotId);
          const sSnap = await tx.get(sRef);
          if (sSnap.exists) {
            const slot = sSnap.data() as ParkingSlot;
            if (slot.allocatedUnitId === bk.unitId) {
              tx.update(sRef, {
                status: 'AVAILABLE',
                allocatedUnitId: null,
                allocatedUnitNumber: null,
                allocatedBookingId: null,
                updatedAt: nowIso,
              });
            }
          }
        }
      } else if (params.targetStatus === 'BOOKED') {
        tx.update(unitRef, { status: 'BOOKED', updatedAt: nowIso });
      } else if (params.targetStatus === 'AGREEMENT_EXECUTED') {
        tx.update(unitRef, { status: 'AGREEMENT', updatedAt: nowIso });
      } else if (params.targetStatus === 'REGISTERED') {
        tx.update(unitRef, { status: 'REGISTERED', updatedAt: nowIso });
      }
    }

    if (projSnap.exists) {
      const proj = projSnap.data() as Project;
      if (params.targetStatus === 'BOOKED' && bk.status !== 'BOOKED') {
        tx.update(projRef, {
          'stats.bookedUnits': (proj.stats?.bookedUnits ?? 0) + 1,
          'stats.bookedSalesValueInr':
            (proj.stats?.bookedSalesValueInr ?? 0) + bk.totalPayableInr,
          updatedAt: nowIso,
        });
      } else if (params.targetStatus === 'CANCELLED' && bk.bookedAt) {
        tx.update(projRef, {
          'stats.bookedUnits': Math.max(0, (proj.stats?.bookedUnits ?? 1) - 1),
          'stats.availableUnits': (proj.stats?.availableUnits ?? 0) + 1,
          'stats.bookedSalesValueInr': Math.max(
            0,
            (proj.stats?.bookedSalesValueInr ?? 0) - bk.totalPayableInr
          ),
          updatedAt: nowIso,
        });
      }
    }

    await writeAuditEvent(
      db,
      {
        orgId: params.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: `BOOKING_${params.targetStatus}`,
        category: 'BOOKING',
        entityType: 'booking',
        entityId: bk.id,
        summary: `Booking ${bk.bookingNumber} transitioned ${bk.status} -> ${params.targetStatus}.`,
        before: { status: bk.status },
        after: { status: params.targetStatus, reason: params.reason ?? null },
      },
      tx
    );

    return updated;
  });
}

// --- Cloud Functions v2 Callables ---

export const createBooking = onCall(async (request) => {
  const parsed = createBookingSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'bookings:create',
    parsed.projectId
  );

  const canAutoApprove =
    actor.isSuperAdmin || (member?.permissions.includes('bookings:approve') ?? false);

  return createBookingService(
    adminDb,
    actor,
    member?.displayName ?? actor.email ?? 'Sales Team',
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed,
    canAutoApprove
  );
});

export const transitionBookingStatus = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    bookingId: z.string().min(1),
    targetStatus: z.enum([
      'APPROVED',
      'BOOKED',
      'AGREEMENT_EXECUTED',
      'REGISTERED',
      'CANCELLED',
    ]),
    reason: z.string().max(300).optional(),
  });
  const input = schema.parse(request.data);
  const perm = input.targetStatus === 'CANCELLED' ? 'bookings:cancel' : 'bookings:approve';
  const { actor, member } = await requireOrgPermission(request, input.orgId, perm);

  return transitionBookingStatusService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    input
  );
});
