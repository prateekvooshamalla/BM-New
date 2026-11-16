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
  it('enforces Starter maxProjects limit until Super Admin provisions Enterprise custom entitlements, and logs PLATFORM audit events', async () => {
    const db = createTransactionalTestFirestore();
    const founder = { uid: 'uid-f', email: 'f@b.in', isSuperAdmin: false, mfaVerified: true };

    const { organization } = await createOrganizationService(db, founder, {
      name: ' boutique Homes',
      legalName: 'Boutique Homes Pvt Ltd',
      headquartersCity: 'Goa',
    });

    // Starter allows max 2 projects
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

    // 3rd project blocked on STARTER plan
    await expect(
      createProjectService(db, founder, 'BUILDER_ADMIN', {
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
      })
    ).rejects.toThrow(/Project limit reached/);

    // Super Admin upgrades tenant to ENTERPRISE (-1 unlimited projects)
    const upgraded = await superAdminUpdateTenantService(db, SUPER_ADMIN, {
      orgId: organization.id,
      planCode: 'ENTERPRISE',
      customMaxProjects: -1,
      customMaxUsers: -1,
      customAiCredits: 50000,
      reason: 'Enterprise contract signed',
    });
    expect(upgraded.organization.subscriptionPlanId).toBe('ENTERPRISE');

    // Now 3rd project succeeds!
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
