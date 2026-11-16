import type { Transaction } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminDb } from '../../functions/src/shared/firebase-admin';
import { createOrganizationService } from '../../functions/src/organizations';

afterEach(() => vi.restoreAllMocks());

describe('Onboarding Firestore serialization', () => {
  it('accepts omitted optional fields using the real Firestore serializer', async () => {
    // Validate writes with the real SDK, but never commit or contact a database.
    const batch = adminDb.batch();
    const set = vi.spyOn(batch, 'set');
    vi.spyOn(adminDb, 'runTransaction').mockImplementation(async (callback) =>
      callback(batch as unknown as Transaction)
    );

    const result = await createOrganizationService(adminDb, {
      uid: 'serialization-test-user',
      email: 'onboarding@example.test',
      isSuperAdmin: false,
      mfaVerified: false,
    }, {
      name: 'Serialization Test Builder',
      legalName: 'Serialization Test Builder Pvt Ltd',
      headquartersCity: 'Hyderabad',
    });

    expect(result.organization.name).toBe('Serialization Test Builder');
    expect(result.membership.uid).toBe('serialization-test-user');
    expect(set).toHaveBeenCalledTimes(5);
    expect(set.mock.calls.map(([ref]) => ref.parent.id)).toEqual([
      'organizations', 'organization_members', 'subscriptions', 'entitlements', 'audit_events',
    ]);
  });
});
