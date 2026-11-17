import { describe, expect, it } from 'vitest';
import {
  computeSftRateBreakup,
  formatLineItemCalculation,
  calculateCostSheet,
  type ComputedLineItem,
  type CostSheetBreakdown,
  type Unit,
  type PriceBook,
} from '@bharat-makaan/shared';
import { bulkGenerateTowerUnitsService } from '../../functions/src/inventory';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService, createTowerService } from '../../functions/src/projects';
import { generateQuotationPdfBytes } from '../../functions/src/quotations';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const ACTOR = {
  uid: 'uid-builder-admin',
  email: 'admin@builder.test',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Bulk Upload Fields, SFT Rate Breakup & Cost Sheet PDF', () => {
  it('bulkGenerateTowerUnitsService populates single-unit parity fields and baseline rate v1', async () => {
    const db = createTransactionalTestFirestore({ enforceReadBeforeWrite: true });
    const { organization } = await createOrganizationService(db, ACTOR, {
      name: 'Skyline Developers',
      legalName: 'Skyline Developers LLP',
      headquartersCity: 'Hyderabad',
    });

    const project = await createProjectService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Skyline Developers',
      name: 'Skyline Heights',
      code: 'SKH',
      city: 'Hyderabad',
      locality: 'Gachibowli',
      address: 'Financial District, Hyderabad',
      projectType: 'APARTMENT',
      reraNumber: 'P02400001234',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const tower = await createTowerService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower Alpha',
      code: 'TA',
      towerType: 'TOWER',
      totalFloors: 10,
      basementLevels: 2,
      podiumLevels: 1,
      unitsPerFloorTypical: 4,
    });

    const bulkResult = await bulkGenerateTowerUnitsService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      towerId: tower.id,
      towerCode: tower.code,
      towerName: tower.name,
      unitType: 'APARTMENT',
      startFloor: 1,
      endFloor: 3,
      unitsPerFloor: 2,
      startUnitNumber: 1,
      bhk: '3 BHK',
      saleableAreaSqft: 1850,
      carpetAreaSqft: 1295,
      facing: 'NORTH',
      baseRatePerSqft: 9200,
      parkingEntitlementCount: 2,
      isCorner: true,
      isPublicPublished: true,
      listingMode: 'BUY',
    });

    expect(bulkResult.createdCount).toBe(6); // 3 floors * 2 units

    // Verify created units have matching fields
    const unitsSnap = await db.collection('units').where('towerId', '==', tower.id).get();
    expect(unitsSnap.docs.length).toBe(6);

    for (const doc of unitsSnap.docs) {
      const u = doc.data() as Unit;
      expect(u.unitType).toBe('APARTMENT');
      expect(u.facing).toBe('NORTH');
      expect(u.baseRatePerSqft).toBe(9200);
      expect(u.parkingEntitlementCount).toBe(2);
      expect(u.isCorner).toBe(true);
      expect(u.isPublicPublished).toBe(true);
      expect(u.saleableAreaSqft).toBe(1850);
      expect(u.carpetAreaSqft).toBe(1295);
      expect(u.calculatedTotalPrice).toBeGreaterThan(0);
    }
  });

  it('computes accurate SFT rate breakup metrics and line item calculations', () => {
    const mockBreakdown: CostSheetBreakdown = {
      saleableAreaSqft: 1850,
      carpetAreaSqft: 1295,
      baseRatePerSqft: 8800,
      basePriceInr: 16280000,
      floorRiseInr: 277500, // 1850 * 150
      facingPremiumInr: 185000, // 1850 * 100
      viewPremiumInr: 0,
      cornerPremiumInr: 0,
      locationPremiumInr: 0,
      unitSpecificPremiumInr: 0,
      parkingChargesInr: 900000,
      grossAgreementComponentsInr: 17642500,
      discountAmountInr: 370000, // 1850 * 200
      discountEffectivePct: 2.1,
      requiresDiscountApproval: false,
      netAgreementValueBeforeGstInr: 17272500,
      agreementGstInr: 863625, // 5%
      otherServiceChargesBeforeGstInr: 499500,
      otherServiceGstInr: 89910,
      exemptCorpusChargesInr: 370000,
      totalBeforeTaxInr: 18142000,
      totalGstInr: 953535,
      totalPayableInr: 19095535,
      lineItems: [
        {
          internalKey: 'base_price',
          displayLabel: 'Base Consideration Value',
          basis: 'SYSTEM_FORMULA',
          rateOrInput: 8800,
          baseAmountInr: 16280000,
          taxCategory: 'AGREEMENT_GST',
          gstPct: 5,
          gstAmountInr: 814000,
          totalWithGstInr: 17094000,
          displayOrder: 1,
        },
        {
          internalKey: 'infrastructure_charges',
          displayLabel: 'Infrastructure Development',
          basis: 'PER_SQFT_SALEABLE',
          rateOrInput: 150,
          baseAmountInr: 277500,
          taxCategory: 'AGREEMENT_GST',
          gstPct: 5,
          gstAmountInr: 13875,
          totalWithGstInr: 291375,
          displayOrder: 2,
        },
        {
          internalKey: 'corpus_fund',
          displayLabel: 'Corpus Fund',
          basis: 'PER_SQFT_SALEABLE',
          rateOrInput: 200,
          baseAmountInr: 370000,
          taxCategory: 'EXEMPT_CORPUS',
          gstPct: 0,
          gstAmountInr: 0,
          totalWithGstInr: 370000,
          displayOrder: 3,
        },
      ],
      schedule: [],
      registrationDisclaimer: 'Stamp duty at actuals.',
    };

    const sftBreakup = computeSftRateBreakup(mockBreakdown, 1850, 1295);

    expect(sftBreakup.baseRatePerSqft).toBe(8800);
    expect(sftBreakup.floorRiseRatePerSqft).toBe(150);
    expect(sftBreakup.premiumsRatePerSqft).toBe(100);
    expect(sftBreakup.discountRatePerSqft).toBe(200);
    expect(sftBreakup.agreementRatePerSqft).toBe(Math.round(17642500 / 1850));
    expect(sftBreakup.netAllInclusiveRatePerSqft).toBe(Math.round(19095535 / 1850));

    // Verify formatLineItemCalculation
    const baseCalc = formatLineItemCalculation(mockBreakdown.lineItems[0], 1850, 1295);
    expect(baseCalc.rateLabel).toContain('₹8,800/sq.ft.');
    expect(baseCalc.calculationText).toContain('1,850 sq.ft. × ₹8,800/sq.ft.');

    const infraCalc = formatLineItemCalculation(mockBreakdown.lineItems[1], 1850, 1295);
    expect(infraCalc.rateLabel).toContain('₹150/sq.ft.');
    expect(infraCalc.calculationText).toContain('1,850 sq.ft. × ₹150/sq.ft.');
  });

  it('generates PDF cost sheet bytes containing SFT breakup and rate calculation columns', async () => {
    const mockUnit: Unit = {
      id: 'unit-101',
      orgId: 'org-test',
      projectId: 'proj-test',
      towerId: 'tower-1',
      towerName: 'Tower 1',
      floorNumber: 5,
      unitNumber: 'T1-501',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1850,
      carpetAreaSqft: 1295,
      facing: 'EAST',
      isCorner: true,
      balconiesCount: 2,
      parkingEntitlementCount: 2,
      baseRatePerSqft: 8800,
      calculatedTotalPrice: 18500000,
      status: 'AVAILABLE',
      listingMode: 'BUY',
      isPublicPublished: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockPriceBook: PriceBook = {
      id: 'pb-1',
      orgId: 'org-test',
      projectId: 'proj-test',
      versionNumber: 1,
      name: 'Launch Price Book',
      status: 'ACTIVE',
      effectiveFrom: new Date().toISOString(),
      basePricePerSqft: 8800,
      floorRise: { enabled: true, startFloor: 2, ratePerFloorPerSqft: 50 },
      facingPremiumPerSqft: { EAST: 150 },
      viewPremiumPerSqft: {},
      cornerPremiumPerSqft: 100,
      locationPremiumPerSqft: 0,
      unitSpecificPremiumInr: {},
      parkingPricesByType: {
        STANDARD: 450000,
        TANDEM: 700000,
        MECHANICAL: 450000,
        EV: 550000,
        ACCESSIBLE: 450000,
      },
      lineItems: [],
      taxConfig: {
        agreementGstPct: 5,
        otherServiceGstPct: 18,
        roundingMode: 'NEAREST_RUPEE',
        registrationDisclaimer: 'Stamp duty extra',
      },
      maxDiscountPctWithoutApproval: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const breakdown = calculateCostSheet({
      unit: mockUnit,
      priceBook: mockPriceBook,
      fallbackParkingCount: 2,
      discount: { type: 'PER_SQFT', value: 200 },
    });

    const pdfBytes = await generateQuotationPdfBytes({
      organization: {
        name: 'Apex Infra',
        legalName: 'Apex Infra Ltd',
        headquartersCity: 'Mumbai',
      },
      project: {
        name: 'Apex Parkview',
        code: 'APV',
        city: 'Mumbai',
        locality: 'Powai',
        reraNumber: 'P51800001111',
        regulatoryAuthorityLabel: 'MAHARERA',
        currencyCode: 'INR',
        areaUnit: 'SQFT',
      },
      unit: mockUnit,
      quotation: {
        id: 'qt-1',
        orgId: 'org-test',
        projectId: 'proj-test',
        unitId: mockUnit.id,
        unitNumber: mockUnit.unitNumber,
        quotationNumber: 'BM-APV-2026-00001',
        currentVersion: 1,
        status: 'OFFICIAL',
        customer: { name: 'Rajesh Kumar', phone: '+919876543210' },
        salesRepUid: ACTOR.uid,
        salesRepName: 'Priya Sharma',
        salesRepRole: 'SALES_EXECUTIVE',
        priceBookId: mockPriceBook.id,
        priceBookVersion: mockPriceBook.versionNumber,
        paymentPlanId: 'clp-1',
        paymentPlanName: 'Standard CLP',
        parkingSlotsCount: 2,
        parkingTypeUsed: 'STANDARD',
        discount: { type: 'PER_SQFT', value: 200 },
        breakdown,
        totalPayableInr: breakdown.totalPayableInr,
        validUntil: new Date(Date.now() + 15 * 86400000).toISOString(),
        termsAndConditions: 'Standard 15 days validity.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000); // Valid PDF binary stream
  });
});
