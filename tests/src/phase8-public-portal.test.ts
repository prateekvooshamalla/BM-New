import { describe, expect, it } from 'vitest';
import { BRAND_CONFIG } from '@bharat-makaan/config';
import { buildSitemapXml, STATIC_PUBLIC_ROUTES } from '../../scripts/generate-sitemap';
import { createOrganizationService, superAdminUpdateTenantService } from '../../functions/src/organizations';
import { createProjectService } from '../../functions/src/projects';
import { createUnitService } from '../../functions/src/inventory';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

describe('Phase 8 — Public Property Portal: Publication Visibility & SEO Sitemap', () => {
  it('verifies exact hero copy, crawlable sitemap routes, and strict isPublicPublished filtering', async () => {
    expect(BRAND_CONFIG.heroHeadline).toBe(
      'Find Your Next Property. Manage Real Estate with AI.'
    );
    const xml = buildSitemapXml('https://bharatmakaan.com', ['/projects/proj-123']);
    expect(STATIC_PUBLIC_ROUTES.length).toBeGreaterThanOrEqual(12);
    expect(xml).toContain('<loc>https://bharatmakaan.com/compare</loc>');
    expect(xml).toContain('<loc>https://bharatmakaan.com/projects/proj-123</loc>');

    const db = createTransactionalTestFirestore();
    const actor = { uid: 'u-1', email: 'a@b.in', isSuperAdmin: false, mfaVerified: true };
    const { organization } = await createOrganizationService(db, actor, {
      name: 'Public Test Builder',
      legalName: 'Public Test Builder Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    await superAdminUpdateTenantService(
      db,
      { uid: 'uid-sa', email: 'prateek.parts@gmail.com', isSuperAdmin: true, mfaVerified: true },
      {
        orgId: organization.id,
        planCode: 'MULTI_PROJECT',
        subscribedProjectCapacity: 2,
        reason: 'Provision 2 project slots for public vs private visibility test',
      }
    );

    const pPrivate = await createProjectService(db, actor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Public Test Builder',
      name: 'Internal Pre-Launch',
      code: 'IPL',
      city: 'Bengaluru',
      locality: 'Yelahanka',
      address: 'Yelahanka, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'RERA-PRIV',
      configurations: ['2 BHK'],
      constructionStatus: 'PRE_LAUNCH',
      isPublicPublished: false,
    });

    const pPublic = await createProjectService(db, actor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Public Test Builder',
      name: 'Published Grand Vista',
      code: 'PGV',
      city: 'Bengaluru',
      locality: 'Whitefield',
      address: 'Whitefield, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'RERA-PUB',
      configurations: ['3 BHK'],
      constructionStatus: 'NEW_LAUNCH',
      isPublicPublished: true,
    });

    await createUnitService(db, actor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: pPrivate.id,
      unitNumber: 'PRIV-101',
      unitType: 'APARTMENT',
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      facing: 'EAST',
      baseRatePerSqft: 7500,
      isPublicPublished: false,
    });

    await createUnitService(db, actor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: pPublic.id,
      unitNumber: 'PUB-301',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1900,
      carpetAreaSqft: 1330,
      facing: 'EAST',
      baseRatePerSqft: 9500,
      isPublicPublished: true,
    });

    const pubProjects = await db
      .collection('projects')
      .where('isPublicPublished', '==', true)
      .get();
    const pubUnits = await db
      .collection('units')
      .where('isPublicPublished', '==', true)
      .get();

    expect(pubProjects.size).toBe(1);
    expect(pubProjects.docs[0]?.data().name).toBe('Published Grand Vista');
    expect(pubUnits.size).toBe(1);
    expect(pubUnits.docs[0]?.data().unitNumber).toBe('PUB-301');
  });
});
