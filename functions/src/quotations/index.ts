import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import {
  calculateCostSheet,
  formatAreaSqft,
  formatInr,
  type Organization,
  type ParkingSlot,
  type PaymentPlan,
  type PriceBook,
  type Project,
  type Quotation,
  type QuotationVersion,
  type Unit,
} from '@bharat-makaan/shared';
import { createQuotationSchema, paymentPlanSchema } from '@bharat-makaan/validation';
import { adminDb, adminStorage } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { createApprovalRequestService } from '../approvals';
import { writeAuditEvent } from '../audit';

/**
 * Generates an authoritative, printable enterprise PDF document for a Quotation.
 * Note: Standard PDF WinAnsi fonts use "Rs." prefix for clean universal PDF rendering.
 */
export async function generateQuotationPdfBytes(params: {
  organization: Pick<Organization, 'name' | 'legalName' | 'reraNumber' | 'headquartersCity'>;
  project: Pick<Project, 'name' | 'code' | 'city' | 'locality' | 'reraNumber'>;
  unit: Pick<
    Unit,
    | 'unitNumber'
    | 'bhk'
    | 'unitType'
    | 'floorNumber'
    | 'saleableAreaSqft'
    | 'carpetAreaSqft'
    | 'facing'
    | 'floorPlanVersionId'
  >;
  quotation: Quotation;
}): Promise<Uint8Array> {
  const { organization, project, unit, quotation } = params;
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const fmtRs = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-IN')}`;

  let page = pdfDoc.addPage([595.28, 841.89]); // A4 Portrait
  let y = 800;

  const ensureSpace = (needed: number) => {
    if (y - needed < 50) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 800;
    }
  };

  // Header Banner
  page.drawRectangle({
    x: 36,
    y: y - 44,
    width: 523,
    height: 52,
    color: rgb(0.06, 0.15, 0.36),
  });
  page.drawText(organization.name.toUpperCase(), {
    x: 48,
    y: y - 16,
    size: 13,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(
    `${project.name} (${project.locality}, ${project.city}) | RERA: ${project.reraNumber}`,
    {
      x: 48,
      y: y - 33,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.85, 0.9, 1),
    }
  );
  y -= 64;

  // Quotation Metadata & Customer Block
  page.drawText(`COST SHEET & QUOTATION: ${quotation.quotationNumber} (v${quotation.currentVersion})`, {
    x: 36,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  y -= 15;
  page.drawText(
    `Issued: ${quotation.createdAt.slice(0, 10)}   |   Valid Until: ${quotation.validUntil.slice(0, 10)}   |   Status: ${quotation.status}`,
    { x: 36, y, size: 8.5, font: fontRegular, color: rgb(0.3, 0.35, 0.4) }
  );
  y -= 18;

  page.drawText(
    `Customer: ${quotation.customer.name} (${quotation.customer.phone})${quotation.customer.email ? ` | ${quotation.customer.email}` : ''}`,
    { x: 36, y, size: 9, font: fontBold }
  );
  y -= 14;
  page.drawText(
    `Unit: ${unit.unitNumber} | ${unit.bhk} (${unit.unitType}) | Floor ${unit.floorNumber} | Saleable: ${formatAreaSqft(unit.saleableAreaSqft)} | Carpet: ${formatAreaSqft(unit.carpetAreaSqft)} | Facing: ${unit.facing}`,
    { x: 36, y, size: 8.5, font: fontRegular }
  );
  y -= 13;
  page.drawText(
    `Floor Plan Ref: ${unit.floorPlanVersionId ?? 'Standard Approved Layout'} | Parking: ${quotation.parkingSlotsCount} (${quotation.parkingTypeUsed}) | Price Book v${quotation.priceBookVersion}`,
    { x: 36, y, size: 8, font: fontRegular, color: rgb(0.35, 0.4, 0.45) }
  );
  y -= 22;

  // Cost Breakdown Table Header
  page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 18, color: rgb(0.94, 0.95, 0.97) });
  page.drawText('COST COMPONENT', { x: 42, y: y + 1, size: 8, font: fontBold });
  page.drawText('BASE AMOUNT', { x: 300, y: y + 1, size: 8, font: fontBold });
  page.drawText('GST', { x: 400, y: y + 1, size: 8, font: fontBold });
  page.drawText('TOTAL', { x: 480, y: y + 1, size: 8, font: fontBold });
  y -= 18;

  for (const li of quotation.breakdown.lineItems) {
    ensureSpace(16);
    page.drawText(li.displayLabel.slice(0, 48), { x: 42, y, size: 8.2, font: fontRegular });
    page.drawText(fmtRs(li.baseAmountInr), { x: 300, y, size: 8.2, font: fontRegular });
    page.drawText(`${fmtRs(li.gstAmountInr)} (${li.gstPct}%)`, {
      x: 400,
      y,
      size: 7.8,
      font: fontRegular,
    });
    page.drawText(fmtRs(li.totalWithGstInr), { x: 480, y, size: 8.2, font: fontBold });
    y -= 14;
  }

  if (quotation.breakdown.discountAmountInr > 0) {
    ensureSpace(16);
    page.drawText('Less: Approved Special Discount', {
      x: 42,
      y,
      size: 8.5,
      font: fontBold,
      color: rgb(0.08, 0.5, 0.24),
    });
    page.drawText(`- ${fmtRs(quotation.breakdown.discountAmountInr)}`, {
      x: 300,
      y,
      size: 8.5,
      font: fontBold,
      color: rgb(0.08, 0.5, 0.24),
    });
    y -= 16;
  }

  // Grand Total Box
  ensureSpace(36);
  page.drawRectangle({ x: 36, y: y - 10, width: 523, height: 24, color: rgb(0.93, 0.96, 1) });
  page.drawText('TOTAL ALL-INCLUSIVE PAYABLE', {
    x: 42,
    y: y - 2,
    size: 9.5,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  page.drawText(`GST: ${fmtRs(quotation.breakdown.totalGstInr)}`, {
    x: 330,
    y: y - 2,
    size: 8.5,
    font: fontRegular,
  });
  page.drawText(fmtRs(quotation.breakdown.totalPayableInr), {
    x: 460,
    y: y - 2,
    size: 10,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  y -= 28;

  // Payment Schedule Section
  ensureSpace(50);
  page.drawText('PAYMENT SCHEDULE (RECONCILED TO 100%)', {
    x: 36,
    y,
    size: 9.5,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  y -= 16;

  page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 16, color: rgb(0.94, 0.95, 0.97) });
  page.drawText('#   MILESTONE / TRIGGER', { x: 42, y, size: 7.5, font: fontBold });
  page.drawText('%', { x: 315, y, size: 7.5, font: fontBold });
  page.drawText('CONSIDERATION + GST', { x: 350, y, size: 7.5, font: fontBold });
  page.drawText('INSTALLMENT TOTAL', { x: 470, y, size: 7.5, font: fontBold });
  y -= 16;

  for (const ms of quotation.breakdown.schedule) {
    ensureSpace(15);
    page.drawText(`${ms.sequence}. ${ms.name} (${ms.dueTrigger})`.slice(0, 52), {
      x: 42,
      y,
      size: 7.8,
      font: fontRegular,
    });
    page.drawText(`${ms.percentage}%`, { x: 315, y, size: 7.8, font: fontRegular });
    page.drawText(fmtRs(ms.installmentBaseInr + ms.installmentGstInr), {
      x: 350,
      y,
      size: 7.8,
      font: fontRegular,
    });
    page.drawText(fmtRs(ms.totalInstallmentPayableInr), {
      x: 470,
      y,
      size: 7.8,
      font: fontBold,
    });
    y -= 13;
  }

  // Disclaimer, Terms & Representative Footer
  ensureSpace(65);
  y -= 10;
  page.drawText(`Statutory Note: ${quotation.breakdown.registrationDisclaimer}`, {
    x: 36,
    y,
    size: 7.5,
    font: fontBold,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 13;
  page.drawText(`Terms: ${quotation.termsAndConditions.slice(0, 110)}`, {
    x: 36,
    y,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 14;
  page.drawText(
    `Prepared By: ${quotation.salesRepName}   |   Approved By: ${quotation.approvedByUid ?? 'Auto-Authorized Policy'}`,
    { x: 36, y, size: 7.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) }
  );

  return pdfDoc.save();
}

export async function createPaymentPlanService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<PaymentPlan> {
  const input = paymentPlanSchema.parse(rawInput);
  const nowIso = new Date().toISOString();
  const totalPct =
    Math.round(input.milestones.reduce((acc, m) => acc + m.percentage, 0) * 10000) / 10000;

  const ref = db.collection('payment_plans').doc();
  const plan: PaymentPlan = {
    id: ref.id,
    orgId: input.orgId,
    projectId: input.projectId,
    name: input.name.trim(),
    planType: input.planType,
    isActive: true,
    milestones: input.milestones,
    totalPercentage: totalPct,
    createdByUid: actor.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ref.set(plan);
  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'PAYMENT_PLAN_CREATED',
    category: 'PRICING',
    entityType: 'payment_plan',
    entityId: plan.id,
    summary: `Created ${plan.planType} payment plan "${plan.name}" (${plan.milestones.length} milestones, 100%).`,
  });

  return plan;
}

export async function createQuotationService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorName: string,
  actorRole: string,
  rawInput: unknown
): Promise<{ quotation: Quotation; version: QuotationVersion; pdfBytes: Uint8Array }> {
  const input = createQuotationSchema.parse(rawInput);
  const now = new Date();
  const nowIso = now.toISOString();

  const [orgSnap, projSnap, unitSnap, pbSnap, planSnap] = await Promise.all([
    db.collection('organizations').doc(input.orgId).get(),
    db.collection('projects').doc(input.projectId).get(),
    db.collection('units').doc(input.unitId).get(),
    db.collection('price_books').doc(input.priceBookId).get(),
    db.collection('payment_plans').doc(input.paymentPlanId).get(),
  ]);

  if (!orgSnap.exists || !projSnap.exists || !unitSnap.exists || !pbSnap.exists || !planSnap.exists) {
    throw new HttpsError(
      'not-found',
      'Organization, project, unit, price book, or payment plan not found.'
    );
  }

  const org = orgSnap.data() as Organization;
  const project = projSnap.data() as Project;
  const unit = unitSnap.data() as Unit;
  const priceBook = pbSnap.data() as PriceBook;
  const paymentPlan = planSnap.data() as PaymentPlan;

  if (priceBook.status !== 'APPROVED' && priceBook.status !== 'ACTIVE') {
    throw new HttpsError(
      'failed-precondition',
      `Quotations require an APPROVED or ACTIVE price book (selected: ${priceBook.status}).`
    );
  }

  let allocatedSlots: ParkingSlot[] = [];
  if (input.selectedParkingSlotIds.length > 0) {
    const slotSnaps = await Promise.all(
      input.selectedParkingSlotIds.map((id) => db.collection('parking_slots').doc(id).get())
    );
    allocatedSlots = slotSnaps
      .filter((s) => s.exists)
      .map((s) => s.data() as ParkingSlot);
  }

  const breakdown = calculateCostSheet({
    unit,
    priceBook,
    paymentPlan,
    allocatedParkingSlots: allocatedSlots.length > 0 ? allocatedSlots : undefined,
    fallbackParkingCount: input.parkingSlotsCount,
    fallbackParkingType: input.parkingTypeUsed,
    discount: {
      type: input.discount.type,
      value: input.discount.value,
    },
  });

  const qtRef = db.collection('quotations').doc();
  const quotationNumber = `BM-${project.code}-${now.getFullYear()}-${qtRef.id.slice(0, 5).toUpperCase()}`;
  const validUntil = new Date(now.getTime() + input.validDays * 24 * 60 * 60 * 1000).toISOString();

  const status: Quotation['status'] = breakdown.requiresDiscountApproval
    ? 'PENDING_APPROVAL'
    : 'ISSUED';

  const pdfPath = `organizations/${input.orgId}/quotations/${qtRef.id}/v1/quotation_${quotationNumber}.pdf`;

  const quotation: Quotation = {
    id: qtRef.id,
    orgId: input.orgId,
    projectId: input.projectId,
    towerId: unit.towerId ?? null,
    floorId: unit.floorId ?? null,
    unitId: unit.id,
    unitNumber: unit.unitNumber,
    quotationNumber,
    currentVersion: 1,
    status,
    leadId: input.leadId ?? null,
    partnerOrgId: input.partnerOrgId ?? null,
    customer: {
      name: input.customer.name.trim(),
      phone: input.customer.phone.trim(),
      email: input.customer.email?.trim() || undefined,
      address: input.customer.address?.trim() || undefined,
    },
    priceBookId: priceBook.id,
    priceBookVersion: priceBook.versionNumber,
    paymentPlanId: paymentPlan.id,
    selectedParkingSlotIds: input.selectedParkingSlotIds,
    parkingSlotsCount:
      allocatedSlots.length > 0 ? allocatedSlots.length : input.parkingSlotsCount,
    parkingTypeUsed: input.parkingTypeUsed,
    discount: input.discount,
    breakdown,
    totalPayableInr: breakdown.totalPayableInr,
    validUntil,
    termsAndConditions: input.termsAndConditions,
    latestPdfStoragePath: pdfPath,
    salesRepUid: actor.uid,
    salesRepName: actorName,
    approvedByUid: breakdown.requiresDiscountApproval ? null : actor.uid,
    approvedAt: breakdown.requiresDiscountApproval ? null : nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const version: QuotationVersion = {
    id: `${qtRef.id}_v1`,
    orgId: input.orgId,
    quotationId: qtRef.id,
    version: 1,
    priceBookSnapshot: structuredClone(priceBook), // Immutable frozen snapshot!
    paymentPlanSnapshot: structuredClone(paymentPlan),
    breakdown,
    pdfStoragePath: pdfPath,
    createdByUid: actor.uid,
    createdAt: nowIso,
  };

  const pdfBytes = await generateQuotationPdfBytes({
    organization: org,
    project,
    unit,
    quotation,
  });

  await qtRef.set(quotation);
  await db.collection('quotation_versions').doc(version.id).set(version);

  if (breakdown.requiresDiscountApproval) {
    await createApprovalRequestService(db, {
      orgId: input.orgId,
      entityType: 'QUOTATION_DISCOUNT',
      entityId: quotation.id,
      projectId: project.id,
      requestedByUid: actor.uid,
      requestedByName: actorName,
      requiredPermission: 'quotations:approve_discount',
      requestSummary: `Discount approval on ${quotationNumber} (Unit ${unit.unitNumber}): ${formatInr(breakdown.discountAmountInr)} (${breakdown.discountEffectivePct}%)`,
      payloadSnapshot: {
        quotationNumber,
        unitNumber: unit.unitNumber,
        discountAmountInr: breakdown.discountAmountInr,
        totalPayableInr: breakdown.totalPayableInr,
      },
    });
  }

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'QUOTATION_GENERATED',
    category: breakdown.discountAmountInr > 0 ? 'DISCOUNT' : 'PRICING',
    entityType: 'quotation',
    entityId: quotation.id,
    summary: `Generated quotation ${quotationNumber} for Unit ${unit.unitNumber} (${formatInr(quotation.totalPayableInr)}, status=${status}).`,
  });

  return { quotation, version, pdfBytes };
}

// --- Cloud Functions v2 Callables ---

export const createPaymentPlan = onCall(async (request) => {
  const parsed = paymentPlanSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'pricing:edit_draft',
    parsed.projectId
  );
  return createPaymentPlanService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const createQuotation = onCall(async (request) => {
  const parsed = createQuotationSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'quotations:create',
    parsed.projectId
  );

  if (parsed.discount.type !== 'NONE' && parsed.discount.value > 0) {
    await requireOrgPermission(
      request,
      parsed.orgId,
      'quotations:request_discount',
      parsed.projectId
    );
  }

  const res = await createQuotationService(
    adminDb,
    actor,
    member?.displayName ?? actor.email ?? 'Sales Representative',
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );

  // Persist authoritative PDF to Cloud Storage when bucket is available
  try {
    const bucket = adminStorage.bucket();
    if (res.quotation.latestPdfStoragePath) {
      await bucket.file(res.quotation.latestPdfStoragePath).save(Buffer.from(res.pdfBytes), {
        contentType: 'application/pdf',
      });
    }
  } catch {
    // Non-fatal in local environments without Storage emulator running
  }

  return {
    quotation: res.quotation,
    pdfBase64: Buffer.from(res.pdfBytes).toString('base64'),
  };
});

export const shareQuotationAuthorized = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    quotationId: z.string().min(1),
    channel: z.enum(['WHATSAPP', 'EMAIL']),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(request, input.orgId, 'quotations:share');

  const qtRef = adminDb.collection('quotations').doc(input.quotationId);
  const snap = await qtRef.get();
  if (!snap.exists || snap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'Quotation not found.');
  }
  const qt = snap.data() as Quotation;
  if (qt.status === 'PENDING_APPROVAL') {
    throw new HttpsError(
      'failed-precondition',
      'Quotation requires discount approval before external sharing.'
    );
  }

  await qtRef.update({
    status: 'SHARED',
    updatedAt: new Date().toISOString(),
  });

  await writeAuditEvent(adminDb, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: member?.role ?? 'PLATFORM_SUPER_ADMIN',
    action: `QUOTATION_SHARED_${input.channel}`,
    category: 'DOCUMENT',
    entityType: 'quotation',
    entityId: qt.id,
    summary: `Shared quotation ${qt.quotationNumber} with ${qt.customer.name} via ${input.channel}.`,
  });

  return { success: true };
});
