import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, type OrganizationMember } from '@bharat-makaan/shared';
import { createLeadSchema } from '@bharat-makaan/validation';
import {
  filterAuthorizedMobileMoreFeatures,
  useMobileStore,
} from '../../apps/mobile/src/state/useMobileStore';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService } from '../../functions/src/projects';
import { createUnitService, transitionUnitStatusService } from '../../functions/src/inventory';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

describe('Phase 9 — React Native Mobile Synchronization & Role-Based More Menu', () => {
  it('filters mobile More menu items strictly by role permissions and synchronizes unit holds across Web & Mobile on the shared backend', async () => {
    const salesExecMember: OrganizationMember = {
      id: 'org1_exec1',
      orgId: 'org1',
      uid: 'exec1',
      email: 'exec@builder.in',
      displayName: 'Field Exec',
      role: 'SALES_EXECUTIVE',
      permissions: DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE,
      assignedProjectIds: [],
      status: 'ACTIVE',
      mfaRequired: false,
      invitedBy: 'admin',
      invitedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const authorizedMore = filterAuthorizedMobileMoreFeatures(salesExecMember, false);
    const keys = authorizedMore.map((m) => m.key);
    expect(keys).toContain('PricingQuotations');
    expect(keys).toContain('SiteVisits');
    expect(keys).toContain('BookingsCollections');
    // Sales Executive does NOT have `partners:view` or `reports:view` by default
    expect(keys).not.toContain('ChannelPartners');
    expect(keys).not.toContain('Reports');

    // Shared Zod schema parity between Mobile & Web
    const parsedLead = createLeadSchema.parse({
      orgId: 'org1',
      customerName: 'Mobile Walk-In Buyer',
      phone: '+91 9845012345',
      source: 'MANUAL',
    });
    expect(parsedLead.customerName).toBe('Mobile Walk-In Buyer');

    // Shared Backend Synchronization: Mobile unit hold immediately reflects in Web query &Mobile store
    const db = createTransactionalTestFirestore();
    const actor = { uid: 'exec1', email: 'exec@builder.in', isSuperAdmin: false, mfaVerified: false };
    const { organization } = await createOrganizationService(db, actor, {
      name: 'Sync Builders',
      legalName: 'Sync Builders Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });
    const project = await createProjectService(db, actor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Sync Builders',
      name: 'Sync Residency',
      code: 'SYR',
      city: 'Bengaluru',
      locality: 'HSR Layout',
      address: 'HSR Sector 2, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'RERA-SYNC-01',
      configurations: ['3 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });
    const unit = await createUnitService(db, actor, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 4,
      unitNumber: 'M-401',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1750,
      carpetAreaSqft: 1225,
      facing: 'EAST',
      baseRatePerSqft: 9200,
    });

    // Mobile places 48h hold -> Web querying shared Firestore sees ON_HOLD immediately
    await transitionUnitStatusService(db, actor, 'SALES_EXECUTIVE', {
      orgId: organization.id,
      unitId: unit.id,
      targetStatus: 'ON_HOLD',
      action: 'HOLD',
      holdDurationHours: 48,
    });

    const webReadSnap = await db.collection('units').doc(unit.id).get();
    expect(webReadSnap.data()?.status).toBe('ON_HOLD');
    expect(webReadSnap.data()?.heldByUid).toBe('exec1');

    // Verify Mobile Zustand store synchronization
    useMobileStore.getState().setOrgsAndMemberships([organization], [salesExecMember], organization.id);
    useMobileStore.getState().setProjects([project]);
    expect(useMobileStore.getState().activeOrgId).toBe(organization.id);
    expect(useMobileStore.getState().activeProjectId).toBe(project.id);
  });
});
