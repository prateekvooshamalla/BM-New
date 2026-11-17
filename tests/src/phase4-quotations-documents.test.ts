import { describe, expect, it } from 'vitest';
import { formatInr } from '@bharat-makaan/shared';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService, createTowerService } from '../../functions/src/projects';
import { createUnitService } from '../../functions/src/inventory';
import { decideApprovalService } from '../../functions/src/approvals';
import {
  activatePriceBookService,
  clonePriceBookVersionService,
  savePriceBookDraftService,
  submitPriceBookForApprovalService,
} from '../../functions/src/pricing';
import {
  createPaymentPlanService,
  createQuotationService,
} from '../../functions/src/quotations';
import {
  createExpiringShareLinkService,
  mapFloorPlanToUnitsService,
  registerDocumentService,
  replaceDocumentVersionService,
} from '../../functions/src/documents';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const ACTOR = {
  uid: 'uid-sales-dir',
  email: 'sales.director@bharatmakaan.test',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Phase 4 — Quotations, C-704 Regression (₹3,92,73,985), CLP Schedule, PDF & Floor Plans', () => {
  it('computes C-704 reference total of ₹3,92,73,985, reconciles CLP schedule, generates PDF, and preserves frozen snapshot across future price hikes', async () => {
    const db = createTransactionalTestFirestore({ enforceReadBeforeWrite: true });
    const { organization } = await createOrganizationService(db, ACTOR, {
      name: 'Signature Spaces',
      legalName: 'Signature Spaces India Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Signature Spaces',
      name: 'Signature Crown',
      code: 'SGC',
      city: 'Bengaluru',
      locality: 'Indiranagar',
      address: '100 Feet Road, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/1251/446/PR/C704',
      configurations: ['4 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const towerC = await createTowerService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower C',
      code: 'C',
      towerType: 'TOWER',
      totalFloors: 14,
      basementLevels: 2,
      podiumLevels: 1,
      unitsPerFloorTypical: 4,
    });

    const unitC704 = await createUnitService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      towerId: towerC.id,
      towerName: towerC.name,
      floorNumber: 7,
      unitNumber: 'C-704',
      unitType: 'APARTMENT',
      bhk: '4 BHK',
      saleableAreaSqft: 2965,
      carpetAreaSqft: 2075,
      facing: 'EAST',
      isCorner: false,
      balconiesCount: 3,
      parkingEntitlementCount: 2,
      baseRatePerSqft: 11100,
    });

    // Draft, submit, approve, and activate C-704 reference price book
    const pbDraft = await savePriceBookDraftService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Reference Tower-C Price Book',
      effectiveFrom: '2026-11-16T00:00:00.000Z',
      basePricePerSqft: 11100,
      floorRise: {
        enabled: true,
        startFloor: 2, // Floors 2..7 = 6 floors * ₹50 = ₹300/sq.ft.
        ratePerFloorPerSqft: 50,
      },
      facingPremiumPerSqft: { EAST: 150 },
      viewPremiumPerSqft: {},
      cornerPremiumPerSqft: 0,
      locationPremiumPerSqft: 0,
      unitSpecificPremiumInr: {},
      parkingPricesByType: {
        STANDARD: 450000, // 2 slots = ₹9,00,000
        TANDEM: 750000,
        MECHANICAL: 350000,
        EV: 550000,
        ACCESSIBLE: 450000,
      },
      lineItems: [
        {
          id: 'li-1',
          internalKey: 'amenities_charges',
          displayLabel: 'Clubhouse & Amenities Charges',
          basis: 'FIXED_AMOUNT',
          amount: 690000,
          taxCategory: 'AGREEMENT_GST',
          isOptional: false,
          isVisible: true,
          isRemovable: true,
          displayOrder: 1,
        },
        {
          id: 'li-2',
          internalKey: 'infrastructure_charges',
          displayLabel: 'Infrastructure Development Charges',
          basis: 'PER_SQFT_SALEABLE',
          amount: 150,
          taxCategory: 'AGREEMENT_GST',
          isOptional: false,
          isVisible: true,
          isRemovable: true,
          displayOrder: 2,
        },
        {
          id: 'li-3',
          internalKey: 'maintenance_advance',
          displayLabel: 'Advance Maintenance Charges (24 Months)',
          basis: 'FIXED_AMOUNT',
          amount: 422000,
          taxCategory: 'OTHER_SERVICE_GST',
          isOptional: false,
          isVisible: true,
          isRemovable: true,
          displayOrder: 3,
        },
        {
          id: 'li-4',
          internalKey: 'legal_documentation',
          displayLabel: 'Legal & Documentation Charges',
          basis: 'FIXED_AMOUNT',
          amount: 75000,
          taxCategory: 'OTHER_SERVICE_GST',
          isOptional: false,
          isVisible: true,
          isRemovable: true,
          displayOrder: 4,
        },
        {
          id: 'li-5',
          internalKey: 'corpus_fund',
          displayLabel: 'Corpus Fund Deposit',
          basis: 'PER_SQFT_SALEABLE',
          amount: 200,
          taxCategory: 'EXEMPT_CORPUS',
          isOptional: false,
          isVisible: true,
          isRemovable: true,
          displayOrder: 5,
        },
      ],
      taxConfig: {
        agreementGstPct: 5,
        otherServiceGstPct: 18,
        roundingMode: 'NEAREST_RUPEE',
        registrationDisclaimer:
          'Stamp duty and registration charges are extra at actuals.',
      },
      maxDiscountPctWithoutApproval: 2,
    });

    await submitPriceBookForApprovalService(db, ACTOR, 'Sales Director', {
      orgId: organization.id,
      priceBookId: pbDraft.id,
    });
    const appSnap = await db.collection('approvals').where('entityId', '==', pbDraft.id).get();
    await decideApprovalService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      approvalId: appSnap.docs[0]!.id,
      decision: 'APPROVED',
      decisionNotes: 'Approved C-704 pricing',
    });
    await activatePriceBookService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: pbDraft.id,
      reason: 'Initial activation',
    });

    // Construction-Linked Payment Schedule (8 milestones reconciling to 100%)
    const clpPlan = await createPaymentPlanService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower-C Construction-Linked Schedule',
      planType: 'CONSTRUCTION_LINKED',
      milestones: [
        { sequence: 1, name: 'Booking Advance', percentage: 10, dueTrigger: 'On Booking', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 2, name: 'Agreement Execution', percentage: 10, dueTrigger: 'Within 30 Days', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 3, name: 'Foundation Completion', percentage: 15, dueTrigger: 'On Foundation', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 4, name: 'Podium Slab', percentage: 15, dueTrigger: 'On Podium Slab', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 5, name: '7th Floor Slab', percentage: 15, dueTrigger: 'On 7th Floor Slab', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 6, name: 'Terrace Slab', percentage: 15, dueTrigger: 'On Terrace Slab', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 7, name: 'Internal Finishes & Flooring', percentage: 15, dueTrigger: 'On Flooring', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 8, name: 'Possession & Handover', percentage: 5, dueTrigger: 'On Possession Notice', taxTreatment: 'INCLUDE_POSSESSION_CHARGES' },
      ],
    });

    const { quotation, version, pdfBytes } = await createQuotationService(
      db,
      ACTOR,
      'Ananya Verma',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unitC704.id,
        priceBookId: pbDraft.id,
        paymentPlanId: clpPlan.id,
        customer: {
          name: 'Rajesh Krishnamurthy',
          phone: '+91 9845012345',
          email: 'rajesh.k@example.com',
        },
        parkingSlotsCount: 2,
        parkingTypeUsed: 'STANDARD',
        discount: { type: 'NONE', value: 0, reason: null },
        validDays: 15,
        termsAndConditions: 'Subject to RERA Sale Agreement terms.',
      }
    );

    // Exact regression assertion for ₹3,92,73,985
    expect(quotation.totalPayableInr).toBe(39273985);
    expect(quotation.discount.reason).toBeUndefined();
    expect(formatInr(quotation.totalPayableInr)).toBe('₹3,92,73,985');

    // Verify CLP schedule reconciles 100% and exact total INR
    const scheduleSum = quotation.breakdown.schedule.reduce(
      (acc, m) => acc + m.totalInstallmentPayableInr,
      0
    );
    expect(scheduleSum).toBe(39273985);

    // Verify generated PDF header signature
    const pdfHeader = Buffer.from(pdfBytes.slice(0, 5)).toString('utf8');
    expect(pdfHeader).toBe('%PDF-');
    expect(pdfBytes.byteLength).toBeGreaterThan(1500);

    // Hike project price book to v2 (₹12,500/sqft) and verify issued C-704 quotation retains frozen ₹3,92,73,985
    const v2 = await clonePriceBookVersionService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      sourcePriceBookId: pbDraft.id,
    });
    await savePriceBookDraftService(db, ACTOR, 'BUILDER_ADMIN', {
      ...v2,
      priceBookId: v2.id,
      basePricePerSqft: 12500,
    });
    await submitPriceBookForApprovalService(db, ACTOR, 'Director', {
      orgId: organization.id,
      priceBookId: v2.id,
    });
    const app2 = await db.collection('approvals').where('entityId', '==', v2.id).get();
    await decideApprovalService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      approvalId: app2.docs[0]!.id,
      decision: 'APPROVED',
      decisionNotes: 'Approved hike',
    });
    await activatePriceBookService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: v2.id,
      reason: 'Hike active',
    });

    const savedQuotationSnap = await db.collection('quotations').doc(quotation.id).get();
    expect(savedQuotationSnap.data()?.totalPayableInr).toBe(39273985);
    expect(version.priceBookSnapshot.basePricePerSqft).toBe(11100);
  });

  it('maps floor plans strictly by tower, floor category & floor range (never leaking upper-floor plans to podium/lower floors)', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ACTOR, {
      name: 'Meridian Group',
      legalName: 'Meridian Group LLP',
      headquartersCity: 'Hyderabad',
    });

    const project = await createProjectService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Meridian Group',
      name: 'Meridian Sky',
      code: 'MSK',
      city: 'Hyderabad',
      locality: 'Kokapet',
      address: 'Neopolis, Kokapet, Hyderabad',
      projectType: 'APARTMENT',
      reraNumber: 'P02400005555',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const towerA = await createTowerService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower A',
      code: 'A',
      towerType: 'TOWER',
      totalFloors: 20,
      basementLevels: 2,
      podiumLevels: 2,
      unitsPerFloorTypical: 4,
    });

    const podiumUnit = await createUnitService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      towerId: towerA.id,
      floorNumber: 1,
      unitNumber: 'A-101',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 2100,
      carpetAreaSqft: 1470,
      facing: 'EAST',
      baseRatePerSqft: 9500,
    });

    const upperUnit = await createUnitService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      towerId: towerA.id,
      floorNumber: 8,
      unitNumber: 'A-801',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 2100,
      carpetAreaSqft: 1470,
      facing: 'EAST',
      baseRatePerSqft: 9500,
    });

    const docV1 = await registerDocumentService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      category: 'FLOOR_PLAN',
      title: 'Tower A Typical 4th–20th Floor Plan',
      fileName: 'tower_a_typical.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 420000,
      storagePath: `organizations/${organization.id}/projects/${project.id}/documents/tower_a_typical.pdf`,
      visibility: 'PARTNER',
      watermarkEnabled: true,
    });

    const docV2 = await replaceDocumentVersionService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      documentId: docV1.id,
      newStoragePath: `organizations/${organization.id}/projects/${project.id}/documents/tower_a_typical_v2.pdf`,
      newFileName: 'tower_a_typical_v2.pdf',
      sizeBytes: 435000,
    });
    expect(docV2.currentVersion).toBe(2);

    const shareLink = await createExpiringShareLinkService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      documentId: docV1.id,
      expiresInHours: 48,
    });
    expect(shareLink.tokenId.length).toBeGreaterThan(16);

    const mapped = await mapFloorPlanToUnitsService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      documentId: docV1.id,
      projectId: project.id,
      towerIds: [towerA.id],
      floorCategory: 'TYPICAL',
      minFloor: 4,
      maxFloor: 20,
      applicableUnitTypes: ['APARTMENT'],
      applicableBhk: ['3 BHK'],
      carpetAreaSqft: 1470,
      saleableAreaSqft: 2100,
      storagePath: docV2.storagePath,
      fileName: docV2.fileName,
    });

    expect(mapped.matchedUnitsCount).toBe(1);

    const podiumAfter = await db.collection('units').doc(podiumUnit.id).get();
    const upperAfter = await db.collection('units').doc(upperUnit.id).get();
    expect(podiumAfter.data()?.floorPlanVersionId).toBeNull();
    expect(upperAfter.data()?.floorPlanVersionId).toBe(mapped.floorPlanVersion.id);
  });
});
