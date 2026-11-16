/**
 * @bharat-makaan/shared — Deterministic Real Estate Pricing & CLP Engine
 *
 * CRITICAL GUARANTEE:
 * - Zero AI involvement in financial calculations.
 * - Zero dynamic `eval` or user-entered formula strings.
 * - Editable builder display labels map to stable `internalKey` rules.
 * - Supports Indian GST categories (5% residential / 12% commercial agreement GST,
 *   18% service GST on maintenance/legal, 0% exempt corpus deposit) and CGST rounding.
 * - Reconciles Construction-Linked & Date-Linked Payment Plans to 100% and exact total INR.
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
  Unit,
} from './entities';

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
  >;
  priceBook: PriceBook;
  paymentPlan?: PaymentPlan | null;
  allocatedParkingSlots?: Pick<ParkingSlot, 'id' | 'parkingType' | 'priceInr'>[];
  fallbackParkingCount?: number;
  fallbackParkingType?: ParkingSlotType;
  discount?: {
    type: 'NONE' | 'FIXED_INR' | 'PER_SQFT' | 'PERCENTAGE_OF_BASE';
    value: number;
  };
}

function applyRounding(value: number, mode: 'NEAREST_RUPEE' | 'EXACT_PAISE'): number {
  if (mode === 'NEAREST_RUPEE') {
    return Math.round(value);
  }
  return Math.round(value * 100) / 100;
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
  const { unit, priceBook, paymentPlan } = input;
  const roundingMode = priceBook.taxConfig.roundingMode;
  const agreementGstPct = priceBook.taxConfig.agreementGstPct;
  const otherServiceGstPct = priceBook.taxConfig.otherServiceGstPct;

  const saleableArea = unit.saleableAreaSqft;
  const carpetArea = unit.carpetAreaSqft;

  // 1. Core unit consideration components
  const basePriceInr = applyRounding(saleableArea * priceBook.basePricePerSqft, roundingMode);

  let floorRiseFloors = 0;
  if (priceBook.floorRise.enabled && unit.floorNumber >= priceBook.floorRise.startFloor) {
    floorRiseFloors = unit.floorNumber - priceBook.floorRise.startFloor + 1;
  }
  const floorRiseRatePerSqft = floorRiseFloors * priceBook.floorRise.ratePerFloorPerSqft;
  const floorRiseInr = applyRounding(saleableArea * floorRiseRatePerSqft, roundingMode);

  const facingRate = priceBook.facingPremiumPerSqft[unit.facing] ?? 0;
  const facingPremiumInr = applyRounding(saleableArea * facingRate, roundingMode);

  const viewRate = unit.viewType ? (priceBook.viewPremiumPerSqft[unit.viewType] ?? 0) : 0;
  const viewPremiumInr = applyRounding(saleableArea * viewRate, roundingMode);

  const cornerRate = unit.isCorner ? priceBook.cornerPremiumPerSqft : 0;
  const cornerPremiumInr = applyRounding(saleableArea * cornerRate, roundingMode);

  const locationPremiumInr = applyRounding(
    saleableArea * priceBook.locationPremiumPerSqft,
    roundingMode
  );

  const unitSpecificPremiumInr = applyRounding(
    priceBook.unitSpecificPremiumInr[unit.id] ??
      priceBook.unitSpecificPremiumInr[unit.unitNumber] ??
      0,
    roundingMode
  );

  // 2. Parking charges (allocated physical slots take precedence; otherwise entitlement * fallback type)
  let parkingChargesInr = 0;
  if (input.allocatedParkingSlots && input.allocatedParkingSlots.length > 0) {
    parkingChargesInr = applyRounding(
      input.allocatedParkingSlots.reduce((acc, s) => acc + s.priceInr, 0),
      roundingMode
    );
  } else {
    const count = input.fallbackParkingCount ?? unit.parkingEntitlementCount;
    const pType = input.fallbackParkingType ?? 'STANDARD';
    const unitSlotPrice = priceBook.parkingPricesByType[pType] ?? 0;
    parkingChargesInr = applyRounding(count * unitSlotPrice, roundingMode);
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
    const gstAmount = applyRounding((amount * agreementGstPct) / 100, roundingMode);
    computedLineItems.push({
      internalKey,
      displayLabel,
      basis: 'SYSTEM_FORMULA',
      rateOrInput,
      baseAmountInr: amount,
      taxCategory: 'AGREEMENT_GST',
      gstPct: agreementGstPct,
      gstAmountInr: gstAmount,
      totalWithGstInr: applyRounding(amount + gstAmount, roundingMode),
      displayOrder: order,
    });
  };

  pushSystemLine('base_price', 'Base Consideration Value', priceBook.basePricePerSqft, basePriceInr, 1);
  pushSystemLine('floor_rise', 'Floor Rise Charges', floorRiseRatePerSqft, floorRiseInr, 2);
  pushSystemLine('facing_premium', `Preferred Facing Premium (${unit.facing})`, facingRate, facingPremiumInr, 3);
  pushSystemLine('view_premium', 'Preferred View Premium', viewRate, viewPremiumInr, 4);
  pushSystemLine('corner_premium', 'Corner Unit Premium', cornerRate, cornerPremiumInr, 5);
  pushSystemLine('location_premium', 'Location / PLC Charges', priceBook.locationPremiumPerSqft, locationPremiumInr, 6);
  pushSystemLine('unit_specific_premium', 'Unit-Specific Premium', unitSpecificPremiumInr, unitSpecificPremiumInr, 7);
  pushSystemLine('parking_charges', 'Car Parking Charges', parkingChargesInr, parkingChargesInr, 8);

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
          rawAmount = saleableArea * rule.amount;
          break;
        case 'PER_SQFT_CARPET':
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

    const baseAmount = applyRounding(rawAmount, roundingMode);
    let gstPct = 0;
    if (rule.taxCategory === 'AGREEMENT_GST') {
      gstPct = agreementGstPct;
      customAgreementChargesInr = applyRounding(
        customAgreementChargesInr + baseAmount,
        roundingMode
      );
    } else if (rule.taxCategory === 'OTHER_SERVICE_GST') {
      gstPct = otherServiceGstPct;
      otherServiceChargesBeforeGstInr = applyRounding(
        otherServiceChargesBeforeGstInr + baseAmount,
        roundingMode
      );
    } else {
      gstPct = 0;
      exemptCorpusChargesInr = applyRounding(exemptCorpusChargesInr + baseAmount, roundingMode);
    }

    const lineGst = applyRounding((baseAmount * gstPct) / 100, roundingMode);
    computedLineItems.push({
      internalKey: rule.internalKey,
      displayLabel: rule.displayLabel,
      basis: rule.basis,
      rateOrInput: rule.amount,
      baseAmountInr: baseAmount,
      taxCategory: rule.taxCategory,
      gstPct,
      gstAmountInr: lineGst,
      totalWithGstInr: applyRounding(baseAmount + lineGst, roundingMode),
      displayOrder: 10 + rule.displayOrder,
    });
  }

  // 4. Gross Agreement Consideration & Discount
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
    roundingMode
  );

  let discountAmountInr = 0;
  const discountSpec = input.discount ?? { type: 'NONE', value: 0 };
  if (discountSpec.type === 'FIXED_INR' && discountSpec.value > 0) {
    discountAmountInr = applyRounding(discountSpec.value, roundingMode);
  } else if (discountSpec.type === 'PER_SQFT' && discountSpec.value > 0) {
    discountAmountInr = applyRounding(saleableArea * discountSpec.value, roundingMode);
  } else if (discountSpec.type === 'PERCENTAGE_OF_BASE' && discountSpec.value > 0) {
    discountAmountInr = applyRounding((basePriceInr * discountSpec.value) / 100, roundingMode);
  }

  if (discountAmountInr > grossAgreementComponentsInr) {
    throw new Error('Discount cannot exceed gross agreement consideration value.');
  }

  const netAgreementValueBeforeGstInr = applyRounding(
    grossAgreementComponentsInr - discountAmountInr,
    roundingMode
  );

  const discountEffectivePct =
    grossAgreementComponentsInr > 0
      ? Number(((discountAmountInr / grossAgreementComponentsInr) * 100).toFixed(4))
      : 0;

  const requiresDiscountApproval =
    discountAmountInr > 0 && discountEffectivePct > priceBook.maxDiscountPctWithoutApproval;

  // 5. GST & Final Totals
  const agreementGstInr = applyRounding(
    (netAgreementValueBeforeGstInr * agreementGstPct) / 100,
    roundingMode
  );
  const otherServiceGstInr = applyRounding(
    (otherServiceChargesBeforeGstInr * otherServiceGstPct) / 100,
    roundingMode
  );

  const totalBeforeTaxInr = applyRounding(
    netAgreementValueBeforeGstInr + otherServiceChargesBeforeGstInr + exemptCorpusChargesInr,
    roundingMode
  );
  const totalGstInr = applyRounding(agreementGstInr + otherServiceGstInr, roundingMode);
  const totalPayableInr = applyRounding(totalBeforeTaxInr + totalGstInr, roundingMode);

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
  });

  return {
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
  roundingMode: 'NEAREST_RUPEE' | 'EXACT_PAISE';
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
  } = params;

  const possessionAddonsTotal = applyRounding(
    otherServiceChargesBeforeGstInr + otherServiceGstInr + exemptCorpusChargesInr,
    roundingMode
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
      ? applyRounding(netAgreementValueBeforeGstInr - runningBase, roundingMode)
      : applyRounding((netAgreementValueBeforeGstInr * m.percentage) / 100, roundingMode);

    const gstPart = isLast
      ? applyRounding(agreementGstInr - runningGst, roundingMode)
      : applyRounding((agreementGstInr * m.percentage) / 100, roundingMode);

    runningBase = applyRounding(runningBase + basePart, roundingMode);
    runningGst = applyRounding(runningGst + gstPart, roundingMode);

    const possessionPart = idx === effectivePossessionIdx ? possessionAddonsTotal : 0;
    const totalInstallment = applyRounding(basePart + gstPart + possessionPart, roundingMode);

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
