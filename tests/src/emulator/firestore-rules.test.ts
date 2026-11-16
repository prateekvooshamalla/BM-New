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

describe('Firebase Emulator — Multi-Tenant Firestore Security Rules Verification', () => {
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

      await db.collection('organization_members').doc('orgA_userA').set({
        id: 'orgA_userA',
        orgId: 'orgA',
        uid: 'userA',
        role: 'SALES_MANAGER',
        status: 'ACTIVE',
        permissions: ['projects:view', 'inventory:view', 'leads:view_all', 'audit:view'],
        assignedProjectIds: [],
      });

      await db.collection('projects').doc('projA_private').set({
        id: 'projA_private',
        orgId: 'orgA',
        name: 'Org A Private Project',
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

  it('strictly blocks client writes/deletes on audit_events, units, and _integration_secrets even for Super Admin tokens', async () => {
    const superDb = testEnv
      .authenticatedContext('super1', { platformRole: 'PLATFORM_SUPER_ADMIN' })
      .firestore();

    await assertFails(superDb.collection('_integration_secrets').doc('sec_1').get());
    await assertFails(superDb.collection('audit_events').doc('audit_1').delete());
    await assertFails(
      superDb.collection('units').doc('tampered_unit').set({
        orgId: 'orgA',
        status: 'BOOKED',
      })
    );
  });
});
