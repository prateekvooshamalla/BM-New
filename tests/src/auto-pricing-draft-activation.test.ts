import { describe, expect, it } from 'vitest';
import {
  type PriceBook,
  type Unit,
} from '@bharat-makaan/shared';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService, createTowerService } from '../../functions/src/projects';
import { createUnitService, bulkGenerateTowerUnitsService } from '../../functions/src/inventory';
import { activatePriceBookService, ensureBaselinePriceBookForProject } from '../../functions/src/pricing';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const ACTOR = {
  uid: 'uid-builder-admin',
  email: 'admin@buildercorp.test',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Auto-Generated Version 1 Price Book on Tower/Flat Creation & Activation Reflection', () => {
  it('automatically creates a Version 1 Draft Price Book when single units are generated and activates it cleanly', async () => {
    const db = createTransactionalTestFirestore({ enforceReadBeforeWrite: true });
    const { organization } = await createOrganizationService(db, ACTOR, {
      name: 'Pinnacle Infra',
      legalName: 'Pinnacle Infra Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Pinnacle Infra',
      name: 'Pinnacle Serenity',
      code: 'PNS',
      city: 'Bengaluru',
      locality: 'Whitefield',
      address: 'ITPL Main Road, Whitefield',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/1251/446/PR/9999',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    // Verify initially NO price books exist
    const initialPbSnap = await db
      .collection('price_books')
      .where('orgId', '==', organization.id)
      .where('projectId', '==', project.id)
      .get();
    expect(initialPbSnap.docs.length).toBe(0);

    // Create a flat with baseRatePerSqft = 8800
    const unit1 = await createUnitService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 5,
      unitNumber: 'A-501',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1850,
      carpetAreaSqft: 1295,
      facing: 'EAST',
      isCorner: true,
      parkingEntitlementCount: 2,
      baseRatePerSqft: 8800,
    });

    expect(unit1.id).toBeDefined();

    // Verify that a Version 1 Price Book in DRAFT was AUTOMATICALLY generated!
    const autoPbSnap = await db
      .collection('price_books')
      .where('orgId', '==', organization.id)
      .where('projectId', '==', project.id)
      .get();

    expect(autoPbSnap.docs.length).toBe(1);
    const draftV1 = autoPbSnap.docs[0].data() as PriceBook;
    expect(draftV1.versionNumber).toBe(1);
    expect(draftV1.status).toBe('DRAFT');
    expect(draftV1.isImmutable).toBe(false);
    expect(draftV1.basePricePerSqft).toBe(8800);
    expect(draftV1.lineItems.length).toBeGreaterThan(0);
    expect(draftV1.floorRise.enabled).toBe(true);

    // Initial unit has raw base price before price book activation
    expect(unit1.calculatedTotalPrice).toBe(1850 * 8800);
    expect(unit1.activePriceBookId).toBeUndefined();

    // ACTIVATE the draft price book directly!
    const activationResult = await activatePriceBookService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: draftV1.id,
      reason: 'Activated launch pricing baseline',
    });

    expect(activationResult.activatedBook.status).toBe('ACTIVE');
    expect(activationResult.activatedBook.isImmutable).toBe(true);
    expect(activationResult.updatedUnitsCount).toBe(1);

    // Verify that the unit now REFLECTS the activated Price Book!
    const unitSnapAfter = await db.collection('units').doc(unit1.id).get();
    const unitAfter = unitSnapAfter.data() as Unit;

    expect(unitAfter.activePriceBookId).toBe(draftV1.id);
    expect(unitAfter.baseRatePerSqft).toBe(8800);
    // Calculated total price must now reflect all-inclusive consideration (base + floor rise + facing + amenities + GST)
    expect(unitAfter.calculatedTotalPrice).toBeGreaterThan(unit1.calculatedTotalPrice);
    expect(unitAfter.floorRiseAmount).toBeGreaterThan(0); // Floor 5 has floor rise
    expect(unitAfter.premiumChargesAmount).toBeGreaterThan(0); // East facing + corner unit
  });

  it('automatically creates a Version 1 Draft Price Book on bulk tower flat generation', async () => {
    const db = createTransactionalTestFirestore({ enforceReadBeforeWrite: true });
    const { organization } = await createOrganizationService(db, ACTOR, {
      name: 'Skyline Corp',
      legalName: 'Skyline Corp India Ltd',
      headquartersCity: 'Hyderabad',
    });

    const project = await createProjectService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Skyline Corp',
      name: 'Skyline Oasis',
      code: 'SKO',
      city: 'Hyderabad',
      locality: 'Kokapet',
      address: 'Outer Ring Road, Kokapet',
      projectType: 'APARTMENT',
      reraNumber: 'P02400008888',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const tower = await createTowerService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower 1',
      code: 'T1',
      towerType: 'TOWER',
      totalFloors: 10,
      unitsPerFloorTypical: 4,
    });

    // Bulk generate 8 flats across floors 1..2 with baseRatePerSqft = 9500
    const bulkRes = await bulkGenerateTowerUnitsService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      towerId: tower.id,
      towerCode: tower.code,
      towerName: tower.name,
      startFloor: 1,
      endFloor: 2,
      unitsPerFloor: 4,
      startUnitNumber: 1,
      bhk: '3 BHK',
      saleableAreaSqft: 2000,
      carpetAreaSqft: 1400,
      facing: 'EAST',
      baseRatePerSqft: 9500,
      parkingEntitlementCount: 2,
      isCorner: false,
      isPublicPublished: true,
      listingMode: 'BUY',
    });

    expect(bulkRes.createdCount).toBe(8);

    // Verify v1 draft price book was automatically generated
    const pbSnap = await db
      .collection('price_books')
      .where('orgId', '==', organization.id)
      .where('projectId', '==', project.id)
      .get();

    expect(pbSnap.docs.length).toBe(1);
    const pb = pbSnap.docs[0].data() as PriceBook;
    expect(pb.versionNumber).toBe(1);
    expect(pb.status).toBe('DRAFT');
    expect(pb.basePricePerSqft).toBe(9500);

    // Activate the price book
    const act = await activatePriceBookService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: pb.id,
      reason: 'Activate Skyline Oasis Launch Pricing',
    });

    expect(act.activatedBook.status).toBe('ACTIVE');
    expect(act.updatedUnitsCount).toBe(8);

    // Verify all 8 units reflect the active price book id
    const unitsSnap = await db
      .collection('units')
      .where('orgId', '==', organization.id)
      .where('projectId', '==', project.id)
      .get();

    expect(unitsSnap.docs.length).toBe(8);
    for (const uDoc of unitsSnap.docs) {
      const u = uDoc.data() as Unit;
      expect(u.activePriceBookId).toBe(pb.id);
      expect(u.baseRatePerSqft).toBe(9500);
      expect(u.calculatedTotalPrice).toBeGreaterThan(2000 * 9500); // Base + amenities + GST
    }
  });

  it('ensureBaselinePriceBookForProject is idempotent and preserves active price books', async () => {
    const db = createTransactionalTestFirestore({ enforceReadBeforeWrite: true });
    const { organization } = await createOrganizationService(db, ACTOR, {
      name: 'Omni Group',
      legalName: 'Omni Group Ltd',
      headquartersCity: 'Chennai',
    });

    const project = await createProjectService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Omni Group',
      name: 'Omni One',
      code: 'OM1',
      city: 'Chennai',
      locality: 'OMR',
      address: 'OMR IT Corridor, Chennai',
      projectType: 'APARTMENT',
      reraNumber: 'TN/01/2026',
      configurations: ['2 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    // First call generates draft v1
    const pb1 = await ensureBaselinePriceBookForProject(db, {
      orgId: organization.id,
      projectId: project.id,
      baseRatePerSqft: 7500,
      actorUid: ACTOR.uid,
    });

    expect(pb1).toBeDefined();
    expect(pb1?.versionNumber).toBe(1);
    expect(pb1?.status).toBe('DRAFT');
    expect(pb1?.basePricePerSqft).toBe(7500);

    // Activate it
    await activatePriceBookService(db, ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: pb1!.id,
      reason: 'Activated',
    });

    // Subsequent call does NOT overwrite the active price book
    const pb2 = await ensureBaselinePriceBookForProject(db, {
      orgId: organization.id,
      projectId: project.id,
      baseRatePerSqft: 8000,
      actorUid: ACTOR.uid,
    });

    expect(pb2?.id).toBe(pb1?.id);
    expect(pb2?.status).toBe('ACTIVE');
    expect(pb2?.basePricePerSqft).toBe(7500); // Preserved active rate
  });
});
