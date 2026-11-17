import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  calculateCostSheet,
  canTransitionPriceBook,
  formatCurrency,
  isPriceBookImmutable,
  type CostSheetLineItemRule,
  type CostSheetTemplate,
  type PriceBook,
  type PriceRevision,
  type PricingScopeOverride,
  type Unit,
} from '@bharat-makaan/shared';
import {
  savePricingScopeOverrideSchema,
  upsertCostSheetTemplateSchema,
  upsertPriceBookSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { parseCallableInput } from '../shared/validation';
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
  const input = parseCallableInput(upsertPriceBookSchema, rawInput);
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
      currencyCode: input.currencyCode ?? existing.currencyCode,
      areaUnit: input.areaUnit ?? existing.areaUnit,
      pricingMode: input.pricingMode ?? existing.pricingMode,
      baseUnitPrice: input.baseUnitPrice ?? existing.baseUnitPrice,
      baseConsiderationLabel: input.baseConsiderationLabel ?? existing.baseConsiderationLabel,
      floorRiseLabel: input.floorRiseLabel ?? existing.floorRiseLabel,
      parkingLabel: input.parkingLabel ?? existing.parkingLabel,
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
      offers: input.offers ?? existing.offers,
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

  // Determine next version number for this project or reuse existing unactivated draft
  const prevBooksSnap = await db
    .collection('price_books')
    .where('orgId', '==', input.orgId)
    .where('projectId', '==', input.projectId)
    .get();

  const existingDraftDoc = !input.priceBookId
    ? prevBooksSnap.docs.find((d) => (d.data() as PriceBook).status === 'DRAFT')
    : null;

  const maxVersion = prevBooksSnap.docs.reduce((max, d) => {
    const v = (d.data() as PriceBook).versionNumber ?? 0;
    return v > max ? v : max;
  }, 0);

  const pbRef = existingDraftDoc ? existingDraftDoc.ref : db.collection('price_books').doc();
  const existingDraftData = existingDraftDoc ? (existingDraftDoc.data() as PriceBook) : null;
  const versionNumber = existingDraftData?.versionNumber ?? (maxVersion + 1);

  const created: PriceBook = {
    id: pbRef.id,
    orgId: input.orgId,
    projectId: input.projectId,
    name: input.name.trim(),
    description: input.description?.trim(),
    versionNumber,
    parentPriceBookId: null,
    status: 'DRAFT',
    isImmutable: false,
    effectiveFrom: input.effectiveFrom,
    expiresAt: input.expiresAt ?? null,
    currencyCode: input.currencyCode,
    areaUnit: input.areaUnit,
    pricingMode: input.pricingMode,
    baseUnitPrice: input.baseUnitPrice,
    baseConsiderationLabel: input.baseConsiderationLabel,
    floorRiseLabel: input.floorRiseLabel,
    parkingLabel: input.parkingLabel,
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
    offers: input.offers,
    maxDiscountPctWithoutApproval: input.maxDiscountPctWithoutApproval,
    defaultPaymentPlanId: input.defaultPaymentPlanId ?? null,
    internalNotes: input.internalNotes,
    createdByUid: existingDraftData?.createdByUid ?? actor.uid,
    approvedByUid: null,
    approvedAt: null,
    createdAt: existingDraftData?.createdAt ?? nowIso,
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

  const currencyLabel = pb.currencyCode ?? 'INR';
  const areaLabel = pb.areaUnit ?? 'SQFT';
  const rateText =
    pb.pricingMode === 'BASE_UNIT_PRICE'
      ? `Base ${formatCurrency(pb.baseUnitPrice ?? pb.basePricePerSqft, currencyLabel)}`
      : `Base ${formatCurrency(pb.basePricePerSqft, currencyLabel)}/${areaLabel.toLowerCase()}`;

  await createApprovalRequestService(db, {
    orgId: params.orgId,
    entityType: 'PRICE_BOOK',
    entityId: pb.id,
    projectId: pb.projectId,
    requestedByUid: actor.uid,
    requestedByName: actorName,
    requiredPermission: 'pricing:approve',
    requestSummary: `Approve Price Book "${pb.name}" v${pb.versionNumber} (${rateText})`,
    payloadSnapshot: {
      versionNumber: pb.versionNumber,
      basePricePerSqft: pb.basePricePerSqft,
      currencyCode: currencyLabel,
      areaUnit: areaLabel,
      effectiveFrom: pb.effectiveFrom,
    },
  });

  return updated;
}

/**
 * Activates an APPROVED price book, archives any previously ACTIVE price book,
 * recalculates AVAILABLE / ON_HOLD units applying 6-level inherited `pricing_overrides`
 * (never mutating BOOKED/AGREEMENT/REGISTERED units or previously issued quotation snapshots!),
 * and writes unit-level `price_revisions`.
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
      `Price book in status ${pb.status} cannot be transitioned to ACTIVE.`
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
    approvedByUid: pb.approvedByUid ?? actor.uid,
    approvedAt: pb.approvedAt ?? nowIso,
    updatedAt: nowIso,
  };
  batch.set(pbRef, activatedBook);

  // Load 6-level inherited pricing overrides & unbooked inventory units
  const [unitsSnap, overridesSnap] = await Promise.all([
    db
      .collection('units')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', pb.projectId)
      .get(),
    db.collection('pricing_overrides').where('orgId', '==', params.orgId).get(),
  ]);

  const overrides = overridesSnap.docs.map((d) => d.data() as PricingScopeOverride);

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
      // Activation is an explicit rate revision; quotations use the saved unit rate.
      unit: { ...unit, baseRatePerSqft: undefined },
      priceBook: activatedBook,
      overrides,
    });

    const newTotal = computed.totalPayableInr;
    const premiumSum =
      computed.facingPremiumInr +
      computed.viewPremiumInr +
      computed.cornerPremiumInr +
      computed.locationPremiumInr +
      computed.unitSpecificPremiumInr;

    batch.update(unitDoc.ref, {
      baseRatePerSqft: computed.baseRatePerSqft,
      activePriceBookId: activatedBook.id,
      floorRiseAmount: computed.floorRiseInr,
      premiumChargesAmount: premiumSum,
      calculatedTotalPrice: newTotal,
      calculatedTotalMinor: computed.totalPayableMinor,
      updatedAt: nowIso,
    });
    updatedUnitsCount++;

    if (oldTotal !== newTotal || oldBaseRate !== computed.baseRatePerSqft) {
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
        newBaseRate: computed.baseRatePerSqft,
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

export async function savePricingScopeOverrideService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<PricingScopeOverride> {
  const input = savePricingScopeOverrideSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  const prevSnap = await db
    .collection('pricing_overrides')
    .where('orgId', '==', input.orgId)
    .where('scopeLevel', '==', input.scopeLevel)
    .where('targetId', '==', input.targetId)
    .get();

  const maxVersion = prevSnap.docs.reduce(
    (max, d) => Math.max(max, (d.data() as PricingScopeOverride).versionNumber ?? 0),
    0
  );

  const ref = input.overrideId
    ? db.collection('pricing_overrides').doc(input.overrideId)
    : db.collection('pricing_overrides').doc();

  const override: PricingScopeOverride = {
    id: ref.id,
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    scopeLevel: input.scopeLevel,
    targetId: input.targetId,
    label: input.label?.trim(),
    versionNumber: maxVersion + 1,
    isActive: input.isActive,
    currencyCode: input.currencyCode,
    areaUnit: input.areaUnit,
    pricingMode: input.pricingMode,
    basePricePerArea: input.basePricePerArea,
    baseUnitPrice: input.baseUnitPrice,
    baseConsiderationLabel: input.baseConsiderationLabel,
    floorRise: input.floorRise,
    facingPremiumPerSqft: input.facingPremiumPerSqft,
    viewPremiumPerSqft: input.viewPremiumPerSqft,
    cornerPremiumPerSqft: input.cornerPremiumPerSqft,
    locationPremiumPerSqft: input.locationPremiumPerSqft,
    parkingPricesByType: input.parkingPricesByType,
    lineItemsOverride: input.lineItemsOverride,
    taxConfigOverride: input.taxConfigOverride,
    maxDiscountPctWithoutApproval: input.maxDiscountPctWithoutApproval,
    offers: input.offers,
    effectiveFrom: input.effectiveFrom,
    createdByUid: actor.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ref.set(override);
  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'PRICING_SCOPE_OVERRIDE_SAVED',
    category: 'PRICING',
    entityType: 'pricing_override',
    entityId: override.id,
    summary: `Saved ${override.scopeLevel} pricing override v${override.versionNumber} for target "${override.targetId}".`,
    after: {
      scopeLevel: override.scopeLevel,
      targetId: override.targetId,
      versionNumber: override.versionNumber,
      isActive: override.isActive,
    },
  });

  return override;
}

export async function upsertCostSheetTemplateService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<CostSheetTemplate> {
  const input = upsertCostSheetTemplateSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  const ref = input.templateId
    ? db.collection('cost_sheet_templates').doc(input.templateId)
    : db.collection('cost_sheet_templates').doc();

  const existingSnap = input.templateId ? await ref.get() : null;
  if (existingSnap && existingSnap.exists && existingSnap.data()?.orgId !== input.orgId) {
    throw new HttpsError('permission-denied', 'Template belongs to a different organization.');
  }

  const template: CostSheetTemplate = {
    id: ref.id,
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    isDefault: input.isDefault,
    headerConfig: input.headerConfig,
    sectionToggles: input.sectionToggles,
    customLabels: input.customLabels,
    defaultTermsAndConditions: input.defaultTermsAndConditions,
    footerText: input.footerText,
    createdByUid: existingSnap?.exists
      ? (existingSnap.data() as CostSheetTemplate).createdByUid
      : actor.uid,
    createdAt: existingSnap?.exists
      ? (existingSnap.data() as CostSheetTemplate).createdAt
      : nowIso,
    updatedAt: nowIso,
  };

  await ref.set(template);

  // If projectId is provided and isDefault is true, bind project.defaultCostSheetTemplateId automatically
  if (input.projectId && input.isDefault) {
    const projRef = db.collection('projects').doc(input.projectId);
    const projSnap = await projRef.get();
    if (projSnap.exists && projSnap.data()?.orgId === input.orgId) {
      await projRef.update({
        defaultCostSheetTemplateId: template.id,
        updatedAt: nowIso,
      });
    }
  }

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'COST_SHEET_TEMPLATE_SAVED',
    category: 'PRICING',
    entityType: 'cost_sheet_template',
    entityId: template.id,
    summary: `Saved cost-sheet template "${template.name}" (${template.code})${template.projectId ? ` for project ${template.projectId}` : ' (Organization-wide)'}.`,
  });

  return template;
}

// --- Cloud Functions v2 Callables ---

export const savePriceBookDraft = onCall(async (request) => {
  const parsed = parseCallableInput(upsertPriceBookSchema, request.data);
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

export const savePricingScopeOverride = onCall(async (request) => {
  const parsed = savePricingScopeOverrideSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'pricing:edit_draft',
    parsed.projectId ?? null
  );
  return savePricingScopeOverrideService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );
});

export const upsertCostSheetTemplate = onCall(async (request) => {
  const parsed = upsertCostSheetTemplateSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'pricing:edit_draft',
    parsed.projectId ?? null
  );
  return upsertCostSheetTemplateService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );
});

/**
 * Automatically provisions or initializes a Version 1 Draft Price Book
 * when towers or flats/inventory are generated for a project.
 */
export async function ensureBaselinePriceBookForProject(
  db: Firestore,
  params: {
    orgId: string;
    projectId: string;
    baseRatePerSqft: number;
    actorUid: string;
    actorEmail?: string;
    actorRole?: string;
  }
): Promise<PriceBook | null> {
  if (!params.orgId || !params.projectId) return null;

  // Check if any price book already exists for this project
  const existingBooksSnap = await db
    .collection('price_books')
    .where('orgId', '==', params.orgId)
    .where('projectId', '==', params.projectId)
    .get();

  const nowIso = new Date().toISOString();
  const effectiveDate = nowIso.slice(0, 10);

  // If there's an ACTIVE book, leave it untouched
  const activeBook = existingBooksSnap.docs.find((d) => (d.data() as PriceBook).status === 'ACTIVE');
  if (activeBook) {
    return activeBook.data() as PriceBook;
  }

  // If there's an existing DRAFT book, ensure its base rate reflects inventory if it was not customized
  const draftBookDoc = existingBooksSnap.docs.find((d) => (d.data() as PriceBook).status === 'DRAFT');
  if (draftBookDoc) {
    const draftBook = draftBookDoc.data() as PriceBook;
    if (params.baseRatePerSqft > 0 && draftBook.basePricePerSqft !== params.baseRatePerSqft) {
      await draftBookDoc.ref.update({
        basePricePerSqft: params.baseRatePerSqft,
        updatedAt: nowIso,
      });
      return { ...draftBook, basePricePerSqft: params.baseRatePerSqft, updatedAt: nowIso };
    }
    return draftBook;
  }

  // Fetch project to align currency and area unit
  const projSnap = await db.collection('projects').doc(params.projectId).get();
  const projData = projSnap.data();
  const currencyCode = projData?.currencyCode ?? 'INR';
  const areaUnit = projData?.areaUnit ?? 'SQFT';

  const rate =
    params.baseRatePerSqft > 0
      ? params.baseRatePerSqft
      : typeof projData?.startingPriceInr === 'number' && projData.startingPriceInr > 0
        ? Math.round(projData.startingPriceInr / 1500)
        : 8500;

  const pbRef = db.collection('price_books').doc();
  const initialPriceBook: PriceBook = {
    id: pbRef.id,
    orgId: params.orgId,
    projectId: params.projectId,
    name: 'Launch Price Book (v1)',
    description: 'Auto-generated Version 1 pricing baseline from project inventory setup.',
    versionNumber: 1,
    parentPriceBookId: null,
    status: 'DRAFT',
    isImmutable: false,
    effectiveFrom: effectiveDate,
    expiresAt: null,
    currencyCode,
    areaUnit,
    pricingMode: 'PER_AREA',
    basePricePerSqft: rate,
    floorRise: {
      enabled: true,
      startFloor: 2,
      ratePerFloorPerSqft: 50,
    },
    facingPremiumPerSqft: {
      EAST: 150,
      NORTH: 100,
      NORTH_EAST: 150,
    },
    viewPremiumPerSqft: {
      CENTRAL_PARK: 125,
    },
    cornerPremiumPerSqft: 100,
    locationPremiumPerSqft: 0,
    unitSpecificPremiumInr: {},
    parkingPricesByType: {
      STANDARD: 450000,
      TANDEM: 750000,
      MECHANICAL: 450000,
      EV: 550000,
      ACCESSIBLE: 450000,
    },
    lineItems: structuredClone(DEFAULT_LINE_ITEMS_TEMPLATE),
    taxConfig: {
      agreementGstPct: 5,
      otherServiceGstPct: 18,
      roundingMode: 'NEAREST_RUPEE',
      registrationDisclaimer:
        'Stamp duty & registration charges are payable at actuals as per prevailing Government norms.',
    },
    maxDiscountPctWithoutApproval: 2.5,
    defaultPaymentPlanId: null,
    internalNotes: 'Auto-generated Version 1 draft price book on inventory generation.',
    createdByUid: params.actorUid,
    approvedByUid: null,
    approvedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await pbRef.set(initialPriceBook);

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: params.actorUid,
    actorEmail: params.actorEmail ?? 'system@bharatmakaan.com',
    actorRole: params.actorRole ?? 'SYSTEM',
    action: 'PRICE_BOOK_DRAFT_CREATED',
    category: 'PRICING',
    entityType: 'price_book',
    entityId: initialPriceBook.id,
    summary: `Auto-generated Version 1 draft price book "${initialPriceBook.name}" (Base: ${rate}/sq.ft.).`,
  });

  return initialPriceBook;
}

export const ensureBaselinePriceBook = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    baseRatePerSqft: z.coerce.number().nonnegative().default(0),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'pricing:view',
    input.projectId
  );
  return ensureBaselinePriceBookForProject(adminDb, {
    orgId: input.orgId,
    projectId: input.projectId,
    baseRatePerSqft: input.baseRatePerSqft,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: member?.role ?? 'PLATFORM_SUPER_ADMIN',
  });
});

