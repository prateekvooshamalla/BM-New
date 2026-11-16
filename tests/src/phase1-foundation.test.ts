import { describe, expect, it } from 'vitest';
import {
  BRAND_CONFIG,
  DEFAULT_SAAS_PLANS,
  MOBILE_BOTTOM_TABS,
  PRIMARY_WEB_NAVIGATION,
} from '@bharat-makaan/config';
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  ROLES,
} from '@bharat-makaan/shared';
import {
  createOrganizationService,
  inviteStaffMemberService,
  transferEmployeeLeadsService,
  updateMemberAccessService,
} from '../../functions/src/organizations';
import { validateStrongSuperAdminPassword } from '../../scripts/provision-super-admin';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

describe('Phase 1 — Foundation: Navigation, Config, Orgs, Staff Invitations & RBAC', () => {
  it('enforces strictly 12 non-duplicated web navigation items and 5 mobile bottom tabs', () => {
    expect(PRIMARY_WEB_NAVIGATION).toHaveLength(12);
    const uniquePaths = new Set(PRIMARY_WEB_NAVIGATION.map((n) => n.path));
    const uniqueLabels = new Set(PRIMARY_WEB_NAVIGATION.map((n) => n.label));
    expect(uniquePaths.size).toBe(12);
    expect(uniqueLabels.size).toBe(12);
    expect(MOBILE_BOTTOM_TABS.map((t) => t.label)).toEqual([
      'Dashboard',
      'Inventory',
      'Leads',
      'Inbox',
      'More',
    ]);
  });

  it('defines all 13 enterprise roles and SaaS subscription tiers', () => {
    expect(ROLES).toHaveLength(13);
    expect(DEFAULT_SAAS_PLANS.STARTER.monthlyPriceInr).toBe(2999);
    expect(DEFAULT_SAAS_PLANS.GROWTH.monthlyPriceInr).toBe(9999);
    expect(DEFAULT_SAAS_PLANS.BUILDER_PRO.monthlyPriceInr).toBe(24999);
    expect(DEFAULT_SAAS_PLANS.ENTERPRISE.isCustomPricing).toBe(true);
    expect(BRAND_CONFIG.initialSuperAdminEmail).toBe('prateek.parts@gmail.com');
  });

  it('rejects weak Super Admin passwords and accepts strong passwords', () => {
    expect(validateStrongSuperAdminPassword('admin123').valid).toBe(false);
    expect(validateStrongSuperAdminPassword('Short1!').valid).toBe(false);
    expect(validateStrongSuperAdminPassword('Strong#Enterprise99!BM').valid).toBe(true);
  });

  it('creates isolated builder organization with membership, subscription & audit record', async () => {
    const db = createTransactionalTestFirestore();
    const res = await createOrganizationService(
      db,
      { uid: 'uid-founder-1', email: 'founder@skyline.in', isSuperAdmin: false, mfaVerified: true },
      {
        name: 'Skyline Developers',
        legalName: 'Skyline Developers India Pvt Ltd',
        headquartersCity: 'Bengaluru',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        leadProtectionDays: 45,
      },
      'Rohan Mehta'
    );

    expect(res.organization.name).toBe('Skyline Developers');
    expect(res.organization.whatsappAutoSendAi).toBe(false);
    expect(res.organization.leadProtectionDays).toBe(45);
    expect(res.membership.role).toBe('BUILDER_ADMIN');
    expect(res.membership.mfaRequired).toBe(true);
    expect(res.subscription.planCode).toBe('STARTER');

    const auditSnap = await db
      .collection('audit_events')
      .where('orgId', '==', res.organization.id)
      .get();
    expect(auditSnap.size).toBe(1);
    expect(auditSnap.docs[0]?.data().action).toBe('ORGANIZATION_CREATED');
  });

  it('invites staff, enforces granular permissions & project scope, suspends access, and transfers leads', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(
      db,
      { uid: 'uid-admin', email: 'admin@builder.in', isSuperAdmin: false, mfaVerified: true },
      {
        name: 'Apex Builders',
        legalName: 'Apex Builders LLP',
        headquartersCity: 'Hyderabad',
      }
    );

    const salesExec = await inviteStaffMemberService(
      db,
      { uid: 'uid-admin', email: 'admin@builder.in', isSuperAdmin: false, mfaVerified: true },
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        email: 'exec1@builder.in',
        displayName: 'Priya Nair',
        role: 'SALES_EXECUTIVE',
        permissions: DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE,
        assignedProjectIds: ['proj-a'],
        department: 'Residential Sales',
      },
      'uid-exec-1'
    );

    const salesExec2 = await inviteStaffMemberService(
      db,
      { uid: 'uid-admin', email: 'admin@builder.in', isSuperAdmin: false, mfaVerified: true },
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        email: 'exec2@builder.in',
        displayName: 'Vikram Rao',
        role: 'SALES_EXECUTIVE',
        permissions: DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE,
        assignedProjectIds: ['proj-a', 'proj-b'],
        department: 'Residential Sales',
      },
      'uid-exec-2'
    );

    // Granular permission & project scope checks
    expect(hasPermission(salesExec, 'inventory:hold', 'proj-a')).toBe(true);
    expect(hasPermission(salesExec, 'inventory:hold', 'proj-b')).toBe(false);
    expect(hasPermission(salesExec, 'pricing:approve', 'proj-a')).toBe(false);

    // Seed a real test lead inside isolated test store & transfer it
    await db.collection('leads').doc('lead-1').set({
      id: 'lead-1',
      orgId: organization.id,
      customerName: 'Karan Kapoor',
      assignedAgentUid: salesExec.uid,
      preferredProjectIds: ['proj-a'],
    });

    const transferRes = await transferEmployeeLeadsService(
      db,
      { uid: 'uid-admin', email: 'admin@builder.in', isSuperAdmin: false, mfaVerified: true },
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        fromAgentUid: salesExec.uid,
        toAgentUid: salesExec2.uid,
        reason: 'Employee moving to new branch',
      }
    );
    expect(transferRes.transferredCount).toBe(1);

    const updatedLead = await db.collection('leads').doc('lead-1').get();
    expect(updatedLead.data()?.assignedAgentUid).toBe('uid-exec-2');

    // Suspend outgoing employee
    const suspended = await updateMemberAccessService(
      db,
      { uid: 'uid-admin', email: 'admin@builder.in', isSuperAdmin: false, mfaVerified: true },
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        targetUid: salesExec.uid,
        status: 'SUSPENDED',
      }
    );
    expect(suspended.status).toBe('SUSPENDED');
    expect(hasPermission(suspended, 'inventory:hold', 'proj-a')).toBe(false);
  });
});
