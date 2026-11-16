import { describe, expect, it } from 'vitest';
import { createOrganizationService } from '../../functions/src/organizations';
import {
  createFloorService,
  createPhaseService,
  createProjectService,
  createTowerService,
} from '../../functions/src/projects';
import {
  createUnitService,
  transitionUnitStatusService,
} from '../../functions/src/inventory';
import {
  allocateParkingSlotService,
  createParkingSlotService,
  swapParkingSlotsService,
} from '../../functions/src/parking';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const ADMIN_ACTOR = {
  uid: 'uid-builder-admin',
  email: 'admin@emeraldgroup.in',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Phase 2 — Enterprise Core: Projects, Hierarchy, Visual Inventory & Parking', () => {
  it('creates projects, phases, towers, floors, apartment units and plotted units without artificial floors', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN_ACTOR, {
      name: 'Emerald Developers',
      legalName: 'Emerald Developers Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Emerald Developers',
      name: 'Emerald Crest',
      code: 'EMC-01',
      city: 'Bengaluru',
      locality: 'Sarjapur Road',
      address: 'Survey 42, Sarjapur Main Road, Bengaluru',
      projectType: 'MIXED',
      reraNumber: 'PRM/KA/RERA/1251/446/PR/001',
      configurations: ['3 BHK', '4 BHK', 'PLOT'],
      amenities: ['Clubhouse', 'EV Charging'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const phase = await createPhaseService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Phase 1',
      code: 'P1',
      sequence: 1,
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const tower = await createTowerService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      phaseId: phase.id,
      name: 'Tower C',
      code: 'C',
      towerType: 'TOWER',
      totalFloors: 14,
      basementLevels: 2,
      podiumLevels: 1,
      unitsPerFloorTypical: 4,
    });

    const floor7 = await createFloorService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      phaseId: phase.id,
      towerId: tower.id,
      floorNumber: 7,
      label: '7th Floor',
      floorCategory: 'TYPICAL',
    });

    const aptUnit = await createUnitService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      phaseId: phase.id,
      towerId: tower.id,
      towerName: tower.name,
      floorId: floor7.id,
      floorNumber: 7,
      unitNumber: 'C-704',
      unitType: 'APARTMENT',
      bhk: '4 BHK',
      saleableAreaSqft: 2965,
      carpetAreaSqft: 2075,
      facing: 'EAST',
      isCorner: true,
      balconiesCount: 3,
      parkingEntitlementCount: 2,
      baseRatePerSqft: 11100,
    });

    const plotUnit = await createUnitService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      unitNumber: 'PLOT-18',
      unitType: 'PLOT',
      bhk: 'PLOT',
      floorNumber: 0,
      saleableAreaSqft: 2400,
      carpetAreaSqft: 2400,
      facing: 'NORTH',
      parkingEntitlementCount: 0,
      baseRatePerSqft: 6500,
    });

    expect(aptUnit.unitNumber).toBe('C-704');
    expect(plotUnit.floorNumber).toBe(0);
    expect(plotUnit.towerId).toBeNull();

    const updatedProjSnap = await db.collection('projects').doc(project.id).get();
    expect(updatedProjSnap.data()?.stats.totalUnits).toBe(2);
    expect(updatedProjSnap.data()?.stats.availableUnits).toBe(2);
  });

  it('prevents concurrent conflicting holds/reservations on the same unit via transactions', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN_ACTOR, {
      name: 'Crest Homes',
      legalName: 'Crest Homes LLP',
      headquartersCity: 'Pune',
    });

    const project = await createProjectService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Crest Homes',
      name: 'Crest One',
      code: 'CR1',
      city: 'Pune',
      locality: 'Baner',
      address: 'Baner High Street, Pune',
      projectType: 'APARTMENT',
      reraNumber: 'P52100012345',
      configurations: ['3 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    const unit = await createUnitService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 5,
      unitNumber: 'A-501',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 9000,
    });

    const agent1 = { uid: 'agent-1', email: 'a1@crest.in', isSuperAdmin: false, mfaVerified: false };
    const agent2 = { uid: 'agent-2', email: 'a2@crest.in', isSuperAdmin: false, mfaVerified: false };

    // Race two concurrent HOLD attempts on the exact same unit
    const results = await Promise.allSettled([
      transitionUnitStatusService(db, agent1, 'SALES_EXECUTIVE', {
        orgId: organization.id,
        unitId: unit.id,
        targetStatus: 'ON_HOLD',
        action: 'HOLD',
        holdDurationHours: 24,
      }),
      transitionUnitStatusService(db, agent2, 'SALES_EXECUTIVE', {
        orgId: organization.id,
        unitId: unit.id,
        targetStatus: 'ON_HOLD',
        action: 'HOLD',
        holdDurationHours: 24,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Agent 2 cannot hijack Agent 1's active hold into RESERVED without manager override
    await expect(
      transitionUnitStatusService(db, agent2, 'SALES_EXECUTIVE', {
        orgId: organization.id,
        unitId: unit.id,
        targetStatus: 'RESERVED',
        action: 'RESERVE',
      })
    ).rejects.toThrow();

    // Authorized release transitions unit cleanly back to AVAILABLE
    const released = await transitionUnitStatusService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      unitId: unit.id,
      targetStatus: 'AVAILABLE',
      action: 'RELEASE',
      reason: 'Customer opted for higher floor',
    });
    expect(released.status).toBe('AVAILABLE');
  });

  it('distinguishes parking entitlement from physical slot allocation, prevents conflicts, and swaps slots', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN_ACTOR, {
      name: 'Zenith Realty',
      legalName: 'Zenith Realty Pvt Ltd',
      headquartersCity: 'Mumbai',
    });

    const project = await createProjectService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Zenith Realty',
      name: 'Zenith Bay',
      code: 'ZB1',
      city: 'Mumbai',
      locality: 'Worli',
      address: 'Worli Sea Face, Mumbai',
      projectType: 'APARTMENT',
      reraNumber: 'P51900099999',
      configurations: ['4 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const unit1 = await createUnitService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 10,
      unitNumber: 'B-1001',
      unitType: 'APARTMENT',
      bhk: '4 BHK',
      saleableAreaSqft: 3000,
      carpetAreaSqft: 2100,
      facing: 'WEST',
      parkingEntitlementCount: 2,
      baseRatePerSqft: 35000,
    });

    const unit2 = await createUnitService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 10,
      unitNumber: 'B-1002',
      unitType: 'APARTMENT',
      bhk: '4 BHK',
      saleableAreaSqft: 3000,
      carpetAreaSqft: 2100,
      facing: 'EAST',
      parkingEntitlementCount: 2,
      baseRatePerSqft: 35000,
    });

    // Unit 1 is entitled to 2 spaces while physical slots are initially unassigned
    expect(unit1.parkingEntitlementCount).toBe(2);
    expect(unit1.assignedParkingSlotIds).toHaveLength(0);

    const slotB1_01 = await createParkingSlotService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      levelType: 'BASEMENT',
      levelName: 'B1',
      zone: 'Zone A',
      slotNumber: '101',
      parkingType: 'STANDARD',
      priceInr: 800000,
    });

    const slotB1_EV = await createParkingSlotService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      levelType: 'BASEMENT',
      levelName: 'B1',
      zone: 'Zone EV',
      slotNumber: 'EV-04',
      parkingType: 'EV',
      priceInr: 1000000,
    });

    // Allocate B1-101 to Unit 1
    await allocateParkingSlotService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      slotId: slotB1_01.id,
      unitId: unit1.id,
      reason: 'Primary bay allocation',
    });

    // Conflicting allocation of B1-101 to Unit 2 MUST fail
    await expect(
      allocateParkingSlotService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
        orgId: organization.id,
        projectId: project.id,
        slotId: slotB1_01.id,
        unitId: unit2.id,
        reason: 'Attempted double allocation',
      })
    ).rejects.toThrow(/Conflict/);

    // Atomic swap for Unit 1 from B1-101 -> B1-EV-04
    const swapped = await swapParkingSlotsService(db, ADMIN_ACTOR, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      currentSlotId: slotB1_01.id,
      targetSlotId: slotB1_EV.id,
      unitId: unit1.id,
      reason: 'Upgraded to EV bay',
    });

    expect(swapped.releasedSlot.status).toBe('AVAILABLE');
    expect(swapped.allocatedSlot.status).toBe('ALLOCATED');
    expect(swapped.allocatedSlot.allocatedUnitId).toBe(unit1.id);
  });
});
