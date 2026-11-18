import { describe, expect, it } from 'vitest';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService, createTowerService } from '../../functions/src/projects';
import { createUnitService } from '../../functions/src/inventory';
import {
  createQuotationService,
  ensureBaselinePaymentPlanForProject,
} from '../../functions/src/quotations';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';
import type { AuthenticatedActor } from '../../functions/src/shared/auth-guard';

const ADMIN: AuthenticatedActor = {
  uid: 'builder_admin_unique',
  email: 'admin@builder.com',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Tower Name Uniqueness & Resilient Cost Sheet Generation', () => {
  it('strictly rejects duplicate tower names within the same project (case-insensitive)', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'Uniqueness Infra',
      legalName: 'Uniqueness Infra Pvt Ltd',
      headquartersCity: 'Hyderabad',
    });

    const project = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Uniqueness Infra',
      name: 'Emerald Heights',
      code: 'EH',
      city: 'Hyderabad',
      locality: 'Gachibowli',
      address: 'Financial District, Gachibowli',
      reraNumber: 'P02400001234',
      projectType: 'APARTMENT',
      configurations: ['2 BHK', '3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    // 1. Create Tower 1 successfully
    const t1 = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower 1',
      code: 'T1',
      towerType: 'TOWER',
      totalFloors: 10,
    });
    expect(t1.name).toBe('Tower 1');

    // 2. Attempt to create another tower named 'Tower 1' (exact match)
    await expect(
      createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: organization.id,
        projectId: project.id,
        name: 'Tower 1',
        code: 'T2',
        towerType: 'TOWER',
        totalFloors: 10,
      })
    ).rejects.toThrow(/already exists/i);

    // 3. Attempt to create 'tower 1' with different casing
    await expect(
      createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: organization.id,
        projectId: project.id,
        name: 'tower 1',
        code: 'T3',
        towerType: 'TOWER',
        totalFloors: 10,
      })
    ).rejects.toThrow(/already exists/i);

    // 4. Attempt to create with duplicate code 'T1'
    await expect(
      createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: organization.id,
        projectId: project.id,
        name: 'Tower 2',
        code: 'T1',
        towerType: 'TOWER',
        totalFloors: 10,
      })
    ).rejects.toThrow(/already exists/i);

    // 5. Tower 2 with distinct name and code succeeds
    const t2 = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower 2',
      code: 'T2',
      towerType: 'TOWER',
      totalFloors: 10,
    });
    expect(t2.name).toBe('Tower 2');
  });

  it('allows same tower name in a different project', async () => {
    const db = createTransactionalTestFirestore();
    const { organization: org1 } = await createOrganizationService(db, ADMIN, {
      name: 'Uniqueness Infra 1',
      legalName: 'Uniqueness Infra 1 Pvt Ltd',
      headquartersCity: 'Hyderabad',
    });

    const { organization: org2 } = await createOrganizationService(db, ADMIN, {
      name: 'Uniqueness Infra 2',
      legalName: 'Uniqueness Infra 2 Pvt Ltd',
      headquartersCity: 'Hyderabad',
    });

    const project1 = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org1.id,
      builderName: 'Uniqueness Infra 1',
      name: 'Project One',
      code: 'P1',
      city: 'Hyderabad',
      locality: 'Hitech City',
      address: 'Hitech City',
      reraNumber: 'P02400001235',
      projectType: 'APARTMENT',
      configurations: ['2 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const project2 = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org2.id,
      builderName: 'Uniqueness Infra 2',
      name: 'Project Two',
      code: 'P2',
      city: 'Hyderabad',
      locality: 'Madhapur',
      address: 'Madhapur',
      reraNumber: 'P02400001236',
      projectType: 'APARTMENT',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    // Create Tower 1 in Project 1
    await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org1.id,
      projectId: project1.id,
      name: 'Tower 1',
      code: 'T1',
      towerType: 'TOWER',
      totalFloors: 10,
    });

    // Create Tower 1 in Project 2 should succeed
    const tInP2 = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org2.id,
      projectId: project2.id,
      name: 'Tower 1',
      code: 'T1',
      towerType: 'TOWER',
      totalFloors: 15,
    });
    expect(tInP2.projectId).toBe(project2.id);
    expect(tInP2.name).toBe('Tower 1');
  });

  it('seamlessly generates cost sheet when no payment plan or price book is pre-configured', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'CostSheet Test Infra',
      legalName: 'CostSheet Test Infra Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'CostSheet Test Infra',
      name: 'Greenfield Residency',
      code: 'GFR',
      city: 'Bengaluru',
      locality: 'Sarjapur',
      address: 'Sarjapur Main Road',
      reraNumber: 'PRM/KA/RERA/1251/446/PR/230101/007890',
      projectType: 'APARTMENT',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const tower = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Tower A',
      code: 'TA',
      towerType: 'TOWER',
      totalFloors: 8,
    });

    const unit = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      towerId: tower.id,
      unitNumber: 'A-201',
      series: '01',
      floorNumber: 2,
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1850,
      carpetAreaSqft: 1295,
      facing: 'EAST',
      baseRatePerSqft: 8800,
      parkingEntitlementCount: 1,
    });

    // Generating quotation with paymentPlanId and priceBookId left as 'default'
    const result = await createQuotationService(
      db,
      ADMIN,
      'Sales Executive',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unit.id,
        priceBookId: 'default',
        paymentPlanId: 'default',
        customer: {
          name: 'Ramesh Sharma',
          phone: '+91 9876543210',
          email: 'ramesh.sharma@example.com',
        },
        discount: {
          type: 'NONE',
          value: 0,
        },
        validDays: 15,
        termsAndConditions:
          '1. Quotation valid for 15 days subject to unit availability. 2. Stamp duty and registration extra.',
      }
    );

    expect(result.quotation).toBeDefined();
    expect(result.quotation.unitNumber).toBe('A-201');
    expect(result.quotation.totalPayableInr).toBeGreaterThan(0);
    expect(result.pdfBytes.length).toBeGreaterThan(1000);

    // Verify that baseline payment plan was auto-provisioned
    const plan = await ensureBaselinePaymentPlanForProject(db, {
      orgId: organization.id,
      projectId: project.id,
      actorUid: ADMIN.uid,
    });
    expect(plan.name).toContain('Construction Linked Plan');
    expect(plan.milestones.length).toBe(5);
    expect(plan.totalPercentage).toBe(100);
  });
});
