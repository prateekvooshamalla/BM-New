import { describe, expect, it } from 'vitest';
import { calculateCostSheet } from '@bharat-makaan/shared';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService } from '../../functions/src/projects';
import { createUnitService, transitionUnitStatusService } from '../../functions/src/inventory';
import { decideApprovalService } from '../../functions/src/approvals';
import {
  activatePriceBookService,
  clonePriceBookVersionService,
  DEFAULT_LINE_ITEMS_TEMPLATE,
  savePriceBookDraftService,
  submitPriceBookForApprovalService,
} from '../../functions/src/pricing';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const ADMIN = {
  uid: 'uid-director',
  email: 'director@prestige.in',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Phase 3 — Dynamic Pricing Engine: Editable Labels, Approvals, Immutability & Revisions', () => {
  it('supports editable cost-sheet labels with stable internal keys, locks approved versions, and logs unit revisions', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'Vanguard Builders',
      legalName: 'Vanguard Builders Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Vanguard Builders',
      name: 'Vanguard Heights',
      code: 'VGH-1',
      city: 'Bengaluru',
      locality: 'Hebbal',
      address: 'Bellary Road, Hebbal, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/1251/309/PR/2026',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const unitAvail = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 6,
      unitNumber: 'A-601',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 2000,
      carpetAreaSqft: 1400,
      facing: 'EAST',
      parkingEntitlementCount: 1,
      baseRatePerSqft: 9000,
    });

    const unitBooked = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 6,
      unitNumber: 'A-602',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 2000,
      carpetAreaSqft: 1400,
      facing: 'WEST',
      parkingEntitlementCount: 1,
      baseRatePerSqft: 9000,
    });

    // Transition A-602 to ON_HOLD -> BOOKED so we verify booked units are NOT repriced on future price hikes
    await transitionUnitStatusService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      unitId: unitBooked.id,
      targetStatus: 'ON_HOLD',
      action: 'HOLD',
    });
    await transitionUnitStatusService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      unitId: unitBooked.id,
      targetStatus: 'BOOKED',
      action: 'BOOK',
    });

    // Customize label from "Amenities Charges" -> "Amenities & Infrastructure Development Charges"
    const customLineItems = structuredClone(DEFAULT_LINE_ITEMS_TEMPLATE);
    customLineItems[0]!.displayLabel = 'Amenities & Infrastructure Development Charges';

    const draftV1 = await savePriceBookDraftService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Launch Price Book',
      effectiveFrom: '2026-11-16T00:00:00.000Z',
      basePricePerSqft: 10000,
      floorRise: { enabled: true, startFloor: 5, ratePerFloorPerSqft: 50 },
      facingPremiumPerSqft: { EAST: 100 },
      viewPremiumPerSqft: {},
      cornerPremiumPerSqft: 0,
      locationPremiumPerSqft: 0,
      unitSpecificPremiumInr: {},
      parkingPricesByType: {
        STANDARD: 400000,
        TANDEM: 700000,
        MECHANICAL: 350000,
        EV: 500000,
        ACCESSIBLE: 400000,
      },
      lineItems: customLineItems,
      taxConfig: {
        agreementGstPct: 5,
        otherServiceGstPct: 18,
        roundingMode: 'NEAREST_RUPEE',
        registrationDisclaimer: 'Registration charges extra at actuals.',
      },
      maxDiscountPctWithoutApproval: 2,
    });

    const computedPreview = calculateCostSheet({ unit: unitAvail, priceBook: draftV1 });
    const amenitiesItem = computedPreview.lineItems.find(
      (l) => l.internalKey === 'amenities_charges'
    );
    expect(amenitiesItem?.displayLabel).toBe(
      'Amenities & Infrastructure Development Charges'
    );

    // Submit v1 for approval & approve
    await submitPriceBookForApprovalService(db, ADMIN, 'Director', {
      orgId: organization.id,
      priceBookId: draftV1.id,
    });

    const pendingApprovals = await db
      .collection('approvals')
      .where('orgId', '==', organization.id)
      .where('entityId', '==', draftV1.id)
      .get();
    expect(pendingApprovals.size).toBe(1);

    await decideApprovalService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      approvalId: pendingApprovals.docs[0]!.id,
      decision: 'APPROVED',
      decisionNotes: 'Approved launch pricing',
    });

    // Attempting to edit approved v1 MUST fail (immutable)
    await expect(
      savePriceBookDraftService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: organization.id,
        projectId: project.id,
        priceBookId: draftV1.id,
        name: 'Tampered Launch Book',
        effectiveFrom: '2026-11-16T00:00:00.000Z',
        basePricePerSqft: 12000,
        floorRise: { enabled: true, startFloor: 5, ratePerFloorPerSqft: 50 },
        parkingPricesByType: {
          STANDARD: 400000,
          TANDEM: 700000,
          MECHANICAL: 350000,
          EV: 500000,
          ACCESSIBLE: 400000,
        },
        lineItems: customLineItems,
        taxConfig: {
          agreementGstPct: 5,
          otherServiceGstPct: 18,
          roundingMode: 'NEAREST_RUPEE',
          registrationDisclaimer: 'Registration extra.',
        },
      })
    ).rejects.toThrow(/immutable/);

    // Activate v1
    const act1 = await activatePriceBookService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: draftV1.id,
      reason: 'Launch activation',
    });
    expect(act1.updatedUnitsCount).toBe(1); // Only A-601 (AVAILABLE), NOT A-602 (BOOKED)

    const bookedAfterAct1 = await db.collection('units').doc(unitBooked.id).get();
    expect(bookedAfterAct1.data()?.baseRatePerSqft).toBe(9000);

    // Clone v1 -> v2, hike base price to 10800, approve & activate v2
    const clonedV2 = await clonePriceBookVersionService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      sourcePriceBookId: draftV1.id,
      newName: 'Phase-2 Hike Book',
    });
    expect(clonedV2.versionNumber).toBe(2);
    expect(clonedV2.isImmutable).toBe(false);

    await savePriceBookDraftService(db, ADMIN, 'BUILDER_ADMIN', {
      ...clonedV2,
      priceBookId: clonedV2.id,
      basePricePerSqft: 10800,
    });
    await submitPriceBookForApprovalService(db, ADMIN, 'Director', {
      orgId: organization.id,
      priceBookId: clonedV2.id,
    });
    const app2Snap = await db
      .collection('approvals')
      .where('entityId', '==', clonedV2.id)
      .get();
    await decideApprovalService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      approvalId: app2Snap.docs[0]!.id,
      decision: 'APPROVED',
      decisionNotes: 'Approved ₹800/sqft revision',
    });
    await activatePriceBookService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: clonedV2.id,
      reason: 'Q4 inventory appreciation',
    });

    // Verify v1 is ARCHIVED and price_revisions captured exact delta
    const v1After = await db.collection('price_books').doc(draftV1.id).get();
    expect(v1After.data()?.status).toBe('ARCHIVED');

    const revisionsSnap = await db
      .collection('price_revisions')
      .where('unitId', '==', unitAvail.id)
      .get();
    expect(revisionsSnap.size).toBe(2);
  });
});
