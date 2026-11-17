import { describe, expect, it } from 'vitest';
import {
  createUnitService,
  updateUnitService,
  bulkGenerateTowerUnitsService,
  transitionUnitStatusService,
} from '../../functions/src/inventory';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService, createTowerService } from '../../functions/src/projects';
import { ingestLeadService, convertLeadToCustomerService } from '../../functions/src/leads';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';
import type { AuthenticatedActor } from '../../functions/src/shared/auth-guard';

const ADMIN: AuthenticatedActor = {
  uid: 'builder_admin_1',
  email: 'admin@builder.com',
  isSuperAdmin: false,
  mfaVerified: true,
};

async function setupProjectFixture() {
  const db = createTransactionalTestFirestore();
  const { organization } = await createOrganizationService(db, ADMIN, {
    name: 'Bharat Sky Villas',
    legalName: 'Bharat Sky Villas Pvt Ltd',
    headquartersCity: 'Bengaluru',
  });
  const project = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
    orgId: organization.id,
    builderName: 'Bharat Sky Villas',
    name: 'Skyline Heights',
    code: 'SH',
    city: 'Bengaluru',
    locality: 'Whitefield',
    address: 'Hope Farm Junction, Whitefield',
    reraNumber: 'PRM/KA/RERA/1251/446/PR/220101/004500',
    projectType: 'APARTMENT',
    configurations: ['2 BHK', '3 BHK', '4 BHK'],
    constructionStatus: 'UNDER_CONSTRUCTION',
  });
  const tower = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
    orgId: organization.id,
    projectId: project.id,
    name: 'Tower Alpha',
    code: 'TA',
    towerType: 'TOWER',
    totalFloors: 20,
  });

  return { db, org: organization, project, tower };
}

describe('Flat Series Number, Edit Options & Customer Conversion Workflow', () => {
  it('assigns series number on flat creation and prevents duplicate series on the same floor', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    // 1. Create Flat 101 with series "01" on Floor 1
    const flat101 = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 1,
      series: '01',
      unitNumber: 'TA-101',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 9000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(flat101.unitNumber).toBe('TA-101');
    expect(flat101.series).toBe('01');
    expect(flat101.floorNumber).toBe(1);

    // 2. Attempt to create another flat on Floor 1 with the SAME series "01" -> Must throw already-exists
    await expect(
      createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        projectId: project.id,
        towerId: tower.id,
        towerName: tower.name,
        floorNumber: 1,
        series: '01',
        unitNumber: 'TA-101B',
        unitType: 'APARTMENT',
        bhk: '3 BHK',
        saleableAreaSqft: 1800,
        carpetAreaSqft: 1260,
        facing: 'WEST',
        baseRatePerSqft: 9000,
        isCorner: false,
        parkingEntitlementCount: 1,
        listingMode: 'BUY',
      })
    ).rejects.toThrow(/already exists on floor 1/);

    // 3. Create flat with series "01" on a DIFFERENT floor (Floor 2) -> Allowed!
    const flat201 = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 2,
      series: '01',
      unitNumber: 'TA-201',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 9000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(flat201.unitNumber).toBe('TA-201');
    expect(flat201.series).toBe('01');
    expect(flat201.floorNumber).toBe(2);

    // 4. Create flat with different series "02" on Floor 1 -> Allowed!
    const flat102 = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 1,
      series: '02',
      unitNumber: 'TA-102',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'WEST',
      baseRatePerSqft: 9000,
      isCorner: true,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(flat102.series).toBe('02');
  });

  it('bulk generation automatically populates standardized series numbers per floor', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    const result = await bulkGenerateTowerUnitsService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerCode: tower.code,
      towerName: tower.name,
      startFloor: 3,
      endFloor: 4,
      unitsPerFloor: 3,
      startUnitNumber: 1,
      bhk: '3 BHK',
      saleableAreaSqft: 1650,
      carpetAreaSqft: 1155,
      facing: 'NORTH',
      baseRatePerSqft: 8500,
    });

    expect(result.createdCount).toBe(6);
    const snap = await db.collection('units').where('floorNumber', '==', 3).get();
    const floor3Units = snap.docs.map((d) => d.data());
    expect(floor3Units.length).toBe(3);
    const seriesList = floor3Units.map((u) => u.series).sort();
    expect(seriesList).toEqual(['01', '02', '03']);
  });

  it('updates flat specifications and recalculates pricing correctly', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    const created = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 5,
      series: '01',
      unitNumber: 'TA-501',
      unitType: 'APARTMENT',
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      facing: 'NORTH',
      baseRatePerSqft: 8000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(created.calculatedTotalPrice).toBe(1200 * 8000); // 9,600,000

    // Edit flat: upgrade to 3 BHK, 1600 sq.ft., base rate 8500
    const updated = await updateUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      unitId: created.id,
      unitNumber: 'TA-501-A',
      series: '01-A',
      bhk: '3 BHK',
      saleableAreaSqft: 1600,
      carpetAreaSqft: 1120,
      baseRatePerSqft: 8500,
      facing: 'EAST',
      isCorner: true,
      parkingEntitlementCount: 2,
    });

    expect(updated.unitNumber).toBe('TA-501-A');
    expect(updated.series).toBe('01-A');
    expect(updated.bhk).toBe('3 BHK');
    expect(updated.saleableAreaSqft).toBe(1600);
    expect(updated.carpetAreaSqft).toBe(1120);
    expect(updated.facing).toBe('EAST');
    expect(updated.isCorner).toBe(true);
    expect(updated.parkingEntitlementCount).toBe(2);
    expect(updated.calculatedTotalPrice).toBe(1600 * 8500); // 13,600,000
    expect(updated.calculatedTotalMinor).toBe(1360000000);
  });

  it('holds and reserves flat with customer, automatically converting prospect to verified customer', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    // 1. Create an available flat
    const flat = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 6,
      series: '01',
      unitNumber: 'TA-601',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 9000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    // 2. Ingest a new prospect lead
    const { lead: prospect } = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      customerName: 'Suresh Patel',
      phone: '+919988776655',
      source: 'MANUAL',
      whatsappOptIn: true,
    });

    expect(prospect.isCustomer).toBeFalsy();
    expect(prospect.customerConvertedAt).toBeFalsy();

    // 3. Place 48h hold on TA-601 for Suresh Patel
    const heldFlat = await transitionUnitStatusService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      unitId: flat.id,
      targetStatus: 'ON_HOLD',
      action: 'HOLD',
      leadId: prospect.id,
      holdDurationHours: 48,
    });

    expect(heldFlat.status).toBe('ON_HOLD');
    expect(heldFlat.heldForLeadId).toBe(prospect.id);
    expect(heldFlat.holdExpiresAt).toBeDefined();

    // Check that Suresh Patel was automatically promoted to Customer
    const leadAfterHoldSnap = await db.collection('leads').doc(prospect.id).get();
    const leadAfterHold = leadAfterHoldSnap.data();
    expect(leadAfterHold?.isCustomer).toBe(true);
    expect(leadAfterHold?.customerConvertedAt).toBeDefined();

    // 4. Reserve unit TA-601 for Suresh Patel with advance receipt
    const reservedFlat = await transitionUnitStatusService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      unitId: flat.id,
      targetStatus: 'RESERVED',
      action: 'RESERVE',
      leadId: prospect.id,
      holdAdvanceAmount: 100000,
      holdPaymentReference: 'UTR-HDFC-998877',
      reason: 'Token advance received via RTGS',
    });

    expect(reservedFlat.status).toBe('RESERVED');
    expect(reservedFlat.holdAdvanceAmount).toBe(100000);
    expect(reservedFlat.holdPaymentReference).toBe('UTR-HDFC-998877');

    const leadAfterReserveSnap = await db.collection('leads').doc(prospect.id).get();
    const leadAfterReserve = leadAfterReserveSnap.data();
    expect(leadAfterReserve?.isCustomer).toBe(true);
    expect(leadAfterReserve?.stage).toBe('NEGOTIATION');
  });

  it('allows converting a prospect lead directly to customer via convertLeadToCustomerService', async () => {
    const { db, org, project } = await setupProjectFixture();

    const { lead: prospect } = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      customerName: 'Ananya Sharma',
      phone: '+919123456780',
      source: 'WEBSITE',
      whatsappOptIn: true,
    });

    expect(prospect.isCustomer).toBeFalsy();

    const converted = await convertLeadToCustomerService(db, ADMIN, {
      orgId: org.id,
      leadId: prospect.id,
      notes: 'Customer visited site office and confirmed budget.',
    });

    expect(converted.isCustomer).toBe(true);
    expect(converted.customerConvertedAt).toBeDefined();
    expect(converted.convertedByUid).toBe(ADMIN.uid);

    // Verify lead activity was logged
    const activitiesSnap = await db
      .collection('lead_activities')
      .where('leadId', '==', prospect.id)
      .get();
    const activities = activitiesSnap.docs.map((d) => d.data());
    const conversionAct = activities.find((a) => a.title.includes('Converted from Prospect to Customer'));
    expect(conversionAct).toBeDefined();
  });

  it('enforces tower floor limits on bulk generation, unit creation, and unit update', async () => {
    const { db, org, project } = await setupProjectFixture();

    // Create a tower with only 5 floors
    const tower5 = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      name: 'Tower Beta 5 Floors',
      code: 'TB5',
      towerType: 'TOWER',
      totalFloors: 5,
    });

    // 1. Bulk generation: attempt to generate up to floor 10 on a 5-floor tower -> must throw
    await expect(
      bulkGenerateTowerUnitsService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        projectId: project.id,
        towerId: tower5.id,
        towerCode: tower5.code,
        towerName: tower5.name,
        startFloor: 1,
        endFloor: 10,
        unitsPerFloor: 4,
        startUnitNumber: 1,
        bhk: '2 BHK',
        saleableAreaSqft: 1200,
        carpetAreaSqft: 840,
        facing: 'EAST',
        baseRatePerSqft: 7500,
      })
    ).rejects.toThrow(/cannot exceed tower "Tower Beta 5 Floors" total floors \(5\)/);

    // 2. Bulk generation: generating up to floor 5 is allowed!
    const bulkValid = await bulkGenerateTowerUnitsService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower5.id,
      towerCode: tower5.code,
      towerName: tower5.name,
      startFloor: 1,
      endFloor: 5,
      unitsPerFloor: 2,
      startUnitNumber: 1,
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      facing: 'EAST',
      baseRatePerSqft: 7500,
    });
    expect(bulkValid.createdCount).toBe(10); // 5 floors * 2 units

    // 3. Single unit creation: attempt to create unit on floor 6 -> must throw
    await expect(
      createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        projectId: project.id,
        towerId: tower5.id,
        towerName: tower5.name,
        floorNumber: 6,
        series: '01',
        unitNumber: 'TB5-601',
        unitType: 'APARTMENT',
        bhk: '2 BHK',
        saleableAreaSqft: 1200,
        carpetAreaSqft: 840,
        facing: 'EAST',
        baseRatePerSqft: 7500,
        isCorner: false,
        parkingEntitlementCount: 1,
        listingMode: 'BUY',
      })
    ).rejects.toThrow(/exceeds tower "Tower Beta 5 Floors" total floors \(5\)/);

    // 4. Update unit: create valid unit on floor 4, then attempt to update to floor 8 -> must throw
    const validUnit = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower5.id,
      towerName: tower5.name,
      floorNumber: 4,
      series: '03',
      unitNumber: 'TB5-403',
      unitType: 'APARTMENT',
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      facing: 'WEST',
      baseRatePerSqft: 7500,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    await expect(
      updateUnitService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        unitId: validUnit.id,
        floorNumber: 8,
      })
    ).rejects.toThrow(/exceeds tower "Tower Beta 5 Floors" total floors \(5\)/);
  });
});
