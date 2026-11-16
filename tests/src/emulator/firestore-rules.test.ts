import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

let testEnv: RulesTestEnvironment;

describe('Firebase Emulator — Multi-Tenant & AI Assistant Firestore Security Rules Verification', () => {
  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firebase/firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    const [emuHost, emuPort] = (
      process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
    ).split(':');

    testEnv = await initializeTestEnvironment({
      projectId: 'bharat-makaan-rules-test',
      firestore: {
        rules,
        host: emuHost || '127.0.0.1',
        port: Number(emuPort || 8080),
      },
    });

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();

      await db.collection('organizations').doc('orgA').set({
        id: 'orgA',
        name: 'Builder Org A',
        status: 'ACTIVE',
      });

      await db.collection('organizations').doc('orgB').set({
        id: 'orgB',
        name: 'Builder Org B',
        status: 'ACTIVE',
      });

      await db.collection('organization_members').doc('orgA_userA').set({
        id: 'orgA_userA',
        orgId: 'orgA',
        uid: 'userA',
        role: 'SALES_MANAGER',
        status: 'ACTIVE',
        permissions: ['projects:view', 'inventory:view', 'leads:view_all', 'audit:view'],
        assignedProjectIds: [],
      });

      // Project-scoped staff member restricted strictly to `projA_private`
      await db.collection('organization_members').doc('orgA_scopedExec').set({
        id: 'orgA_scopedExec',
        orgId: 'orgA',
        uid: 'scopedExec',
        role: 'SALES_EXECUTIVE',
        status: 'ACTIVE',
        permissions: ['projects:view', 'inventory:view'],
        assignedProjectIds: ['projA_private'],
      });

      await db.collection('projects').doc('projA_private').set({
        id: 'projA_private',
        orgId: 'orgA',
        name: 'Org A Private Project 1',
        isPublicPublished: false,
      });

      await db.collection('projects').doc('projA_secret_2').set({
        id: 'projA_secret_2',
        orgId: 'orgA',
        name: 'Org A Restricted Project 2',
        isPublicPublished: false,
      });

      await db.collection('projects').doc('projB_private').set({
        id: 'projB_private',
        orgId: 'orgB',
        name: 'Org B Confidential Project',
        isPublicPublished: false,
      });

      await db.collection('projects').doc('projB_public').set({
        id: 'projB_public',
        orgId: 'orgB',
        name: 'Org B Published Portal Project',
        isPublicPublished: true,
      });

      // AI Sessions, Drafts & Import Jobs
      await db.collection('ai_sessions').doc('sess_userA').set({
        id: 'sess_userA',
        orgId: 'orgA',
        projectId: 'projA_private',
        uid: 'userA',
        status: 'ACTIVE',
      });

      await db.collection('ai_sessions').doc('sess_scopedExec').set({
        id: 'sess_scopedExec',
        orgId: 'orgA',
        projectId: 'projA_private',
        uid: 'scopedExec',
        status: 'ACTIVE',
      });

      await db.collection('ai_inventory_drafts').doc('draft_projA1').set({
        id: 'draft_projA1',
        orgId: 'orgA',
        projectId: 'projA_private',
        status: 'READY_FOR_REVIEW',
      });

      await db.collection('ai_inventory_drafts').doc('draft_projA2').set({
        id: 'draft_projA2',
        orgId: 'orgA',
        projectId: 'projA_secret_2',
        status: 'READY_FOR_REVIEW',
      });

      await db.collection('ai_import_jobs').doc('job_projA1').set({
        id: 'job_projA1',
        orgId: 'orgA',
        projectId: 'projA_private',
        status: 'COMPLETED',
      });

      await db.collection('ai_import_jobs').doc('job_projA2').set({
        id: 'job_projA2',
        orgId: 'orgA',
        projectId: 'projA_secret_2',
        status: 'COMPLETED',
      });

      await db.collection('leads').doc('lead_pii_1').set({
        id: 'lead_pii_1',
        orgId: 'orgA',
        projectId: 'projA_private',
        customerName: 'Confidential Buyer',
      });

      await db.collection('audit_events').doc('audit_1').set({
        id: 'audit_1',
        orgId: 'orgA',
        action: 'PRICE_BOOK_ACTIVATED',
      });

      await db.collection('_integration_secrets').doc('sec_1').set({
        apiKey: 'TOP_SECRET',
      });

      // Billing, Wallets, Partner Org & Customer Saved Properties
      await db.collection('organization_members').doc('orgA_billingAdminA').set({
        id: 'orgA_billingAdminA',
        orgId: 'orgA',
        uid: 'billingAdminA',
        role: 'BUILDER_ADMIN',
        status: 'ACTIVE',
        permissions: ['billing:view', 'partners:view', 'dashboard:view'],
        assignedProjectIds: [],
      });

      await db.collection('organization_members').doc('orgB_userB').set({
        id: 'orgB_userB',
        orgId: 'orgB',
        uid: 'userB',
        role: 'BUILDER_ADMIN',
        status: 'ACTIVE',
        permissions: ['billing:view', 'partners:view', 'dashboard:view'],
        assignedProjectIds: [],
      });

      await db.collection('partner_organizations').doc('partnerOrg1').set({
        id: 'partnerOrg1',
        companyName: 'Verified Agency 1',
        status: 'ACTIVE',
        authorizedOrgIds: ['orgA'],
      });

      await db.collection('partner_members').doc('partnerOrg1_partnerUser1').set({
        id: 'partnerOrg1_partnerUser1',
        partnerOrgId: 'partnerOrg1',
        uid: 'partnerUser1',
        status: 'ACTIVE',
      });

      await db.collection('entitlements').doc('orgA').set({
        id: 'orgA',
        orgId: 'orgA',
        packageCode: 'SINGLE_PROJECT',
        subscribedProjectCapacity: 1,
        aiBalancePaise: 50000,
        whatsappBalancePaise: 25000,
      });

      await db.collection('payments').doc('pay_orgA_1').set({
        id: 'pay_orgA_1',
        orgId: 'orgA',
        amountPaise: 707900,
        status: 'CAPTURED',
      });

      await db.collection('usage_ledger').doc('led_orgA_1').set({
        id: 'led_orgA_1',
        orgId: 'orgA',
        walletType: 'AI',
        entryType: 'USAGE_DEBIT',
        amountPaise: 25,
      });

      await db.collection('credit_topups').doc('topup_orgA_1').set({
        id: 'topup_orgA_1',
        orgId: 'orgA',
        walletType: 'AI',
        status: 'PAID',
      });

      await db.collection('customer_saved_properties').doc('customer1_unit1').set({
        id: 'customer1_unit1',
        uid: 'customer1',
        unitId: 'unit1',
        projectId: 'projB_public',
        orgId: 'orgB',
      });

      // Documents with omitted optional fields (no `partnerOrgId`, no `isPublicPublished`, no `projectId`)
      await db.collection('units').doc('unit_orgA_1').set({
        id: 'unit_orgA_1',
        orgId: 'orgA',
        projectId: 'projA_private',
        unitNumber: 'A-101',
        status: 'AVAILABLE',
      });

      await db.collection('site_visits').doc('visit_orgA_1').set({
        id: 'visit_orgA_1',
        orgId: 'orgA',
        projectId: 'projA_private',
        customerName: 'Buyer Visit',
      });

      await db.collection('quotations').doc('quote_orgA_1').set({
        id: 'quote_orgA_1',
        orgId: 'orgA',
        projectId: 'projA_private',
        unitId: 'unit_orgA_1',
      });

      await db.collection('bookings').doc('booking_orgA_1').set({
        id: 'booking_orgA_1',
        orgId: 'orgA',
        projectId: 'projA_private',
        unitId: 'unit_orgA_1',
      });
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it('allows Org A member to read Org A project, blocks reading Org B private project, and allows unauthenticated read ONLY on published public listings', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(userADb.collection('projects').doc('projA_private').get());
    await assertFails(userADb.collection('projects').doc('projB_private').get());

    await assertFails(anonDb.collection('projects').doc('projA_private').get());
    await assertSucceeds(anonDb.collection('projects').doc('projB_public').get());
  });

  it('enforces user-private ai_sessions and project-scoped ai_inventory_drafts & ai_import_jobs while blocking all direct client writes', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    const scopedDb = testEnv.authenticatedContext('scopedExec').firestore();
    const outsiderDb = testEnv.authenticatedContext('outsiderB').firestore();

    // User A can read own session, CANNOT read scopedExec's private AI session
    await assertSucceeds(userADb.collection('ai_sessions').doc('sess_userA').get());
    await assertFails(userADb.collection('ai_sessions').doc('sess_scopedExec').get());
    await assertFails(outsiderDb.collection('ai_sessions').doc('sess_userA').get());

    // Project-scoped staff can read drafts/jobs in assigned project `projA_private`, CANNOT read `projA_secret_2`
    await assertSucceeds(scopedDb.collection('ai_inventory_drafts').doc('draft_projA1').get());
    await assertFails(scopedDb.collection('ai_inventory_drafts').doc('draft_projA2').get());
    await assertSucceeds(scopedDb.collection('ai_import_jobs').doc('job_projA1').get());
    await assertFails(scopedDb.collection('ai_import_jobs').doc('job_projA2').get());

    // Direct client writes to AI collections are strictly forbidden
    await assertFails(
      userADb.collection('ai_inventory_drafts').doc('forged_draft').set({
        orgId: 'orgA',
        projectId: 'projA_private',
      })
    );
    await assertFails(
      userADb.collection('ai_import_jobs').doc('forged_job').set({
        orgId: 'orgA',
        projectId: 'projA_private',
      })
    );
  });

  it('strictly blocks client writes/deletes on audit_events, units, _integration_secrets, and blocks un-audited Super Admin client reads of customer PII leads', async () => {
    const superDb = testEnv
      .authenticatedContext('super1', { platformRole: 'PLATFORM_SUPER_ADMIN' })
      .firestore();

    await assertFails(superDb.collection('_integration_secrets').doc('sec_1').get());
    await assertFails(superDb.collection('leads').doc('lead_pii_1').get());
    await assertFails(superDb.collection('audit_events').doc('audit_1').delete());
    await assertFails(
      superDb.collection('units').doc('tampered_unit').set({
        orgId: 'orgA',
        status: 'BOOKED',
      })
    );
  });

  it('isolates partner_organizations (SEC-01 fix), billing entitlements/ledgers/payments, and customer_saved_properties with zero client write elevation', async () => {
    const billingAdminADb = testEnv.authenticatedContext('billingAdminA').firestore();
    const userBDb = testEnv.authenticatedContext('userB').firestore();
    const partner1Db = testEnv.authenticatedContext('partnerUser1').firestore();
    const customer1Db = testEnv.authenticatedContext('customer1').firestore();
    const customer2Db = testEnv.authenticatedContext('customer2').firestore();

    // SEC-01 verification: Partner member and authorized Org A admin can read `partnerOrg1`, while Customer & Org B admin are blocked!
    await assertSucceeds(partner1Db.collection('partner_organizations').doc('partnerOrg1').get());
    await assertSucceeds(
      billingAdminADb.collection('partner_organizations').doc('partnerOrg1').get()
    );
    await assertFails(customer1Db.collection('partner_organizations').doc('partnerOrg1').get());
    await assertFails(userBDb.collection('partner_organizations').doc('partnerOrg1').get());

    // Billing & Wallet isolation + server-only writes
    await assertSucceeds(billingAdminADb.collection('entitlements').doc('orgA').get());
    await assertSucceeds(billingAdminADb.collection('payments').doc('pay_orgA_1').get());
    await assertSucceeds(billingAdminADb.collection('usage_ledger').doc('led_orgA_1').get());
    await assertSucceeds(billingAdminADb.collection('credit_topups').doc('topup_orgA_1').get());

    await assertFails(userBDb.collection('entitlements').doc('orgA').get());
    await assertFails(customer1Db.collection('usage_ledger').doc('led_orgA_1').get());

    // Builder Admin CANNOT self-modify entitlements, project capacity, or wallet balance from client!
    await assertFails(
      billingAdminADb.collection('entitlements').doc('orgA').update({
        subscribedProjectCapacity: 999,
        aiBalancePaise: 99999900,
      })
    );
    await assertFails(
      billingAdminADb.collection('usage_ledger').doc('forged_credit').set({
        orgId: 'orgA',
        entryType: 'TOPUP_CREDIT',
        amountPaise: 500000,
      })
    );

    // Customer saved properties: customer1 can read own bookmark, customer2 cannot, and direct client writes are blocked
    await assertSucceeds(
      customer1Db.collection('customer_saved_properties').doc('customer1_unit1').get()
    );
    await assertFails(
      customer2Db.collection('customer_saved_properties').doc('customer1_unit1').get()
    );
    await assertFails(
      customer1Db.collection('customer_saved_properties').doc('forged_save').set({
        uid: 'customer1',
        unitId: 'secret_unit',
      })
    );
  });

  it('allows org-scoped collection list queries across projects, units, leads, site_visits, quotations, and bookings when optional fields are omitted', async () => {
    const billingAdminADb = testEnv.authenticatedContext('billingAdminA').firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(
      billingAdminADb.collection('projects').where('orgId', '==', 'orgA').get()
    );
    await assertSucceeds(
      billingAdminADb.collection('units').where('orgId', '==', 'orgA').get()
    );
    await assertSucceeds(
      billingAdminADb.collection('leads').where('orgId', '==', 'orgA').get()
    );
    await assertSucceeds(
      billingAdminADb.collection('site_visits').where('orgId', '==', 'orgA').get()
    );
    await assertSucceeds(
      billingAdminADb.collection('quotations').where('orgId', '==', 'orgA').get()
    );
    await assertSucceeds(
      billingAdminADb.collection('bookings').where('orgId', '==', 'orgA').get()
    );

    // Public catalog list queries for published projects & units succeed without error
    await assertSucceeds(
      anonDb.collection('projects').where('isPublicPublished', '==', true).get()
    );
    await assertSucceeds(
      anonDb.collection('units').where('isPublicPublished', '==', true).get()
    );
  });
});
