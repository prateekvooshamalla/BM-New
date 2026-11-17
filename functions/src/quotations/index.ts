import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import {
  calculateCostSheet,
  computeSftRateBreakup,
  formatArea,
  formatCurrency,
  formatLineItemCalculation,
  type CostSheetTemplate,
  type Organization,
  type ParkingSlot,
  type PaymentPlan,
  type PriceBook,
  type PricingScopeOverride,
  type Project,
  type Quotation,
  type QuotationVersion,
  type Unit,
} from '@bharat-makaan/shared';
import { createQuotationSchema, paymentPlanSchema } from '@bharat-makaan/validation';
import { adminDb, adminStorage } from '../shared/firebase-admin';
import {
  requireOrgPermission,
  requirePartnerProjectScope,
  type AuthenticatedActor,
} from '../shared/auth-guard';
import { createApprovalRequestService } from '../approvals';
import { writeAuditEvent } from '../audit';
import { parseCallableInput } from '../shared/validation';

function pdfCurrencyPrefix(currencyCode?: string): string {
  switch ((currencyCode ?? 'INR').toUpperCase()) {
    case 'INR':
      return 'Rs.';
    case 'USD':
      return 'USD';
    case 'AED':
      return 'AED';
    case 'GBP':
      return 'GBP';
    case 'EUR':
      return 'EUR';
    case 'SGD':
      return 'SGD';
    case 'AUD':
      return 'AUD';
    case 'CAD':
      return 'CAD';
    case 'JPY':
      return 'JPY';
    case 'KWD':
      return 'KWD';
    default:
      return (currencyCode ?? 'INR').toUpperCase();
  }
}

/**
 * Generates an authoritative, printable enterprise PDF document for a Quotation
 * honoring the organization/project's selected `CostSheetTemplate`, currency, area unit,
 * and regional tax labels.
 */
export async function generateQuotationPdfBytes(params: {
  organization: Pick<Organization, 'name' | 'legalName' | 'reraNumber' | 'headquartersCity'>;
  project: Pick<
    Project,
    'name' | 'code' | 'city' | 'locality' | 'reraNumber' | 'regulatoryAuthorityLabel' | 'currencyCode' | 'areaUnit'
  >;
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
    | 'areaUnit'
  >;
  quotation: Quotation;
  template?: CostSheetTemplate | null;
}): Promise<Uint8Array> {
  const { organization, project, unit, quotation, template } = params;
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const currencyCode =
    quotation.currencyCode ?? quotation.breakdown.currencyCode ?? project.currencyCode ?? 'INR';
  const areaUnit =
    quotation.areaUnit ?? quotation.breakdown.areaUnit ?? unit.areaUnit ?? project.areaUnit ?? 'SQFT';
  const taxHeaderLabel = (
    template?.customLabels.primaryTaxSummaryLabel ||
    quotation.breakdown.primaryTaxLabel ||
    'TAX'
  ).toUpperCase();
  const prefix = pdfCurrencyPrefix(currencyCode);
  const locale = currencyCode === 'INR' ? 'en-IN' : 'en-US';
  const fmtMoney = (n: number) => `${prefix} ${Math.round(n).toLocaleString(locale)}`;
  const regLabel = project.regulatoryAuthorityLabel || 'REG';

  const toggles = template?.sectionToggles ?? {
    showCustomerSection: true,
    showUnitSection: true,
    showAreaBreakdown: true,
    showParkingBreakdown: true,
    showTaxBreakdown: true,
    showOfferRebates: true,
    showPaymentSchedule: true,
    showTerms: true,
    showSalesRepSection: true,
    showSignatureBlocks: true,
  };

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
  const regSegment =
    template?.headerConfig.showRegulatoryNumber === false
      ? ''
      : ` | ${regLabel}: ${project.reraNumber}`;
  page.drawText(
    `${project.name} (${project.locality}, ${project.city})${regSegment}`,
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
  const docTitle = template?.headerConfig.title || 'COST SHEET & QUOTATION';
  page.drawText(`${docTitle}: ${quotation.quotationNumber} (v${quotation.currentVersion})`, {
    x: 36,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  y -= 15;
  page.drawText(
    `Issued: ${quotation.createdAt.slice(0, 10)}   |   Valid Until: ${quotation.validUntil.slice(0, 10)}   |   Status: ${quotation.status}   |   Currency: ${currencyCode}`,
    { x: 36, y, size: 8.5, font: fontRegular, color: rgb(0.3, 0.35, 0.4) }
  );
  y -= 18;

  if (toggles.showCustomerSection) {
    const custLabel = template?.customLabels.customerSectionTitle || 'Customer';
    page.drawText(
      `${custLabel}: ${quotation.customer.name} (${quotation.customer.phone})${quotation.customer.email ? ` | ${quotation.customer.email}` : ''}`,
      { x: 36, y, size: 9, font: fontBold }
    );
    y -= 14;
  }

  if (toggles.showUnitSection) {
    const floorSegment = unit.floorNumber > 0 ? ` | Level ${unit.floorNumber}` : '';
    const areaSegment = toggles.showAreaBreakdown
      ? ` | Primary Area: ${formatArea(unit.saleableAreaSqft, areaUnit)} | Usable: ${formatArea(unit.carpetAreaSqft, areaUnit)}`
      : '';
    page.drawText(
      `Inventory: ${unit.unitNumber} | ${unit.bhk} (${unit.unitType})${floorSegment}${areaSegment} | Facing: ${unit.facing}`,
      { x: 36, y, size: 8.5, font: fontRegular }
    );
    y -= 13;
    page.drawText(
      `Layout Ref: ${unit.floorPlanVersionId ?? 'Approved Layout'} | Parking: ${quotation.parkingSlotsCount} (${quotation.parkingTypeUsed}) | Price Book v${quotation.priceBookVersion}`,
      { x: 36, y, size: 8, font: fontRegular, color: rgb(0.35, 0.4, 0.45) }
    );
    y -= 20;
  }

  const sftBreakup = computeSftRateBreakup(
    quotation.breakdown,
    unit.saleableAreaSqft,
    unit.carpetAreaSqft
  );

  // Pricing Option & SFT Rate Summary Card
  ensureSpace(56);
  page.drawRectangle({
    x: 36,
    y: y - 44,
    width: 523,
    height: 48,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.82, 0.86, 0.93),
    borderWidth: 0.75,
  });

  page.drawText('PRICING OPTION & SFT RATE BREAKUP SUMMARY', {
    x: 44,
    y: y - 12,
    size: 8.5,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });

  page.drawText(
    `Option: Price Book v${quotation.priceBookVersion} | Sft Basis: ${formatArea(unit.saleableAreaSqft, areaUnit)} Primary (${formatArea(unit.carpetAreaSqft, areaUnit)} Usable)`,
    {
      x: 44,
      y: y - 23,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.35, 0.4, 0.45),
    }
  );

  const metricY = y - 36;
  page.drawText(`Base SFT: ${fmtMoney(sftBreakup.baseRatePerSqft)}/${areaUnit.toLowerCase()}`, {
    x: 44,
    y: metricY,
    size: 7.5,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  page.drawText(`Floor & Facing: +${fmtMoney(sftBreakup.floorRiseRatePerSqft + sftBreakup.premiumsRatePerSqft)}/${areaUnit.toLowerCase()}`, {
    x: 175,
    y: metricY,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.2, 0.25, 0.35),
  });

  page.drawText(`Agreement SFT: ${fmtMoney(sftBreakup.agreementRatePerSqft)}/${areaUnit.toLowerCase()}`, {
    x: 310,
    y: metricY,
    size: 7.5,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });

  page.drawText(`All-Inclusive SFT: ${fmtMoney(sftBreakup.netAllInclusiveRatePerSqft)}/${areaUnit.toLowerCase()}`, {
    x: 435,
    y: metricY,
    size: 7.5,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });

  y -= 54;

  // Cost Breakdown Table Header
  const tableTitle = template?.customLabels.pricingTableTitle || 'COST COMPONENT';
  page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 18, color: rgb(0.94, 0.95, 0.97) });
  page.drawText(tableTitle.toUpperCase().slice(0, 22), { x: 42, y: y + 1, size: 7.5, font: fontBold });
  page.drawText('RATE / BASIS', { x: 175, y: y + 1, size: 7.5, font: fontBold });
  page.drawText('CALCULATION BREAKUP', { x: 250, y: y + 1, size: 7.5, font: fontBold });
  page.drawText('BASE AMOUNT', { x: 385, y: y + 1, size: 7.5, font: fontBold });
  page.drawText(taxHeaderLabel.slice(0, 8), { x: 450, y: y + 1, size: 7.5, font: fontBold });
  page.drawText('TOTAL', { x: 505, y: y + 1, size: 7.5, font: fontBold });
  y -= 18;

  for (const li of quotation.breakdown.lineItems) {
    const { rateLabel, calculationText } = formatLineItemCalculation(
      li,
      unit.saleableAreaSqft,
      unit.carpetAreaSqft,
      currencyCode,
      prefix
    );

    ensureSpace(16);
    page.drawText(li.displayLabel.slice(0, 26), { x: 42, y, size: 7.5, font: fontRegular });
    page.drawText(rateLabel.slice(0, 16), { x: 175, y, size: 7.2, font: fontRegular, color: rgb(0.25, 0.3, 0.35) });
    page.drawText(calculationText.slice(0, 30), { x: 250, y, size: 7.2, font: fontRegular, color: rgb(0.25, 0.3, 0.35) });
    page.drawText(fmtMoney(li.baseAmountInr), { x: 385, y, size: 7.5, font: fontRegular });
    page.drawText(
      toggles.showTaxBreakdown ? `${fmtMoney(li.gstAmountInr)} (${li.gstPct}%)` : '-',
      {
        x: 450,
        y,
        size: 7.2,
        font: fontRegular,
      }
    );
    page.drawText(fmtMoney(li.totalWithGstInr), { x: 505, y, size: 7.5, font: fontBold });
    y -= 14;
  }

  if (quotation.breakdown.discountAmountInr > 0) {
    ensureSpace(16);
    page.drawText('Less: Approved Offer / Rebate', {
      x: 42,
      y,
      size: 7.8,
      font: fontBold,
      color: rgb(0.08, 0.5, 0.24),
    });
    page.drawText(`- ${fmtMoney(sftBreakup.discountRatePerSqft)}/${areaUnit.toLowerCase()}`, {
      x: 175,
      y,
      size: 7.5,
      font: fontBold,
      color: rgb(0.08, 0.5, 0.24),
    });
    page.drawText(
      `${Math.round(unit.saleableAreaSqft)} sq.ft. × -${fmtMoney(sftBreakup.discountRatePerSqft)}`,
      {
        x: 250,
        y,
        size: 7.2,
        font: fontBold,
        color: rgb(0.08, 0.5, 0.24),
      }
    );
    page.drawText(`- ${fmtMoney(quotation.breakdown.discountAmountInr)}`, {
      x: 385,
      y,
      size: 7.8,
      font: fontBold,
      color: rgb(0.08, 0.5, 0.24),
    });
    page.drawText('—', { x: 450, y, size: 7.5, font: fontRegular });
    page.drawText(`- ${fmtMoney(quotation.breakdown.discountAmountInr)}`, {
      x: 505,
      y,
      size: 7.8,
      font: fontBold,
      color: rgb(0.08, 0.5, 0.24),
    });
    y -= 16;
  }

  // Grand Total Box
  ensureSpace(36);
  const grandTotalTitle = (
    template?.customLabels.grandTotalLabel || 'TOTAL ALL-INCLUSIVE PAYABLE'
  ).toUpperCase();
  page.drawRectangle({ x: 36, y: y - 10, width: 523, height: 26, color: rgb(0.93, 0.96, 1) });
  page.drawText(grandTotalTitle.slice(0, 26), {
    x: 42,
    y: y - 1,
    size: 9,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  page.drawText(`Net SFT: ${fmtMoney(sftBreakup.netAllInclusiveRatePerSqft)}/${areaUnit.toLowerCase()}`, {
    x: 205,
    y: y - 1,
    size: 8,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  page.drawText(`${taxHeaderLabel.slice(0, 10)}: ${fmtMoney(quotation.breakdown.totalGstInr)}`, {
    x: 335,
    y: y - 1,
    size: 8,
    font: fontRegular,
  });
  page.drawText(fmtMoney(quotation.breakdown.totalPayableInr), {
    x: 455,
    y: y - 2,
    size: 10,
    font: fontBold,
    color: rgb(0.06, 0.15, 0.36),
  });
  y -= 28;

  // Payment Schedule Section
  if (toggles.showPaymentSchedule) {
    ensureSpace(50);
    const schedTitle = (
      template?.customLabels.scheduleSectionTitle || 'PAYMENT SCHEDULE (RECONCILED TO 100%)'
    ).toUpperCase();
    page.drawText(schedTitle, {
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
    page.drawText(`CONSIDERATION + ${taxHeaderLabel.slice(0, 8)}`, {
      x: 350,
      y,
      size: 7.5,
      font: fontBold,
    });
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
      page.drawText(fmtMoney(ms.installmentBaseInr + ms.installmentGstInr), {
        x: 350,
        y,
        size: 7.8,
        font: fontRegular,
      });
      page.drawText(fmtMoney(ms.totalInstallmentPayableInr), {
        x: 470,
        y,
        size: 7.8,
        font: fontBold,
      });
      y -= 13;
    }
  }

  // Disclaimer, Terms & Representative Footer
  ensureSpace(75);
  y -= 10;
  page.drawText(`Statutory Note: ${quotation.breakdown.registrationDisclaimer}`, {
    x: 36,
    y,
    size: 7.5,
    font: fontBold,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 13;
  if (toggles.showTerms) {
    page.drawText(`Terms: ${quotation.termsAndConditions.slice(0, 110)}`, {
      x: 36,
      y,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 14;
  }
  if (toggles.showSalesRepSection) {
    page.drawText(
      `Prepared By: ${quotation.salesRepName}   |   Approved By: ${quotation.approvedByUid ?? 'Auto-Authorized Policy'}`,
      { x: 36, y, size: 7.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) }
    );
    y -= 13;
  }
  if (template?.footerText) {
    page.drawText(template.footerText.slice(0, 115), {
      x: 36,
      y,
      size: 7.2,
      font: fontRegular,
      color: rgb(0.45, 0.45, 0.5),
    });
  }

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
  const input = parseCallableInput(createQuotationSchema, rawInput);
  const now = new Date();
  const nowIso = now.toISOString();

  const [orgSnap, projSnap, unitSnap, pbSnap, planSnap, overridesSnap] = await Promise.all([
    db.collection('organizations').doc(input.orgId).get(),
    db.collection('projects').doc(input.projectId).get(),
    db.collection('units').doc(input.unitId).get(),
    db.collection('price_books').doc(input.priceBookId).get(),
    db.collection('payment_plans').doc(input.paymentPlanId).get(),
    db.collection('pricing_overrides').where('orgId', '==', input.orgId).get(),
  ]);

  if (!orgSnap.exists || !projSnap.exists || !unitSnap.exists || !pbSnap.exists || !planSnap.exists) {
    throw new HttpsError(
      'not-found',
      'Organization, project, unit, price book, or payment plan not found.'
    );
  }

  const org = orgSnap.data() as Organization;
  if (input.leadId) {
    const lead = await db.collection('leads').doc(input.leadId).get();
    if (!lead.exists || lead.data()?.orgId !== input.orgId) {
      throw new HttpsError('permission-denied', 'Customer lead must belong to this organization.');
    }
  }
  const project = projSnap.data() as Project;
  const unit = unitSnap.data() as Unit;
  const priceBook = pbSnap.data() as PriceBook;
  const paymentPlan = planSnap.data() as PaymentPlan;

  // Strict multi-tenant & multi-project boundary verification
  if (
    project.orgId !== input.orgId ||
    unit.orgId !== input.orgId ||
    unit.projectId !== input.projectId ||
    priceBook.orgId !== input.orgId ||
    priceBook.projectId !== input.projectId ||
    paymentPlan.orgId !== input.orgId ||
    paymentPlan.projectId !== input.projectId
  ) {
    throw new HttpsError(
      'permission-denied',
      'Cross-organization or cross-project resource mismatch rejected.'
    );
  }

  if (priceBook.status !== 'APPROVED' && priceBook.status !== 'ACTIVE') {
    throw new HttpsError(
      'failed-precondition',
      `Quotations require an APPROVED or ACTIVE price book (selected: ${priceBook.status}).`
    );
  }

  // Resolve CostSheetTemplate if specified on quotation, project, or org default
  const targetTemplateId =
    input.costSheetTemplateId ?? project.defaultCostSheetTemplateId ?? null;
  let template: CostSheetTemplate | null = null;
  if (targetTemplateId) {
    const tplSnap = await db.collection('cost_sheet_templates').doc(targetTemplateId).get();
    if (tplSnap.exists && tplSnap.data()?.orgId === input.orgId) {
      template = tplSnap.data() as CostSheetTemplate;
    }
  } else {
    const orgTplSnap = await db
      .collection('cost_sheet_templates')
      .where('orgId', '==', input.orgId)
      .limit(20)
      .get();
    const candidates = orgTplSnap.docs.map((d) => d.data() as CostSheetTemplate);
    template =
      candidates.find((t) => t.projectId === input.projectId && t.isDefault) ??
      candidates.find((t) => !t.projectId && t.isDefault) ??
      null;
  }

  let allocatedSlots: ParkingSlot[] = [];
  if (input.selectedParkingSlotIds.length > 0) {
    const slotSnaps = await Promise.all(
      input.selectedParkingSlotIds.map((id) => db.collection('parking_slots').doc(id).get())
    );
    allocatedSlots = slotSnaps
      .filter((s) => s.exists && s.data()?.orgId === input.orgId)
      .map((s) => s.data() as ParkingSlot);
  }

  const overrides = overridesSnap.docs.map((d) => d.data() as PricingScopeOverride);

  const breakdown = calculateCostSheet({
    unit,
    priceBook,
    overrides,
    offerCodes: input.offerCodes,
    paymentPlan,
    allocatedParkingSlots: allocatedSlots.length > 0 ? allocatedSlots : undefined,
    fallbackParkingCount: input.parkingSlotsCount,
    fallbackParkingType: input.parkingTypeUsed,
    discount: {
      type: input.discount.type,
      value: input.discount.value,
    },
  });

  const currencyCode = breakdown.currencyCode ?? project.currencyCode ?? org.defaultCurrency ?? 'INR';
  const areaUnit = breakdown.areaUnit ?? unit.areaUnit ?? project.areaUnit ?? 'SQFT';
  const discount: Quotation['discount'] = {
    type: input.discount.type,
    value: input.discount.value,
    ...(input.discount.reason == null ? {} : { reason: input.discount.reason }),
  };

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
    currencyCode,
    areaUnit,
    costSheetTemplateId: template?.id ?? null,
    appliedOfferCodes: breakdown.appliedOfferCodes ?? [],
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
    discount,
    breakdown,
    totalPayableInr: breakdown.totalPayableInr,
    validUntil,
    termsAndConditions: input.termsAndConditions || template?.defaultTermsAndConditions || '',
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
    template,
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
      requestSummary: `Discount approval on ${quotationNumber} (Unit ${unit.unitNumber}): ${formatCurrency(breakdown.discountAmountInr, currencyCode)} (${breakdown.discountEffectivePct}%)`,
      payloadSnapshot: {
        quotationNumber,
        unitNumber: unit.unitNumber,
        currencyCode,
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
    summary: `Generated quotation ${quotationNumber} for Unit ${unit.unitNumber} (${formatCurrency(quotation.totalPayableInr, currencyCode)}, status=${status}).`,
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
  const parsed = parseCallableInput(createQuotationSchema, request.data);
  let actor: AuthenticatedActor;
  let actorName = 'Sales Representative';
  let actorRole = 'SALES_EXECUTIVE';

  if (parsed.partnerOrgId) {
    try {
      const partnerAuth = await requirePartnerProjectScope(
        request,
        parsed.partnerOrgId,
        parsed.orgId,
        parsed.projectId,
        'quotations:create'
      );
      if (parsed.discount.type !== 'NONE' && parsed.discount.value > 0) {
        await requirePartnerProjectScope(
          request,
          parsed.partnerOrgId,
          parsed.orgId,
          parsed.projectId,
          'quotations:request_discount'
        );
      }
      actor = partnerAuth.actor;
      actorName = `${partnerAuth.partnerMember.displayName} (${partnerAuth.partnerOrg.companyName})`;
      actorRole = partnerAuth.partnerMember.role;
    } catch {
      const orgAuth = await requireOrgPermission(
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
      actor = orgAuth.actor;
      actorName = orgAuth.member?.displayName ?? orgAuth.actor.email ?? 'Sales Representative';
      actorRole = orgAuth.member?.role ?? 'PLATFORM_SUPER_ADMIN';
    }
  } else {
    const orgAuth = await requireOrgPermission(
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
    actor = orgAuth.actor;
    actorName = orgAuth.member?.displayName ?? orgAuth.actor.email ?? 'Sales Representative';
    actorRole = orgAuth.member?.role ?? 'PLATFORM_SUPER_ADMIN';
  }

  const res = await createQuotationService(adminDb, actor, actorName, actorRole, parsed);

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
