import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  calculateCostSheet,
  canTransitionPriceBook,
  isPriceBookImmutable,
  type CostSheetLineItemRule,
  type PriceBook,
  type PriceRevision,
  type Unit,
} from '@bharat-makaan/shared';
import { upsertPriceBookSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { createApprovalRequestService } from '../approvals';
import { writeAuditEvent } from '../audit';

export const DEFAULT_LINE_ITEMS_TEMPLATE: CostSheetLineItemRule[] = [
  {
    id: 'li-amenities',
    internalKey: 'amenities_charges',
    displayLabel: 'Amenities Charges',
    description: 'Clubhouse, recreational & lifestyle amenities membership',
    basis: 'FIXED_AMOUNT',
    amount: 500000,
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
    description: 'External electrification, STP, water & DG infrastructure',
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
    displayLabel: 'Advance Maintenance Charges (24 Months)',
    description: 'Common area maintenance advance payable at possession',
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
    description: 'Sale agreement drafting & legal processing charges',
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
    displayLabel: 'Corpus / Sinking Fund Deposit',
    description: 'Interest-free society corpus fund deposit',
    basis: 'PER_SQFT_SALEABLE',
    amount: 200,
    taxCategory: 'EXEMPT_CORPUS',
    isOptional: false,
    isVisible: true,
    isRemovable: true,
    displayOrder: 5,
  },
];

export async function savePriceBookDraftService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<PriceBook> {
  const input = upsertPriceBookSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  if (input.priceBookId) {
    const existingRef = db.collection('price_books').doc(input.priceBookId);
    const existingSnap = await existingRef.get();
    if (!existingSnap.exists || existingSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Price book not found.');
    }
    const existing = existingSnap.data() as PriceBook;

    if (existing.isImmutable || isPriceBookImmutable(existing.status)) {
      throw new HttpsError(
        'failed-precondition',
        `Price book v${existing.versionNumber} (${existing.status}) is immutable. Clone a new version to make changes.`
      );
    }

    const updated: PriceBook = {
      ...existing,
      name: input.name.trim(),
      description: input.description?.trim(),
      effectiveFrom: input.effectiveFrom,
      expiresAt: input.expiresAt ?? null,
      basePricePerSqft: input.basePricePerSqft,
      floorRise: input.floorRise,
      facingPremiumPerSqft: input.facingPremiumPerSqft,
      viewPremiumPerSqft: input.viewPremiumPerSqft,
      cornerPremiumPerSqft: input.cornerPremiumPerSqft,
      locationPremiumPerSqft: input.locationPremiumPerSqft,
      unitSpecificPremiumInr: input.unitSpecificPremiumInr,
      parkingPricesByType: input.parkingPricesByType,
      lineItems: input.lineItems,
      taxConfig: input.taxConfig,
      maxDiscountPctWithoutApproval: input.maxDiscountPctWithoutApproval,
      defaultPaymentPlanId: input.defaultPaymentPlanId ?? null,
      internalNotes: input.internalNotes,
      status: 'DRAFT',
      updatedAt: nowIso,
    };

    await existingRef.set(updated);
    await writeAuditEvent(db, {
      orgId: input.orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole,
      action: 'PRICE_BOOK_DRAFT_UPDATED',
      category: 'PRICING',
      entityType: 'price_book',
      entityId: updated.id,
      summary: `Updated draft price book "${updated.name}" (v${updated.versionNumber}).`,
    });

    return updated;
  }

  // Determine next version number for this project
  const prevBooksSnap = await db
    .collection('price_books')
    .where('orgId', '==', input.orgId)
    .where('projectId', '==', input.projectId)
    .get();

  const maxVersion = prevBooksSnap.docs.reduce((max, d) => {
    const v = (d.data() as PriceBook).versionNumber ?? 0;
    return v > max ? v : max;
  }, 0);

  const pbRef = db.collection('price_books').doc();
  const created: PriceBook = {
    id: pbRef.id,
    orgId: input.orgId,
    projectId: input.projectId,
    name: input.name.trim(),
    description: input.description?.trim(),
    versionNumber: maxVersion + 1,
    parentPriceBookId: null,
    status: 'DRAFT',
    isImmutable: false,
    effectiveFrom: input.effectiveFrom,
    expiresAt: input.expiresAt ?? null,
    basePricePerSqft: input.basePricePerSqft,
    floorRise: input.floorRise,
    facingPremiumPerSqft: input.facingPremiumPerSqft,
    viewPremiumPerSqft: input.viewPremiumPerSqft,
    cornerPremiumPerSqft: input.cornerPremiumPerSqft,
    locationPremiumPerSqft: input.locationPremiumPerSqft,
    unitSpecificPremiumInr: input.unitSpecificPremiumInr,
    parkingPricesByType: input.parkingPricesByType,
    lineItems: input.lineItems,
    taxConfig: input.taxConfig,
    maxDiscountPctWithoutApproval: input.maxDiscountPctWithoutApproval,
    defaultPaymentPlanId: input.defaultPaymentPlanId ?? null,
    internalNotes: input.internalNotes,
    createdByUid: actor.uid,
    approvedByUid: null,
    approvedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await pbRef.set(created);
  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'PRICE_BOOK_DRAFT_CREATED',
    category: 'PRICING',
    entityType: 'price_book',
    entityId: created.id,
    summary: `Created draft price book "${created.name}" (v${created.versionNumber}).`,
  });

  return created;
}

export async function clonePriceBookVersionService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  params: { orgId: string; sourcePriceBookId: string; newName?: string }
): Promise<PriceBook> {
  const sourceSnap = await db.collection('price_books').doc(params.sourcePriceBookId).get();
  if (!sourceSnap.exists || sourceSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Source price book not found.');
  }
  const source = sourceSnap.data() as PriceBook;

  const allSnap = await db
    .collection('price_books')
    .where('orgId', '==', params.orgId)
    .where('projectId', '==', source.projectId)
    .get();
  const maxVersion = allSnap.docs.reduce(
    (max, d) => Math.max(max, (d.data() as PriceBook).versionNumber ?? 0),
    0
  );

  const nowIso = new Date().toISOString();
  const ref = db.collection('price_books').doc();
  const cloned: PriceBook = {
    ...structuredClone(source),
    id: ref.id,
    name: params.newName?.trim() || `${source.name} (v${maxVersion + 1})`,
    versionNumber: maxVersion + 1,
    parentPriceBookId: source.id,
    status: 'DRAFT',
    isImmutable: false,
    createdByUid: actor.uid,
    approvedByUid: null,
    approvedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ref.set(cloned);
  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'PRICE_BOOK_CLONED',
    category: 'PRICING',
    entityType: 'price_book',
    entityId: cloned.id,
    summary: `Cloned price book v${source.versionNumber} -> new draft v${cloned.versionNumber}.`,
  });

  return cloned;
}

export async function submitPriceBookForApprovalService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorName: string,
  params: { orgId: string; priceBookId: string }
): Promise<PriceBook> {
  const pbRef = db.collection('price_books').doc(params.priceBookId);
  const snap = await pbRef.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Price book not found.');
  }
  const pb = snap.data() as PriceBook;
  if (!canTransitionPriceBook(pb.status, 'PENDING_APPROVAL')) {
    throw new HttpsError(
      'failed-precondition',
      `Price book in status ${pb.status} cannot be submitted for approval.`
    );
  }

  const nowIso = new Date().toISOString();
  const updated: PriceBook = {
    ...pb,
    status: 'PENDING_APPROVAL',
    updatedAt: nowIso,
  };
  await pbRef.set(updated);

  await createApprovalRequestService(db, {
    orgId: params.orgId,
    entityType: 'PRICE_BOOK',
    entityId: pb.id,
    projectId: pb.projectId,
    requestedByUid: actor.uid,
    requestedByName: actorName,
    requiredPermission: 'pricing:approve',
    requestSummary: `Approve Price Book "${pb.name}" v${pb.versionNumber} (Base ₹${pb.basePricePerSqft}/sq.ft.)`,
    payloadSnapshot: {
      versionNumber: pb.versionNumber,
      basePricePerSqft: pb.basePricePerSqft,
      effectiveFrom: pb.effectiveFrom,
    },
  });

  return updated;
}

/**
 * Activates an APPROVED price book, archives any previously ACTIVE price book,
 * recalculates AVAILABLE / ON_HOLD units (never mutating BOOKED/AGREEMENT/REGISTERED units
 * or previously issued quotation snapshots!), and writes unit-level `price_revisions`.
 */
export async function activatePriceBookService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  params: { orgId: string; priceBookId: string; reason: string }
): Promise<{ activatedBook: PriceBook; updatedUnitsCount: number; revisionsCreated: number }> {
  const pbRef = db.collection('price_books').doc(params.priceBookId);
  const pbSnap = await pbRef.get();
  if (!pbSnap.exists || pbSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Price book not found.');
  }

  const pb = pbSnap.data() as PriceBook;
  if (!canTransitionPriceBook(pb.status, 'ACTIVE')) {
    throw new HttpsError(
      'failed-precondition',
      `Only APPROVED or SCHEDULED price books can be activated (current: ${pb.status}).`
    );
  }

  const nowIso = new Date().toISOString();

  // Archive existing ACTIVE price book for the same project
  const prevActiveSnap = await db
    .collection('price_books')
    .where('orgId', '==', params.orgId)
    .where('projectId', '==', pb.projectId)
    .where('status', '==', 'ACTIVE')
    .get();

  let previousActiveBook: PriceBook | null = null;
  const batch = db.batch();

  for (const docSnap of prevActiveSnap.docs) {
    if (docSnap.id !== pb.id) {
      previousActiveBook = docSnap.data() as PriceBook;
      batch.update(docSnap.ref, { status: 'ARCHIVED', isImmutable: true, updatedAt: nowIso });
    }
  }

  const activatedBook: PriceBook = {
    ...pb,
    status: 'ACTIVE',
    isImmutable: true,
    updatedAt: nowIso,
  };
  batch.set(pbRef, activatedBook);

  // Recalculate unbooked inventory units & generate price_revisions
  const unitsSnap = await db
    .collection('units')
    .where('orgId', '==', params.orgId)
    .where('projectId', '==', pb.projectId)
    .get();

  let updatedUnitsCount = 0;
  let revisionsCreated = 0;

  for (const unitDoc of unitsSnap.docs) {
    const unit = unitDoc.data() as Unit;
    if (
      unit.status === 'BOOKED' ||
      unit.status === 'AGREEMENT' ||
      unit.status === 'REGISTERED'
    ) {
      continue; // Sold/booked units retain their contracted booking price
    }

    const oldTotal = unit.calculatedTotalPrice;
    const oldBaseRate = unit.baseRatePerSqft;
    const computed = calculateCostSheet({
      unit,
      priceBook: activatedBook,
    });

    const newTotal = computed.totalPayableInr;
    const premiumSum =
      computed.facingPremiumInr +
      computed.viewPremiumInr +
      computed.cornerPremiumInr +
      computed.locationPremiumInr +
      computed.unitSpecificPremiumInr;

    batch.update(unitDoc.ref, {
      baseRatePerSqft: activatedBook.basePricePerSqft,
      activePriceBookId: activatedBook.id,
      floorRiseAmount: computed.floorRiseInr,
      premiumChargesAmount: premiumSum,
      calculatedTotalPrice: newTotal,
      updatedAt: nowIso,
    });
    updatedUnitsCount++;

    if (oldTotal !== newTotal || oldBaseRate !== activatedBook.basePricePerSqft) {
      const revRef = db.collection('price_revisions').doc();
      const changeAmount = newTotal - oldTotal;
      const changePct =
        oldTotal > 0 ? Number(((changeAmount / oldTotal) * 100).toFixed(2)) : 0;

      const revision: PriceRevision = {
        id: revRef.id,
        orgId: params.orgId,
        projectId: pb.projectId,
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        previousPriceBookId: previousActiveBook?.id ?? unit.activePriceBookId ?? null,
        newPriceBookId: activatedBook.id,
        priceBookVersion: activatedBook.versionNumber,
        oldBaseRate,
        newBaseRate: activatedBook.basePricePerSqft,
        oldTotalValue: oldTotal,
        newTotalValue: newTotal,
        changeAmount,
        changePct,
        effectiveDate: activatedBook.effectiveFrom,
        changedByUid: activatedBook.createdByUid,
        approvedByUid: activatedBook.approvedByUid ?? actor.uid,
        reason: params.reason,
        createdAt: nowIso,
      };
      batch.set(revRef, revision);
      revisionsCreated++;
    }
  }

  await batch.commit();

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'PRICE_BOOK_ACTIVATED',
    category: 'PRICING',
    entityType: 'price_book',
    entityId: activatedBook.id,
    summary: `Activated Price Book "${activatedBook.name}" v${activatedBook.versionNumber}. Recalculated ${updatedUnitsCount} available units (${revisionsCreated} revisions).`,
    after: {
      versionNumber: activatedBook.versionNumber,
      basePricePerSqft: activatedBook.basePricePerSqft,
      updatedUnitsCount,
    },
  });

  return { activatedBook, updatedUnitsCount, revisionsCreated };
}

// --- Cloud Functions v2 Callables ---

export const savePriceBookDraft = onCall(async (request) => {
  const parsed = upsertPriceBookSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'pricing:edit_draft',
    parsed.projectId
  );
  return savePriceBookDraftService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const clonePriceBookVersion = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    sourcePriceBookId: z.string().min(1),
    newName: z.string().optional(),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'pricing:edit_draft',
    input.projectId
  );
  return clonePriceBookVersionService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', input);
});

export const submitPriceBookForApproval = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    priceBookId: z.string().min(1),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'pricing:submit_approval',
    input.projectId
  );
  return submitPriceBookForApprovalService(
    adminDb,
    actor,
    member?.displayName ?? actor.email ?? actor.uid,
    input
  );
});

export const activatePriceBook = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    priceBookId: z.string().min(1),
    reason: z.string().min(3).max(300),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'pricing:activate',
    input.projectId
  );
  return activatePriceBookService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', input);
});
