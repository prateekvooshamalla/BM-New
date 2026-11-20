import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import Razorpay from 'razorpay';
import { z } from 'zod';
import type {
  Booking,
  CollectionRecord,
  Project,
  ReconciliationRecord,
} from '@bharat-makaan/shared';
import { recordCollectionSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

/**
 * Verifies Razorpay HMAC-SHA256 payment or webhook signature server-side.
 * CRITICAL: Frontend success callbacks NEVER mark a payment VERIFIED without this check!
 */
export function verifyRazorpayHmacSignature(
  payload: string | Buffer,
  providedSignature: string | undefined,
  secret: string
): boolean {
  if (!providedSignature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(providedSignature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function recordCollectionEntryService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<CollectionRecord> {
  const input = recordCollectionSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const bkRef = db.collection('bookings').doc(input.bookingId);
    const bkSnap = await tx.get(bkRef);
    if (!bkSnap.exists || bkSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Booking not found.');
    }
    const bk = bkSnap.data() as Booking;

    const projRef = db.collection('projects').doc(bk.projectId);
    const projSnap = await tx.get(projRef);

    const colRef = db.collection('collection_records').doc();
    const isDemandOnly = input.recordType === 'MILESTONE_DEMAND' && input.paidAmountInr === 0;
    const isRazorpayPending = input.paymentMode === 'RAZORPAY';

    // CRITICAL: Razorpay entries NEVER start VERIFIED from client input; they await HMAC verification!
    const status: CollectionRecord['status'] = isDemandOnly
      ? 'DUE'
      : input.recordType === 'REFUND'
        ? 'REFUNDED'
        : isRazorpayPending
          ? 'PENDING_VERIFICATION'
          : 'VERIFIED';

    const receiptNumber =
      status === 'VERIFIED' ? `BM-RCP-${colRef.id.slice(0, 6).toUpperCase()}` : undefined;

    const record: CollectionRecord = {
      id: colRef.id,
      orgId: input.orgId,
      bookingId: bk.id,
      projectId: bk.projectId,
      unitId: bk.unitId,
      recordType: input.recordType,
      milestoneSequence: input.milestoneSequence,
      milestoneName: input.milestoneName.trim(),
      demandAmountInr: input.demandAmountInr,
      paidAmountInr: input.paidAmountInr,
      allocatedAmountInr: status === 'VERIFIED' ? input.paidAmountInr : 0,
      paymentMode: input.paymentMode,
      instrumentRef: input.instrumentRef,
      razorpaySignatureVerified: false,
      receiptNumber,
      status,
      dueDate: input.dueDate,
      paidAt: status === 'VERIFIED' ? nowIso : undefined,
      recordedByUid: actor.uid,
      notes: input.notes,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(colRef, record);

    if (status === 'VERIFIED' && input.paidAmountInr > 0) {
      const nextCollected = bk.totalCollectedVerifiedInr + input.paidAmountInr;
      const nextOutstanding = Math.max(0, bk.totalPayableInr - nextCollected);
      tx.update(bkRef, {
        totalCollectedVerifiedInr: nextCollected,
        outstandingBalanceInr: nextOutstanding,
        updatedAt: nowIso,
      });

      if (projSnap.exists) {
        const proj = projSnap.data() as Project;
        tx.update(projRef, {
          'stats.collectionsVerifiedInr':
            (proj.stats?.collectionsVerifiedInr ?? 0) + input.paidAmountInr,
          updatedAt: nowIso,
        });
      }
    } else if (status === 'REFUNDED' && input.paidAmountInr > 0) {
      const nextCollected = Math.max(0, bk.totalCollectedVerifiedInr - input.paidAmountInr);
      const nextOutstanding = Math.max(0, bk.totalPayableInr - nextCollected);
      tx.update(bkRef, {
        totalCollectedVerifiedInr: nextCollected,
        outstandingBalanceInr: nextOutstanding,
        updatedAt: nowIso,
      });
    }

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: `COLLECTION_${input.recordType}`,
        category: 'PAYMENT',
        entityType: 'collection_record',
        entityId: record.id,
        summary: `Recorded ${record.recordType} (${record.paymentMode}, status=${record.status}, amount=₹${record.paidAmountInr || record.demandAmountInr}) on Booking ${bk.bookingNumber}.`,
      },
      tx
    );

    return record;
  });
}

export async function confirmVerifiedRazorpayCollectionService(
  db: Firestore,
  params: {
    collectionRecordId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    providedSignature: string;
    secret: string;
  }
): Promise<CollectionRecord> {
  const payload = `${params.razorpayOrderId}|${params.razorpayPaymentId}`;
  if (!verifyRazorpayHmacSignature(payload, params.providedSignature, params.secret)) {
    throw new HttpsError('permission-denied', 'Invalid Razorpay HMAC payment signature.');
  }

  const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const colRef = db.collection('collection_records').doc(params.collectionRecordId);
    const colSnap = await tx.get(colRef);
    if (!colSnap.exists) {
      throw new HttpsError('not-found', 'Collection record not found.');
    }

    const col = colSnap.data() as CollectionRecord;
    if (col.status === 'VERIFIED') {
      return col; // Idempotent webhook replay safety
    }

    const bkRef = db.collection('bookings').doc(col.bookingId);
    const bkSnap = await tx.get(bkRef);
    if (!bkSnap.exists) {
      throw new HttpsError('not-found', 'Linked booking not found.');
    }
    const bk = bkSnap.data() as Booking;

    const updated: CollectionRecord = {
      ...col,
      razorpayOrderId: params.razorpayOrderId,
      razorpayPaymentId: params.razorpayPaymentId,
      razorpaySignatureVerified: true,
      allocatedAmountInr: col.paidAmountInr,
      receiptNumber: `BM-RCP-${col.id.slice(0, 6).toUpperCase()}`,
      status: 'VERIFIED',
      paidAt: nowIso,
      updatedAt: nowIso,
    };
    tx.set(colRef, updated);

    const nextCollected = bk.totalCollectedVerifiedInr + col.paidAmountInr;
    tx.update(bkRef, {
      totalCollectedVerifiedInr: nextCollected,
      outstandingBalanceInr: Math.max(0, bk.totalPayableInr - nextCollected),
      updatedAt: nowIso,
    });

    await writeAuditEvent(
      db,
      {
        orgId: col.orgId,
        actorUid: 'RAZORPAY_VERIFIED_WEBHOOK',
        action: 'RAZORPAY_COLLECTION_VERIFIED',
        category: 'PAYMENT',
        entityType: 'collection_record',
        entityId: col.id,
        summary: `Verified Razorpay payment ${params.razorpayPaymentId} (₹${col.paidAmountInr}) for Booking ${bk.bookingNumber}.`,
      },
      tx
    );

    return updated;
  });
}

export async function reconcileCollectionSettlementService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    collectionRecordId: string;
    bankStatementRef: string;
    settledAmountInr: number;
    gatewayFeeInr: number;
    notes?: string;
  }
): Promise<ReconciliationRecord> {
  const colSnap = await db.collection('collection_records').doc(params.collectionRecordId).get();
  if (!colSnap.exists || colSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Collection record not found.');
  }
  const col = colSnap.data() as CollectionRecord;
  const expectedNet = col.paidAmountInr - params.gatewayFeeInr;
  const discrepancy = Math.round(params.settledAmountInr - expectedNet);

  const ref = db.collection('reconciliation_records').doc();
  const rec: ReconciliationRecord = {
    id: ref.id,
    orgId: params.orgId,
    bookingId: col.bookingId,
    collectionRecordId: col.id,
    bankStatementRef: params.bankStatementRef.trim(),
    expectedAmountInr: expectedNet,
    settledAmountInr: params.settledAmountInr,
    gatewayFeeInr: params.gatewayFeeInr,
    discrepancyAmountInr: discrepancy,
    status: discrepancy === 0 ? 'MATCHED' : 'DISCREPANCY',
    reconciledByUid: actor.uid,
    notes: params.notes,
    reconciledAt: new Date().toISOString(),
  };

  await ref.set(rec);
  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    action: 'COLLECTION_RECONCILED',
    category: 'PAYMENT',
    entityType: 'reconciliation_record',
    entityId: rec.id,
    summary: `Reconciled collection ${col.id} (${rec.status}, discrepancy=₹${discrepancy}).`,
  });

  return rec;
}

// --- Cloud Functions v2 Callables & Razorpay Collections Webhook ---

export const recordCollectionEntry = onCall(async (request) => {
  const parsed = recordCollectionSchema.parse(request.data);
  const perm = parsed.recordType === 'REFUND' ? 'collections:refund' : 'collections:record';
  const { actor, member } = await requireOrgPermission(request, parsed.orgId, perm);
  return recordCollectionEntryService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );
});

export const createRazorpayCollectionOrder = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    collectionRecordId: z.string().min(1),
  });
  const input = schema.parse(request.data);
  await requireOrgPermission(request, input.orgId, 'collections:record');

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new HttpsError(
      'failed-precondition',
      'Razorpay merchant credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) are not configured on backend.'
    );
  }

  const colRef = adminDb.collection('collection_records').doc(input.collectionRecordId);
  const colSnap = await colRef.get();
  if (!colSnap.exists || colSnap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'Collection record not found.');
  }
  const col = colSnap.data() as CollectionRecord;

  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await rzp.orders.create({
    amount: Math.round(col.paidAmountInr * 100), // paise
    currency: 'INR',
    receipt: col.id,
    notes: {
      system: 'BUILDER_CUSTOMER_COLLECTIONS',
      orgId: col.orgId,
      collectionRecordId: col.id,
      bookingId: col.bookingId,
    },
  });

  await colRef.update({
    razorpayOrderId: order.id,
    updatedAt: new Date().toISOString(),
  });

  return { orderId: order.id, amountPaise: order.amount, currency: order.currency };
});

export const reconcileCollectionSettlement = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    collectionRecordId: z.string().min(1),
    bankStatementRef: z.string().min(2).max(120),
    settledAmountInr: z.coerce.number().nonnegative(),
    gatewayFeeInr: z.coerce.number().nonnegative().default(0),
    notes: z.string().max(400).optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'collections:reconcile');
  return reconcileCollectionSettlementService(adminDb, actor, input);
});

export const razorpayCollectionsWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const sig = req.header('x-razorpay-signature');
  if (!verifyRazorpayHmacSignature(req.rawBody, sig, secret)) {
    res.status(401).json({ error: 'Invalid X-Razorpay-Signature.' });
    return;
  }

  const event = req.body as any;
  if (event?.event === 'payment.captured') {
    const payment = event?.payload?.payment?.entity;
    const notes = payment?.notes ?? {};
    if (notes.system === 'BUILDER_CUSTOMER_COLLECTIONS' && notes.collectionRecordId) {
      const colRef = adminDb.collection('collection_records').doc(String(notes.collectionRecordId));
      const snap = await colRef.get();
      if (snap.exists && snap.data()?.status !== 'VERIFIED') {
        const col = snap.data() as CollectionRecord;
        const bkRef = adminDb.collection('bookings').doc(col.bookingId);
        const bkSnap = await bkRef.get();
        const nowIso = new Date().toISOString();

        await colRef.update({
          razorpayPaymentId: payment.id,
          razorpaySignatureVerified: true,
          allocatedAmountInr: col.paidAmountInr,
          receiptNumber: `BM-RCP-${col.id.slice(0, 6).toUpperCase()}`,
          status: 'VERIFIED',
          paidAt: nowIso,
          updatedAt: nowIso,
        });

        if (bkSnap.exists) {
          const bk = bkSnap.data() as Booking;
          const nextCollected = bk.totalCollectedVerifiedInr + col.paidAmountInr;
          await bkRef.update({
            totalCollectedVerifiedInr: nextCollected,
            outstandingBalanceInr: Math.max(0, bk.totalPayableInr - nextCollected),
            updatedAt: nowIso,
          });
        }
      }
    }
  }

  res.status(200).json({ ok: true });
});

export async function sendPaymentReminderService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    bookingId: string;
    collectionRecordId?: string;
    channel?: 'WHATSAPP' | 'EMAIL' | 'SMS';
    customMessage?: string;
  }
) {
  const bkRef = db.collection('bookings').doc(params.bookingId);
  const bkSnap = await bkRef.get();
  if (!bkSnap.exists || bkSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Booking not found.');
  }
  const bk = bkSnap.data() as Booking;

  let col: CollectionRecord | undefined;
  if (params.collectionRecordId) {
    const colSnap = await db.collection('collection_records').doc(params.collectionRecordId).get();
    if (colSnap.exists && colSnap.data()?.orgId === params.orgId) {
      col = colSnap.data() as CollectionRecord;
    }
  }

  const nowIso = new Date().toISOString();
  const reminderDoc = db.collection('payment_reminders').doc();
  const milestoneName = col?.milestoneName || 'Pending Installment';
  const amountDue = col
    ? (col.demandAmountInr > col.paidAmountInr ? col.demandAmountInr - col.paidAmountInr : col.demandAmountInr)
    : bk.outstandingBalanceInr;
  const dueDate = col?.dueDate || bk.bookedAt || nowIso;
  const isOverdue = new Date(dueDate).getTime() < Date.now();

  const formattedAmount = `₹${amountDue.toLocaleString('en-IN')}`;
  const message = params.customMessage ||
    `Dear ${bk.customer.fullName}, this is a reminder regarding your booking for Unit ${bk.unitNumber}. ${isOverdue ? 'OVERDUE: ' : ''}Amount due is ${formattedAmount} for ${milestoneName} (Due date: ${new Date(dueDate).toLocaleDateString('en-IN')}). Please complete the payment. Thank you!`;

  const reminderRecord = {
    id: reminderDoc.id,
    orgId: params.orgId,
    projectId: bk.projectId,
    bookingId: bk.id,
    collectionRecordId: col?.id ?? null,
    customerName: bk.customer.fullName,
    customerPhone: bk.customer.phone,
    customerEmail: bk.customer.email,
    unitNumber: bk.unitNumber,
    channel: params.channel || 'WHATSAPP',
    amountDueInr: amountDue,
    milestoneName,
    dueDate,
    isOverdue,
    message,
    sentByUid: actor.uid,
    sentAt: nowIso,
    status: 'SENT',
    createdAt: nowIso,
  };

  await reminderDoc.set(reminderRecord);

  if (col) {
    await db.collection('collection_records').doc(col.id).update({
      lastReminderSentAt: nowIso,
      reminderCount: ((col as any).reminderCount ?? 0) + 1,
      updatedAt: nowIso,
    });
  }

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    action: 'PAYMENT_REMINDER_SENT',
    category: 'SYSTEM',
    entityType: 'booking',
    entityId: bk.id,
    summary: `Sent payment reminder to ${bk.customer.fullName} for Unit ${bk.unitNumber} (${milestoneName}, ${formattedAmount}).`,
  });

  return reminderRecord;
}

export async function sendBatchPaymentRemindersService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    projectId?: string;
    filterType: 'OVERDUE' | 'DUE_SOON' | 'ALL_PENDING';
  }
) {
  let bkQuery = db.collection('bookings').where('orgId', '==', params.orgId);
  if (params.projectId) {
    bkQuery = bkQuery.where('projectId', '==', params.projectId);
  }
  const bkSnap = await bkQuery.get();
  const bookings = bkSnap.docs
    .map((d) => d.data() as Booking)
    .filter((b) => b.status !== 'CANCELLED' && b.outstandingBalanceInr > 0);

  let colQuery = db.collection('collection_records').where('orgId', '==', params.orgId);
  if (params.projectId) {
    colQuery = colQuery.where('projectId', '==', params.projectId);
  }
  const colSnap = await colQuery.get();
  const collections = colSnap.docs.map((d) => d.data() as CollectionRecord);

  const now = Date.now();
  const sentReminders: any[] = [];

  for (const bk of bookings) {
    const demands = collections.filter(
      (c) => c.bookingId === bk.id && (c.status === 'DUE' || c.recordType === 'MILESTONE_DEMAND') && c.demandAmountInr > c.paidAmountInr
    );

    if (demands.length > 0) {
      for (const col of demands) {
        const dueTime = col.dueDate ? new Date(col.dueDate).getTime() : 0;
        const isOverdue = dueTime > 0 && dueTime < now;
        const isDueSoon = dueTime > 0 && dueTime >= now && dueTime <= now + 7 * 86400000;

        let shouldSend = false;
        if (params.filterType === 'OVERDUE' && isOverdue) shouldSend = true;
        if (params.filterType === 'DUE_SOON' && isDueSoon) shouldSend = true;
        if (params.filterType === 'ALL_PENDING' && (isOverdue || isDueSoon)) shouldSend = true;

        if (shouldSend) {
          const rem = await sendPaymentReminderService(db, actor, {
            orgId: params.orgId,
            bookingId: bk.id,
            collectionRecordId: col.id,
            channel: 'WHATSAPP',
          });
          sentReminders.push(rem);
        }
      }
    } else if (params.filterType === 'ALL_PENDING' || params.filterType === 'DUE_SOON') {
      const rem = await sendPaymentReminderService(db, actor, {
        orgId: params.orgId,
        bookingId: bk.id,
        channel: 'WHATSAPP',
      });
      sentReminders.push(rem);
    }
  }

  return {
    sentCount: sentReminders.length,
    reminders: sentReminders,
  };
}

export const sendPaymentReminder = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    bookingId: z.string().min(1),
    collectionRecordId: z.string().optional(),
    channel: z.enum(['WHATSAPP', 'EMAIL', 'SMS']).default('WHATSAPP'),
    customMessage: z.string().optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'collections:record');
  return sendPaymentReminderService(adminDb, actor, input);
});

export const sendBatchPaymentReminders = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().optional(),
    filterType: z.enum(['OVERDUE', 'DUE_SOON', 'ALL_PENDING']),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'collections:record');
  return sendBatchPaymentRemindersService(adminDb, actor, input);
});
