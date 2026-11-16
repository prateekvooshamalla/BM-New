import { describe, expect, it } from 'vitest';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';
import {
  createOrganizationService,
  getOrganizationCollectionSnapshotService,
  inviteStaffMemberService,
} from '../../functions/src/organizations';
import { syncMySessionMembershipsService } from '../../functions/src/auth';
import {
  createPhaseService,
  createProjectService,
  createTowerService,
} from '../../functions/src/projects';
import { createUnitService } from '../../functions/src/inventory';
import { ingestLeadService } from '../../functions/src/leads';
import { scheduleSiteVisitService } from '../../functions/src/notifications';

describe('Backend-to-Frontend Data Retrieval & Tenant Snapshot Sync', () => {
  it('hydrates projects/entitlements on session sync and retrieves persisted inventory, CRM, and project-scoped records cleanly', async () => {
    const db = createTransactionalTestFirestore();

    const adminActor = {
      uid: 'builder_owner_1',
      email: 'owner@skylinebuilders.in',
      emailVerified: true,
      isSuperAdmin: false,
      mfaVerified: true,
    };

    const { organization, membership } = await createOrganizationService(db, adminActor, {
      name: 'Skyline Builders Pvt Ltd',
      legalName: 'Skyline Builders Private Limited',
      organizationType: 'BUILDER',
      reraNumber: 'PRM/KA/RERA/1251/446/AG/240101',
      gstin: '29AABCS1429B1Z1',
      headquartersCity: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      defaultCurrency: 'INR',
      defaultAreaUnit: 'SQFT',
      contactEmail: 'owner@skylinebuilders.in',
      contactPhone: '+919880011223',
      planCode: 'MULTI_PROJECT',
      subscribedProjectCapacity: 2,
    });

    // Activate subscription entitlements so projects & operations can be created in backend
    await db.collection('entitlements').doc(organization.id).update({
      subscriptionStatus: 'ACTIVE',
      subscribedProjectCapacity: 2,
    });

    const projectA = await createProjectService(db, adminActor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      name: 'Skyline Crest',
      code: 'SKYCREST',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/1251/446/PR/240101/006001',
      builderName: organization.name,
      city: 'Bengaluru',
      locality: 'Whitefield',
      address: 'ITPL Main Road, Whitefield',
      constructionStatus: 'UNDER_CONSTRUCTION',
      configurations: ['3 BHK'],
      amenities: ['Clubhouse'],
      isPublicPublished: true,
    });

    const projectB = await createProjectService(db, adminActor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      name: 'Skyline Enclave',
      code: 'SKYENC',
      projectType: 'VILLA',
      reraNumber: 'PRM/KA/RERA/1251/446/PR/240101/006002',
      builderName: organization.name,
      city: 'Bengaluru',
      locality: 'Sarjapur Road',
      address: 'Sarjapur Main Road',
      constructionStatus: 'NEW_LAUNCH',
      configurations: ['4 BHK'],
      amenities: ['Pool'],
      isPublicPublished: false,
    });

    const phase = await createPhaseService(db, adminActor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: projectA.id,
      name: 'Phase 1',
      code: 'PH1',
      sequence: 1,
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const tower = await createTowerService(db, adminActor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: projectA.id,
      phaseId: phase.id,
      name: 'Tower Alpha',
      code: 'TA',
      towerType: 'TOWER',
      totalFloors: 10,
      basementLevels: 1,
      podiumLevels: 0,
      unitsPerFloorTypical: 4,
    });

    const unit = await createUnitService(db, adminActor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: projectA.id,
      phaseId: phase.id,
      towerId: tower.id,
      floorNumber: 3,
      unitNumber: 'TA-301',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      facing: 'EAST',
      carpetAreaSqft: 1240,
      saleableAreaSqft: 1720,
      parkingEntitlementCount: 2,
      baseRatePerSqft: 8500,
      isPublicPublished: true,
    });

    const { lead } = await ingestLeadService(db, adminActor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      preferredProjectIds: [projectA.id],
      customerName: 'Aarav Kulkarni',
      phone: '+919900112233',
      email: 'aarav@example.com',
      source: 'WEBSITE',
    });

    await scheduleSiteVisitService(db, adminActor, {
      orgId: organization.id,
      projectId: projectA.id,
      leadId: lead.id,
      customerName: 'Aarav Kulkarni',
      customerPhone: '+919900112233',
      scheduledStartAt: '2026-12-01T10:00:00.000Z',
      scheduledEndAt: '2026-12-01T11:00:00.000Z',
      timezone: 'Asia/Kolkata',
    });

    // 1. Session hydration immediately returns persisted projects & entitlements by org
    const sessionPayload = await syncMySessionMembershipsService(db, adminActor, {
      email: adminActor.email,
      emailVerified: true,
      mfaEnrolledCount: 1,
    });

    expect(sessionPayload.organizations).toHaveLength(1);
    expect(sessionPayload.projectsByOrg[organization.id]).toHaveLength(2);
    expect(
      sessionPayload.projectsByOrg[organization.id]?.map((p) => p.name).sort()
    ).toEqual(['Skyline Crest', 'Skyline Enclave']);
    expect(sessionPayload.entitlementsByOrg[organization.id]?.subscribedProjectCapacity).toBe(2);

    // 2. Snapshot reader returns all persisted records for Builder Admin across collections
    const [projectsSnap, phasesSnap, towersSnap, unitsSnap, leadsSnap, visitsSnap, subSnap] =
      await Promise.all([
        getOrganizationCollectionSnapshotService(db, adminActor, membership, {
          orgId: organization.id,
          collectionName: 'projects',
          authorizedPermission: 'projects:view',
        }),
        getOrganizationCollectionSnapshotService(db, adminActor, membership, {
          orgId: organization.id,
          collectionName: 'project_phases',
          projectId: projectA.id,
          authorizedPermission: 'projects:view',
        }),
        getOrganizationCollectionSnapshotService(db, adminActor, membership, {
          orgId: organization.id,
          collectionName: 'towers',
          projectId: projectA.id,
          authorizedPermission: 'projects:view',
        }),
        getOrganizationCollectionSnapshotService(db, adminActor, membership, {
          orgId: organization.id,
          collectionName: 'units',
          projectId: projectA.id,
          authorizedPermission: 'inventory:view',
        }),
        getOrganizationCollectionSnapshotService(db, adminActor, membership, {
          orgId: organization.id,
          collectionName: 'leads',
          authorizedPermission: 'leads:view_all',
        }),
        getOrganizationCollectionSnapshotService(db, adminActor, membership, {
          orgId: organization.id,
          collectionName: 'site_visits',
          authorizedPermission: 'visits:view',
        }),
        getOrganizationCollectionSnapshotService(db, adminActor, membership, {
          orgId: organization.id,
          collectionName: 'subscriptions',
          authorizedPermission: 'billing:view',
        }),
      ]);

    expect(projectsSnap.items).toHaveLength(2);
    expect(projectsSnap.items.some((p) => p.id === projectB.id)).toBe(true);
    expect(phasesSnap.items).toHaveLength(1);
    expect(towersSnap.items).toHaveLength(1);
    expect(unitsSnap.items).toHaveLength(1);
    expect(unitsSnap.items[0]?.id).toBe(unit.id);
    expect(unitsSnap.items[0]?.unitNumber).toBe('TA-301');
    expect(leadsSnap.items).toHaveLength(1);
    expect(leadsSnap.items[0]?.customerName).toBe('Aarav Kulkarni');
    expect(visitsSnap.items).toHaveLength(1);
    expect(subSnap.items).toHaveLength(1);

    // 3. Project-scoped employee only receives records for assigned project (`projectA`)
    const scopedMember = await inviteStaffMemberService(
      db,
      adminActor,
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        email: 'exec@skylinebuilders.in',
        displayName: 'Project A Executive',
        role: 'SALES_EXECUTIVE',
        permissions: ['dashboard:view', 'projects:view', 'inventory:view', 'leads:view'],
        assignedProjectIds: [projectA.id],
      },
      'exec_uid_1'
    );

    const scopedProjects = await getOrganizationCollectionSnapshotService(
      db,
      {
        uid: 'exec_uid_1',
        email: 'exec@skylinebuilders.in',
        emailVerified: true,
        isSuperAdmin: false,
        mfaVerified: false,
      },
      scopedMember,
      {
        orgId: organization.id,
        collectionName: 'projects',
        authorizedPermission: 'projects:view',
      }
    );

    expect(scopedProjects.items).toHaveLength(1);
    expect(scopedProjects.items[0]?.id).toBe(projectA.id);
  });
});
