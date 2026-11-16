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

    testEnv = await initializeTestEnvironment({
      projectId: 'bharat-makaan-rules-test',
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
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
});
