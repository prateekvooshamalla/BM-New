/**
 * @bharat-makaan/shared — Global Multi-Project Deterministic Pricing, 6-Level Inheritance & CLP Engine
 *
 * CRITICAL GUARANTEE:
 * - Zero AI involvement in financial calculations.
 * - Zero dynamic `eval` or user-entered formula strings.
 * - Deterministic 6-Level Scope Precedence:
 *     1. Organization -> 2. Project -> 3. Phase -> 4. Structure (Tower/Building) -> 5. Unit Type -> 6. Individual Unit
 * - Editable builder display labels map to stable `internalKey` rules.
 * - Supports global currencies (minor-unit precision 0 | 2 | 3), global area units,
 *   lump-sum Base Unit Price or Price-per-Area, promotional offers, and configurable regional taxes
 *   (GST, VAT, SDLT, Transfer Tax, etc.) without hardcoding country tax assumptions.
 * - Reconciles Construction-Linked & Date-Linked Payment Plans to 100% and exact payable total.
 */

import type {
  ComputedLineItem,
  ComputedMilestoneInstallment,
  CostSheetBreakdown,
  CostSheetLineItemRule,
  ParkingSlot,
  ParkingSlotType,
  PaymentPlan,
  PriceBook,
  PricingScopeLevel,
  PricingScopeOverride,
  TaxConfiguration,
  Unit,
} from './entities';
import { getCurrencyConfig, toMinorUnits } from './formatters';

export function getQuotationPriceBooks(books: PriceBook[]): PriceBook[] {
  const priority: Partial<Record<PriceBook['status'], number>> = {
    ACTIVE: 0, APPROVED: 1, DRAFT: 2,
  };
  return books
    .filter((book) => priority[book.status] !== undefined)
    .sort((a, b) => priority[a.status]! - priority[b.status]! || b.versionNumber - a.versionNumber || a.id.localeCompare(b.id));
}

export const PRICING_SCOPE_PRECEDENCE: readonly PricingScopeLevel[] = [
  'ORGANIZATION',
  'PROJECT',
  'PHASE',
  'STRUCTURE',
  'UNIT_TYPE',
  'UNIT',
] as const;

export interface PricingScopeResolutionContext {
  orgId: string;
  projectId: string;
  phaseId?: string | null;
  towerId?: string | null;
  unitType: string;
  bhk?: string;
  unitId: string;
  unitNumber?: string;
}

export interface ResolvedEffectivePriceBookResult {
  effectivePriceBook: PriceBook;
  appliedOverrideChain: Array<{
    scopeLevel: PricingScopeLevel;
    overrideId: string;
    targetId: string;
    versionNumber: number;
  }>;
}

function doesOverrideMatchScope(
  override: PricingScopeOverride,
  level: PricingScopeLevel,
  ctx: PricingScopeResolutionContext
): boolean {
  if (!override.isActive || override.scopeLevel !== level) return false;
  if (override.orgId !== ctx.orgId) return false;
  if (override.projectId && override.projectId !== ctx.projectId && level !== 'ORGANIZATION') {
    return false;
  }

  switch (level) {
    case 'ORGANIZATION':
      return override.targetId === ctx.orgId || override.targetId === '*';
    case 'PROJECT':
      return override.targetId === ctx.projectId;
    case 'PHASE':
      return Boolean(ctx.phaseId) && override.targetId === ctx.phaseId;
    case 'STRUCTURE':
      return Boolean(ctx.towerId) && override.targetId === ctx.towerId;
    case 'UNIT_TYPE':
      return (
        override.targetId === ctx.unitType ||
        (Boolean(ctx.bhk) && override.targetId === ctx.bhk)
      );
    case 'UNIT':
      return (
        override.targetId === ctx.unitId ||
        (Boolean(ctx.unitNumber) && override.targetId === ctx.unitNumber)
      );
  }
}

function mergeLineItems(
  baseItems: CostSheetLineItemRule[],
  overrideItems?: CostSheetLineItemRule[]
): CostSheetLineItemRule[] {
  if (!overrideItems || overrideItems.length === 0) return baseItems;
  const map = new Map<string, CostSheetLineItemRule>();
  for (const item of baseItems) {
    map.set(item.internalKey, { ...item });
  }
  for (const item of overrideItems) {
    const existing = map.get(item.internalKey);
    if (existing) {
      map.set(item.internalKey, { ...existing, ...item });
    } else {
      map.set(item.internalKey, { ...item });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Resolves an effective PriceBook across the 6-level inheritance hierarchy:
 * Organization -> Project -> Phase -> Structure (Tower/Building) -> Unit Type -> Individual Unit.
 * Higher specificity overrides lower specificity deterministically.
 */
export function resolveEffectivePriceBook(params: {
  basePriceBook: PriceBook;
  overrides?: PricingScopeOverride[];
  context: PricingScopeResolutionContext;
}): ResolvedEffectivePriceBookResult {
  const { basePriceBook, overrides = [], context } = params;
  if (overrides.length === 0) {
    return { effectivePriceBook: basePriceBook, appliedOverrideChain: [] };
  }

  const effective: PriceBook = {
    ...basePriceBook,
    floorRise: { ...basePriceBook.floorRise },
    facingPremiumPerSqft: { ...basePriceBook.facingPremiumPerSqft },
    viewPremiumPerSqft: { ...basePriceBook.viewPremiumPerSqft },
    unitSpecificPremiumInr: { ...basePriceBook.unitSpecificPremiumInr },
    parkingPricesByType: { ...basePriceBook.parkingPricesByType },
    lineItems: basePriceBook.lineItems.map((li) => ({ ...li })),
    taxConfig: { ...basePriceBook.taxConfig },
    offers: basePriceBook.offers ? [...basePriceBook.offers] : undefined,
  };

  const appliedOverrideChain: ResolvedEffectivePriceBookResult['appliedOverrideChain'] = [];

  for (const level of PRICING_SCOPE_PRECEDENCE) {
    const matchingAtLevel = overrides
      .filter((ov) => doesOverrideMatchScope(ov, level, context))
      .sort((a, b) => a.versionNumber - b.versionNumber);

    for (const ov of matchingAtLevel) {
      if (ov.currencyCode) effective.currencyCode = ov.currencyCode;
      if (ov.areaUnit) effective.areaUnit = ov.areaUnit;
      if (ov.pricingMode) effective.pricingMode = ov.pricingMode;
      if (typeof ov.basePricePerArea === 'number') {
        effective.basePricePerSqft = ov.basePricePerArea;
      }
      if (typeof ov.baseUnitPrice === 'number') {
        effective.baseUnitPrice = ov.baseUnitPrice;
      }
      if (ov.baseConsiderationLabel) {
        effective.baseConsiderationLabel = ov.baseConsiderationLabel;
      }
      if (ov.floorRise) {
        effective.floorRise = { ...effective.floorRise, ...ov.floorRise };
      }
      if (ov.facingPremiumPerSqft) {
        effective.facingPremiumPerSqft = {
          ...effective.facingPremiumPerSqft,
          ...ov.facingPremiumPerSqft,
        };
      }
      if (ov.viewPremiumPerSqft) {
        effective.viewPremiumPerSqft = {
          ...effective.viewPremiumPerSqft,
          ...ov.viewPremiumPerSqft,
        };
      }
      if (typeof ov.cornerPremiumPerSqft === 'number') {
        effective.cornerPremiumPerSqft = ov.cornerPremiumPerSqft;
      }
      if (typeof ov.locationPremiumPerSqft === 'number') {
        effective.locationPremiumPerSqft = ov.locationPremiumPerSqft;
      }
      if (ov.parkingPricesByType) {
        effective.parkingPricesByType = {
          ...effective.parkingPricesByType,
          ...ov.parkingPricesByType,
        } as Record<ParkingSlotType, number>;
      }
      if (ov.lineItemsOverride) {
        effective.lineItems = mergeLineItems(effective.lineItems, ov.lineItemsOverride);
      }
      if (ov.taxConfigOverride) {
        effective.taxConfig = { ...effective.taxConfig, ...ov.taxConfigOverride };
      }
      if (typeof ov.maxDiscountPctWithoutApproval === 'number') {
        effective.maxDiscountPctWithoutApproval = ov.maxDiscountPctWithoutApproval;
      }
      if (ov.offers) {
        effective.offers = [...ov.offers];
      }

      appliedOverrideChain.push({
        scopeLevel: level,
        overrideId: ov.id,
        targetId: ov.targetId,
        versionNumber: ov.versionNumber,
      });
    }
  }

  return { effectivePriceBook: effective, appliedOverrideChain };
}

export interface CalculateCostSheetInput {
  unit: Pick<
    Unit,
    | 'id'
    | 'unitNumber'
    | 'unitType'
    | 'bhk'
    | 'floorNumber'
    | 'saleableAreaSqft'
    | 'carpetAreaSqft'
    | 'facing'
    | 'viewType'
    | 'isCorner'
    | 'parkingEntitlementCount'
  > &
    Partial<
      Pick<
        Unit,
        | 'orgId'
        | 'projectId'
        | 'phaseId'
        | 'towerId'
        | 'currencyCode'
        | 'areaUnit'
        | 'primaryArea'
        | 'secondaryArea'
        | 'pricingMode'
        | 'baseUnitPrice'
        | 'baseRatePerSqft'
      >
    >;
  priceBook: PriceBook;
  overrides?: PricingScopeOverride[];
  offerCodes?: string[];
  paymentPlan?: PaymentPlan | null;
  allocatedParkingSlots?: Pick<ParkingSlot, 'id' | 'parkingType' | 'priceInr'>[];
  fallbackParkingCount?: number;
  fallbackParkingType?: ParkingSlotType;
  discount?: {
    type: 'NONE' | 'FIXED_INR' | 'PER_SQFT' | 'PERCENTAGE_OF_BASE';
    value: number;
  };
}

function applyRounding(
  value: number,
  mode: TaxConfiguration['roundingMode'],
  currencyCode?: string
): number {
  if (mode === 'NEAREST_RUPEE' || mode === 'NEAREST_UNIT') {
    return Math.round(value);
  }
  const digits = getCurrencyConfig(currencyCode).minorUnitDigits;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function isRuleApplicableToUnit(
  rule: CostSheetLineItemRule,
  unit: CalculateCostSheetInput['unit']
): boolean {
  if (!rule.isVisible) return false;
  if (
    rule.applicableUnitTypes &&
    rule.applicableUnitTypes.length > 0 &&
    !rule.applicableUnitTypes.includes(unit.unitType)
  ) {
    return false;
  }
  if (
    rule.applicableBhk &&
    rule.applicableBhk.length > 0 &&
    !rule.applicableBhk.includes(unit.bhk)
  ) {
    return false;
  }
  return true;
}

export function calculateCostSheet(input: CalculateCostSheetInput): CostSheetBreakdown {
  const { unit, paymentPlan } = input;
  const resolved = resolveEffectivePriceBook({
    basePriceBook: input.priceBook,
    overrides: input.overrides,
    context: {
      orgId: unit.orgId ?? input.priceBook.orgId,
      projectId: unit.projectId ?? input.priceBook.projectId,
      phaseId: unit.phaseId ?? null,
      towerId: unit.towerId ?? null,
      unitType: unit.unitType,
      bhk: unit.bhk,
      unitId: unit.id,
      unitNumber: unit.unitNumber,
    },
  });

  const priceBook = {
    ...resolved.effectivePriceBook,
    basePricePerSqft: unit.baseRatePerSqft ?? resolved.effectivePriceBook.basePricePerSqft,
  };
  const currencyCode = unit.currencyCode ?? priceBook.currencyCode ?? 'INR';
  const areaUnit = unit.areaUnit ?? priceBook.areaUnit ?? 'SQFT';
  const pricingMode = unit.pricingMode ?? priceBook.pricingMode ?? 'PER_AREA';
  const roundingMode = priceBook.taxConfig.roundingMode;
  const agreementGstPct = priceBook.taxConfig.agreementGstPct;
  const otherServiceGstPct = priceBook.taxConfig.otherServiceGstPct;
  const primaryTaxLabel = priceBook.taxConfig.primaryTaxLabel ?? 'GST';
  const secondaryTaxLabel = priceBook.taxConfig.secondaryTaxLabel ?? 'Service Tax';

  const saleableArea = unit.primaryArea ?? unit.saleableAreaSqft;
  const carpetArea = unit.secondaryArea ?? unit.carpetAreaSqft;

  // Evaluate active promotional offers if requested or auto-active
  const requestedOffers = input.offerCodes ? new Set(input.offerCodes) : null;
  const activeOffers = (priceBook.offers ?? []).filter((o) => {
    if (!o.isActive) return false;
    if (requestedOffers) return requestedOffers.has(o.code);
    return false;
  });
  const waiveFloorRise = activeOffers.some((o) => o.offerType === 'FLOOR_RISE_WAIVER');
  const waiveParking = activeOffers.some((o) => o.offerType === 'PARKING_WAIVER');

  // 1. Core unit consideration components (supports Lump-Sum Base Unit Price OR Price-per-Area)
  const rawBasePrice =
    pricingMode === 'BASE_UNIT_PRICE'
      ? (unit.baseUnitPrice ?? priceBook.baseUnitPrice ?? saleableArea * priceBook.basePricePerSqft)
      : saleableArea * priceBook.basePricePerSqft;
  const basePriceInr = applyRounding(rawBasePrice, roundingMode, currencyCode);

  let floorRiseFloors = 0;
  if (
    !waiveFloorRise &&
    priceBook.floorRise.enabled &&
    unit.floorNumber >= priceBook.floorRise.startFloor
  ) {
    floorRiseFloors = unit.floorNumber - priceBook.floorRise.startFloor + 1;
  }
  const floorRiseRatePerSqft = floorRiseFloors * priceBook.floorRise.ratePerFloorPerSqft;
  const floorRiseInr = applyRounding(saleableArea * floorRiseRatePerSqft, roundingMode, currencyCode);

  const facingRate = priceBook.facingPremiumPerSqft[unit.facing] ?? 0;
  const facingPremiumInr = applyRounding(saleableArea * facingRate, roundingMode, currencyCode);

  const viewRate = unit.viewType ? (priceBook.viewPremiumPerSqft[unit.viewType] ?? 0) : 0;
  const viewPremiumInr = applyRounding(saleableArea * viewRate, roundingMode, currencyCode);

  const cornerRate = unit.isCorner ? priceBook.cornerPremiumPerSqft : 0;
  const cornerPremiumInr = applyRounding(saleableArea * cornerRate, roundingMode, currencyCode);

  const locationPremiumInr = applyRounding(
    saleableArea * priceBook.locationPremiumPerSqft,
    roundingMode,
    currencyCode
  );

  const unitSpecificPremiumInr = applyRounding(
    priceBook.unitSpecificPremiumInr[unit.id] ??
      priceBook.unitSpecificPremiumInr[unit.unitNumber] ??
      0,
    roundingMode,
    currencyCode
  );

  // 2. Parking charges (allocated physical slots take precedence; otherwise entitlement * fallback type)
  let parkingChargesInr = 0;
  if (!waiveParking) {
    if (input.allocatedParkingSlots && input.allocatedParkingSlots.length > 0) {
      parkingChargesInr = applyRounding(
        input.allocatedParkingSlots.reduce((acc, s) => acc + s.priceInr, 0),
        roundingMode,
        currencyCode
      );
    } else {
      const count = input.fallbackParkingCount ?? unit.parkingEntitlementCount;
      const pType = input.fallbackParkingType ?? 'STANDARD';
      const unitSlotPrice = priceBook.parkingPricesByType[pType] ?? 0;
      parkingChargesInr = applyRounding(count * unitSlotPrice, roundingMode, currencyCode);
    }
  }

  const computedLineItems: ComputedLineItem[] = [];

  const pushSystemLine = (
    internalKey: string,
    displayLabel: string,
    rateOrInput: number,
    amount: number,
    order: number
  ) => {
    if (amount <= 0 && internalKey !== 'base_price') return;
    const gstAmount = applyRounding((amount * agreementGstPct) / 100, roundingMode, currencyCode);
    computedLineItems.push({
      internalKey,
      displayLabel,
      basis: 'SYSTEM_FORMULA',
      rateOrInput,
      baseAmountInr: amount,
      taxCategory: 'AGREEMENT_GST',
      gstPct: agreementGstPct,
      gstAmountInr: gstAmount,
      totalWithGstInr: applyRounding(amount + gstAmount, roundingMode, currencyCode),
      displayOrder: order,
    });
  };

  pushSystemLine(
    'base_price',
    priceBook.baseConsiderationLabel || 'Base Consideration Value',
    pricingMode === 'BASE_UNIT_PRICE' ? basePriceInr : priceBook.basePricePerSqft,
    basePriceInr,
    1
  );
  pushSystemLine(
    'floor_rise',
    priceBook.floorRiseLabel || 'Floor Rise Charges',
    floorRiseRatePerSqft,
    floorRiseInr,
    2
  );
  pushSystemLine(
    'facing_premium',
    `Preferred Facing Premium (${unit.facing})`,
    facingRate,
    facingPremiumInr,
    3
  );
  pushSystemLine('view_premium', 'Preferred View Premium', viewRate, viewPremiumInr, 4);
  pushSystemLine('corner_premium', 'Corner Unit Premium', cornerRate, cornerPremiumInr, 5);
  pushSystemLine(
    'location_premium',
    'Location / PLC Charges',
    priceBook.locationPremiumPerSqft,
    locationPremiumInr,
    6
  );
  pushSystemLine(
    'unit_specific_premium',
    'Unit-Specific Premium',
    unitSpecificPremiumInr,
    unitSpecificPremiumInr,
    7
  );
  pushSystemLine(
    'parking_charges',
    priceBook.parkingLabel || 'Car Parking Charges',
    parkingChargesInr,
    parkingChargesInr,
    8
  );

  // 3. Configurable & custom cost-sheet line items (with editable displayLabel & stable internalKey)
  let customAgreementChargesInr = 0;
  let otherServiceChargesBeforeGstInr = 0;
  let exemptCorpusChargesInr = 0;

  const sortedRules = [...priceBook.lineItems].sort((a, b) => a.displayOrder - b.displayOrder);

  for (const rule of sortedRules) {
    if (!isRuleApplicableToUnit(rule, unit)) continue;

    const overrideAmount =
      rule.unitSpecificOverrides?.[unit.id] ?? rule.unitSpecificOverrides?.[unit.unitNumber];

    let rawAmount = 0;
    if (typeof overrideAmount === 'number') {
      rawAmount = overrideAmount;
    } else {
      switch (rule.basis) {
        case 'PER_SQFT_SALEABLE':
        case 'PER_PRIMARY_AREA':
          rawAmount = saleableArea * rule.amount;
          break;
        case 'PER_SQFT_CARPET':
        case 'PER_SECONDARY_AREA':
          rawAmount = carpetArea * rule.amount;
          break;
        case 'FIXED_AMOUNT':
          rawAmount = rule.amount;
          break;
        case 'PERCENTAGE_OF_BASE':
          rawAmount = (basePriceInr * rule.amount) / 100;
          break;
      }
    }

    const baseAmount = applyRounding(rawAmount, roundingMode, currencyCode);
    let gstPct = 0;
    if (rule.taxCategory === 'AGREEMENT_GST' || rule.taxCategory === 'PRIMARY_TAX') {
      gstPct = agreementGstPct;
      customAgreementChargesInr = applyRounding(
        customAgreementChargesInr + baseAmount,
        roundingMode,
        currencyCode
      );
    } else if (rule.taxCategory === 'OTHER_SERVICE_GST' || rule.taxCategory === 'SECONDARY_TAX') {
      gstPct = otherServiceGstPct;
      otherServiceChargesBeforeGstInr = applyRounding(
        otherServiceChargesBeforeGstInr + baseAmount,
        roundingMode,
        currencyCode
      );
    } else {
      gstPct = 0;
      exemptCorpusChargesInr = applyRounding(
        exemptCorpusChargesInr + baseAmount,
        roundingMode,
        currencyCode
      );
    }

    const lineGst = applyRounding((baseAmount * gstPct) / 100, roundingMode, currencyCode);
    computedLineItems.push({
      internalKey: rule.internalKey,
      displayLabel: rule.displayLabel,
      basis: rule.basis,
      rateOrInput: rule.amount,
      baseAmountInr: baseAmount,
      taxCategory: rule.taxCategory,
      gstPct,
      gstAmountInr: lineGst,
      totalWithGstInr: applyRounding(baseAmount + lineGst, roundingMode, currencyCode),
      displayOrder: 10 + rule.displayOrder,
    });
  }

  // 4. Gross Agreement Consideration, Promotional Offers & Discount
  const grossAgreementComponentsInr = applyRounding(
    basePriceInr +
      floorRiseInr +
      facingPremiumInr +
      viewPremiumInr +
      cornerPremiumInr +
      locationPremiumInr +
      unitSpecificPremiumInr +
      parkingChargesInr +
      customAgreementChargesInr,
    roundingMode,
    currencyCode
  );

  let offerDiscountInr = 0;
  for (const offer of activeOffers) {
    if (offer.offerType === 'FIXED_REBATE' && offer.value > 0) {
      offerDiscountInr = applyRounding(offerDiscountInr + offer.value, roundingMode, currencyCode);
    } else if (offer.offerType === 'PERCENTAGE_REBATE' && offer.value > 0) {
      offerDiscountInr = applyRounding(
        offerDiscountInr + (basePriceInr * offer.value) / 100,
        roundingMode,
        currencyCode
      );
    }
  }

  let manualDiscountInr = 0;
  const discountSpec = input.discount ?? { type: 'NONE', value: 0 };
  if (discountSpec.type === 'FIXED_INR' && discountSpec.value > 0) {
    manualDiscountInr = applyRounding(discountSpec.value, roundingMode, currencyCode);
  } else if (discountSpec.type === 'PER_SQFT' && discountSpec.value > 0) {
    manualDiscountInr = applyRounding(saleableArea * discountSpec.value, roundingMode, currencyCode);
  } else if (discountSpec.type === 'PERCENTAGE_OF_BASE' && discountSpec.value > 0) {
    manualDiscountInr = applyRounding(
      (basePriceInr * discountSpec.value) / 100,
      roundingMode,
      currencyCode
    );
  }

  const discountAmountInr = applyRounding(
    offerDiscountInr + manualDiscountInr,
    roundingMode,
    currencyCode
  );

  if (discountAmountInr > grossAgreementComponentsInr) {
    throw new Error('Discount cannot exceed gross agreement consideration value.');
  }

  const netAgreementValueBeforeGstInr = applyRounding(
    grossAgreementComponentsInr - discountAmountInr,
    roundingMode,
    currencyCode
  );

  const manualDiscountEffectivePct =
    grossAgreementComponentsInr > 0
      ? Number(((manualDiscountInr / grossAgreementComponentsInr) * 100).toFixed(4))
      : 0;

  const discountEffectivePct =
    grossAgreementComponentsInr > 0
      ? Number(((discountAmountInr / grossAgreementComponentsInr) * 100).toFixed(4))
      : 0;

  const requiresDiscountApproval =
    manualDiscountInr > 0 && manualDiscountEffectivePct > priceBook.maxDiscountPctWithoutApproval;

  // 5. Regional Tax & Final Totals
  const agreementGstInr = applyRounding(
    (netAgreementValueBeforeGstInr * agreementGstPct) / 100,
    roundingMode,
    currencyCode
  );
  const otherServiceGstInr = applyRounding(
    (otherServiceChargesBeforeGstInr * otherServiceGstPct) / 100,
    roundingMode,
    currencyCode
  );

  const totalBeforeTaxInr = applyRounding(
    netAgreementValueBeforeGstInr + otherServiceChargesBeforeGstInr + exemptCorpusChargesInr,
    roundingMode,
    currencyCode
  );
  const totalGstInr = applyRounding(agreementGstInr + otherServiceGstInr, roundingMode, currencyCode);
  const totalPayableInr = applyRounding(totalBeforeTaxInr + totalGstInr, roundingMode, currencyCode);

  // 6. Payment Schedule Reconciliation
  const schedule = computePaymentSchedule({
    paymentPlan: paymentPlan ?? null,
    netAgreementValueBeforeGstInr,
    agreementGstInr,
    otherServiceChargesBeforeGstInr,
    otherServiceGstInr,
    exemptCorpusChargesInr,
    totalPayableInr,
    roundingMode,
    currencyCode,
  });

  return {
    currencyCode,
    areaUnit,
    pricingMode,
    primaryTaxLabel,
    secondaryTaxLabel,
    saleableAreaSqft: saleableArea,
    carpetAreaSqft: carpetArea,
    baseRatePerSqft: priceBook.basePricePerSqft,
    basePriceInr,
    floorRiseInr,
    facingPremiumInr,
    viewPremiumInr,
    cornerPremiumInr,
    locationPremiumInr,
    unitSpecificPremiumInr,
    parkingChargesInr,
    grossAgreementComponentsInr,
    offerDiscountInr,
    appliedOfferCodes: activeOffers.map((o) => o.code),
    discountAmountInr,
    discountEffectivePct,
    requiresDiscountApproval,
    netAgreementValueBeforeGstInr,
    agreementGstInr,
    otherServiceChargesBeforeGstInr,
    otherServiceGstInr,
    exemptCorpusChargesInr,
    totalBeforeTaxInr,
    totalGstInr,
    totalPayableInr,
    totalPayableMinor: toMinorUnits(totalPayableInr, currencyCode),
    appliedOverrideChain: resolved.appliedOverrideChain,
    lineItems: computedLineItems.sort((a, b) => a.displayOrder - b.displayOrder),
    schedule,
    registrationDisclaimer: priceBook.taxConfig.registrationDisclaimer,
  };
}

export function validatePaymentPlanPercentages(milestones: Array<{ percentage: number }>): {
  valid: boolean;
  totalPercentage: number;
} {
  if (milestones.length === 0) {
    return { valid: false, totalPercentage: 0 };
  }
  const sum = Math.round(milestones.reduce((acc, m) => acc + m.percentage, 0) * 10000) / 10000;
  return {
    valid: Math.abs(sum - 100) < 0.001,
    totalPercentage: sum,
  };
}

function computePaymentSchedule(params: {
  paymentPlan: PaymentPlan | null;
  netAgreementValueBeforeGstInr: number;
  agreementGstInr: number;
  otherServiceChargesBeforeGstInr: number;
  otherServiceGstInr: number;
  exemptCorpusChargesInr: number;
  totalPayableInr: number;
  roundingMode: TaxConfiguration['roundingMode'];
  currencyCode: string;
}): ComputedMilestoneInstallment[] {
  const {
    paymentPlan,
    netAgreementValueBeforeGstInr,
    agreementGstInr,
    otherServiceChargesBeforeGstInr,
    otherServiceGstInr,
    exemptCorpusChargesInr,
    totalPayableInr,
    roundingMode,
    currencyCode,
  } = params;

  const possessionAddonsTotal = applyRounding(
    otherServiceChargesBeforeGstInr + otherServiceGstInr + exemptCorpusChargesInr,
    roundingMode,
    currencyCode
  );

  if (!paymentPlan || paymentPlan.milestones.length === 0) {
    return [
      {
        sequence: 1,
        name: 'Full Consideration & Possession Charges',
        dueTrigger: 'As per Agreement',
        percentage: 100,
        installmentBaseInr: netAgreementValueBeforeGstInr,
        installmentGstInr: agreementGstInr,
        possessionChargesWithGstInr: possessionAddonsTotal,
        totalInstallmentPayableInr: totalPayableInr,
      },
    ];
  }

  const check = validatePaymentPlanPercentages(paymentPlan.milestones);
  if (!check.valid) {
    throw new Error(
      `Payment plan milestones must reconcile to 100%. Found ${check.totalPercentage}%.`
    );
  }

  const ordered = [...paymentPlan.milestones].sort((a, b) => a.sequence - b.sequence);
  const possessionTargetIdx = ordered.findIndex(
    (m) => m.taxTreatment === 'INCLUDE_POSSESSION_CHARGES'
  );
  const effectivePossessionIdx =
    possessionTargetIdx >= 0 ? possessionTargetIdx : ordered.length - 1;

  let runningBase = 0;
  let runningGst = 0;

  return ordered.map((m, idx) => {
    const isLast = idx === ordered.length - 1;
    const basePart = isLast
      ? applyRounding(netAgreementValueBeforeGstInr - runningBase, roundingMode, currencyCode)
      : applyRounding((netAgreementValueBeforeGstInr * m.percentage) / 100, roundingMode, currencyCode);

    const gstPart = isLast
      ? applyRounding(agreementGstInr - runningGst, roundingMode, currencyCode)
      : applyRounding((agreementGstInr * m.percentage) / 100, roundingMode, currencyCode);

    runningBase = applyRounding(runningBase + basePart, roundingMode, currencyCode);
    runningGst = applyRounding(runningGst + gstPart, roundingMode, currencyCode);

    const possessionPart = idx === effectivePossessionIdx ? possessionAddonsTotal : 0;
    const totalInstallment = applyRounding(
      basePart + gstPart + possessionPart,
      roundingMode,
      currencyCode
    );

    return {
      sequence: m.sequence,
      name: m.name,
      dueTrigger: m.dueTrigger,
      estimatedDate: m.estimatedDate,
      percentage: m.percentage,
      installmentBaseInr: basePart,
      installmentGstInr: gstPart,
      possessionChargesWithGstInr: possessionPart,
      totalInstallmentPayableInr: totalInstallment,
    };
  });
}

export interface SftRateBreakup {
  saleableAreaSqft: number;
  carpetAreaSqft: number;
  baseRatePerSqft: number;
  floorRiseRatePerSqft: number;
  premiumsRatePerSqft: number;
  agreementRatePerSqft: number;
  otherChargesRatePerSqft: number;
  gstRatePerSqft: number;
  allInclusiveRatePerSqft: number;
  discountRatePerSqft: number;
  netAllInclusiveRatePerSqft: number;
}

export function computeSftRateBreakup(
  breakdown: CostSheetBreakdown,
  saleableAreaSqft: number,
  carpetAreaSqft: number
): SftRateBreakup {
  const sft = saleableAreaSqft > 0 ? saleableAreaSqft : 1;
  const premiumsInr =
    (breakdown.facingPremiumInr || 0) +
    (breakdown.cornerPremiumInr || 0) +
    (breakdown.viewPremiumInr || 0) +
    (breakdown.locationPremiumInr || 0) +
    (breakdown.unitSpecificPremiumInr || 0);

  const otherChargesInr =
    (breakdown.otherServiceChargesBeforeGstInr || 0) +
    (breakdown.exemptCorpusChargesInr || 0);

  const totalBeforeDiscount = breakdown.totalPayableInr + (breakdown.discountAmountInr || 0);

  return {
    saleableAreaSqft,
    carpetAreaSqft,
    baseRatePerSqft: breakdown.baseRatePerSqft,
    floorRiseRatePerSqft: Math.round((breakdown.floorRiseInr || 0) / sft),
    premiumsRatePerSqft: Math.round(premiumsInr / sft),
    agreementRatePerSqft: Math.round((breakdown.grossAgreementComponentsInr || 0) / sft),
    otherChargesRatePerSqft: Math.round(otherChargesInr / sft),
    gstRatePerSqft: Math.round((breakdown.totalGstInr || 0) / sft),
    allInclusiveRatePerSqft: Math.round(totalBeforeDiscount / sft),
    discountRatePerSqft: Math.round((breakdown.discountAmountInr || 0) / sft),
    netAllInclusiveRatePerSqft: Math.round(breakdown.totalPayableInr / sft),
  };
}

export interface FormattedLineItemCalculation {
  rateLabel: string;
  calculationText: string;
  areaOrQuantity: string;
}

export function formatLineItemCalculation(
  item: ComputedLineItem,
  saleableAreaSqft: number,
  carpetAreaSqft: number,
  currencyCode = 'INR',
  currencySymbolOverride?: string
): FormattedLineItemCalculation {
  const sym = currencySymbolOverride ?? getCurrencyConfig(currencyCode).symbol;
  const fmt = (n: number) => `${sym}${Math.round(n).toLocaleString('en-IN')}`;
  const areaFmt = (n: number) => Math.round(n).toLocaleString('en-IN');

  switch (item.internalKey) {
    case 'base_price':
      return {
        rateLabel: `${fmt(item.rateOrInput)}/sq.ft.`,
        areaOrQuantity: `${areaFmt(saleableAreaSqft)} sq.ft.`,
        calculationText: `${areaFmt(saleableAreaSqft)} sq.ft. @ ${fmt(item.rateOrInput)}/sq.ft.`,
      };
    case 'floor_rise':
      return {
        rateLabel: `+${fmt(item.rateOrInput)}/sq.ft.`,
        areaOrQuantity: `${areaFmt(saleableAreaSqft)} sq.ft.`,
        calculationText: `${areaFmt(saleableAreaSqft)} sq.ft. @ +${fmt(item.rateOrInput)}/sq.ft.`,
      };
    case 'facing_premium':
    case 'view_premium':
    case 'corner_premium':
    case 'location_premium':
      return {
        rateLabel: `+${fmt(item.rateOrInput)}/sq.ft.`,
        areaOrQuantity: `${areaFmt(saleableAreaSqft)} sq.ft.`,
        calculationText: `${areaFmt(saleableAreaSqft)} sq.ft. @ +${fmt(item.rateOrInput)}/sq.ft.`,
      };
    case 'parking_charges':
      return {
        rateLabel: item.baseAmountInr > 0 ? fmt(item.baseAmountInr) : 'Included',
        areaOrQuantity: item.baseAmountInr > 0 ? 'Reserved Bay' : 'Entitled Bay',
        calculationText:
          item.baseAmountInr > 0 ? 'Dedicated reserved bay' : 'Included in entitlement',
      };
    default:
      if (item.basis === 'PER_SQFT_SALEABLE' || item.basis === 'PER_PRIMARY_AREA') {
        return {
          rateLabel: `${fmt(item.rateOrInput)}/sq.ft.`,
          areaOrQuantity: `${areaFmt(saleableAreaSqft)} sq.ft.`,
          calculationText: `${areaFmt(saleableAreaSqft)} sq.ft. @ ${fmt(item.rateOrInput)}/sq.ft.`,
        };
      }
      if (item.basis === 'PER_SQFT_CARPET' || item.basis === 'PER_SECONDARY_AREA') {
        return {
          rateLabel: `${fmt(item.rateOrInput)}/sq.ft. (carpet)`,
          areaOrQuantity: `${areaFmt(carpetAreaSqft)} sq.ft.`,
          calculationText: `${areaFmt(carpetAreaSqft)} sq.ft. @ ${fmt(item.rateOrInput)}/sq.ft.`,
        };
      }
      if (item.basis === 'PERCENTAGE_OF_BASE') {
        return {
          rateLabel: `${item.rateOrInput}% of Base`,
          areaOrQuantity: 'Base Consideration',
          calculationText: `${item.rateOrInput}% on Base Consideration`,
        };
      }
      if (item.basis === 'FIXED_AMOUNT') {
        return {
          rateLabel: fmt(item.baseAmountInr),
          areaOrQuantity: 'Fixed Charge',
          calculationText: 'Standard fixed charge',
        };
      }
      return {
        rateLabel: item.rateOrInput ? `${fmt(item.rateOrInput)}` : 'Fixed',
        areaOrQuantity: 'Fixed Charge',
        calculationText: 'Standard rate calculation',
      };
  }
}

