import { describe, expect, it } from 'vitest';
import { createOrganizationService } from '../../functions/src/organizations';
import { superAdminUpdateTenantService } from '../../functions/src/organizations/super-admin';
import { createProjectService } from '../../functions/src/projects';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const SUPER_ADMIN = {
  uid: 'uid-super-admin-prateek',
  email: 'prateek.parts@gmail.com',
  isSuperAdmin: true,
  mfaVerified: true,
};

describe('Phase 10 — Super Admin Governance, SaaS Billing Entitlements & Audit Trails', () => {
  it('enforces SINGLE_PROJECT 1-project hard limit until Super Admin provisions MULTI_PROJECT slots, and logs PLATFORM audit events', async () => {
    const db = createTransactionalTestFirestore();
    const founder = { uid: 'uid-f', email: 'f@b.in', isSuperAdmin: false, mfaVerified: true };

    const { organization } = await createOrganizationService(db, founder, {
      name: 'Boutique Homes',
      legalName: 'Boutique Homes Pvt Ltd',
      headquartersCity: 'Goa',
    });

    // SINGLE_PROJECT allows strictly 1 active project
    await createProjectService(db, founder, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Boutique Homes',
      name: 'Villa Project 1',
      code: 'VP1',
      city: 'Goa',
      locality: 'Assagao',
      address: 'Assagao, Goa',
      projectType: 'VILLA',
      reraNumber: 'GOA-RERA-1',
      configurations: ['4 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    // 2nd project blocked on SINGLE_PROJECT package
    await expect(
      createProjectService(db, founder, 'BUILDER_ADMIN', {
        orgId: organization.id,
        builderName: 'Boutique Homes',
        name: 'Villa Project 2',
        code: 'VP2',
        city: 'Goa',
        locality: 'Siolim',
        address: 'Siolim, Goa',
        projectType: 'VILLA',
        reraNumber: 'GOA-RERA-2',
        configurations: ['4 BHK'],
        constructionStatus: 'NEW_LAUNCH',
      })
    ).rejects.toThrow(/Project limit reached/);

    // Super Admin upgrades tenant to MULTI_PROJECT (5 project slots)
    const upgraded = await superAdminUpdateTenantService(db, SUPER_ADMIN, {
      orgId: organization.id,
      planCode: 'MULTI_PROJECT',
      subscribedProjectCapacity: 5,
      aiBalanceCreditPaise: 500000,
      reason: 'Multi-Project 5-slot subscription activated',
    });
    expect(upgraded.organization.subscriptionPlanId).toBe('MULTI_PROJECT');
    expect(upgraded.entitlements?.subscribedProjectCapacity).toBe(5);

    // Now 2nd & 3rd projects succeed!
    await createProjectService(db, founder, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Boutique Homes',
      name: 'Villa Project 2',
      code: 'VP2',
      city: 'Goa',
      locality: 'Siolim',
      address: 'Siolim, Goa',
      projectType: 'VILLA',
      reraNumber: 'GOA-RERA-2',
      configurations: ['4 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    const p3 = await createProjectService(db, founder, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Boutique Homes',
      name: 'Villa Project 3',
      code: 'VP3',
      city: 'Goa',
      locality: 'Anjuna',
      address: 'Anjuna, Goa',
      projectType: 'VILLA',
      reraNumber: 'GOA-RERA-3',
      configurations: ['4 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });
    expect(p3.code).toBe('VP3');

    // Verify PLATFORM audit record exists with actor & before/after snapshots
    const platformAudits = await db
      .collection('audit_events')
      .where('orgId', '==', 'PLATFORM')
      .get();
    expect(platformAudits.size).toBe(1);
    expect(platformAudits.docs[0]?.data().actorEmail).toBe('prateek.parts@gmail.com');
  });
});
