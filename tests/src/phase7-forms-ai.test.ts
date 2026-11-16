import { describe, expect, it } from 'vitest';
import { createOrganizationService } from '../../functions/src/organizations';
import { superAdminAdjustWalletService } from '../../functions/src/billing';
import {
  submitPublicLeadFormService,
  upsertLeadFormService,
} from '../../functions/src/integrations';
import { executeAiTaskService } from '../../functions/src/ai';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const ADMIN = {
  uid: 'uid-marketing-head',
  email: 'marketing@bharatmakaan.test',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Phase 7 — Universal Lead Capture Forms, Spam Guards & Centralized OpenAI Service', () => {
  it('publishes custom lead capture form, enforces honeypot & rate limits, and saves submissions to the right organization', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'Solitaire Builders',
      legalName: 'Solitaire Builders Pvt Ltd',
      headquartersCity: 'Pune',
    });

    const form = await upsertLeadFormService(db, ADMIN, {
      orgId: organization.id,
      name: 'Baner Launch Campaign Form',
      slug: 'solitaire-baner-2026',
      status: 'PUBLISHED',
      fields: [
        { id: 'name', type: 'TEXT', label: 'Full Name', required: true, order: 0 },
        { id: 'phone', type: 'PHONE', label: 'Phone', required: true, order: 1 },
        { id: 'bhk', type: 'BHK', label: 'BHK', required: false, options: ['3 BHK', '4 BHK'], order: 2 },
        {
          id: 'penthouse_note',
          type: 'TEXT',
          label: 'Penthouse Customization',
          required: true,
          condition: { dependsOnFieldId: 'bhk', equalsValue: '4 BHK' },
          order: 3,
        },
      ],
      branding: {
        headline: 'Book VIP Preview',
        accentColor: '#0F265C',
      },
      consentText: 'I consent to receive project updates via WhatsApp/Phone.',
      successMessage: 'Thank you for registering!',
      honeypotEnabled: true,
      rateLimitPerHour: 5,
    });

    // Honeypot bot submission MUST be rejected
    await expect(
      submitPublicLeadFormService(
        db,
        {
          formSlug: form.slug,
          values: { name: 'SpamBot', phone: '+919800000001' },
          consentAccepted: true,
          honeypotValue: 'http://spam.example',
        },
        '203.0.113.5'
      )
    ).rejects.toThrow();

    // Valid submission where bhk='3 BHK' skips conditional required 'penthouse_note' cleanly!
    const sub1 = await submitPublicLeadFormService(
      db,
      {
        formSlug: form.slug,
        values: { name: 'Riya Deshmukh', phone: '9822011223', bhk: '3 BHK' },
        consentAccepted: true,
        honeypotValue: '',
      },
      '203.0.113.9'
    );
    expect(sub1.submission.orgId).toBe(organization.id);
    expect(sub1.deduplicated).toBe(false);

    // Subsequent repeat submission deduplicates, and exceeding 5/hour from same IP blocks!
    const sub2 = await submitPublicLeadFormService(
      db,
      {
        formSlug: form.slug,
        values: { name: 'Riya Deshmukh', phone: '+91 98220 11223', bhk: '3 BHK' },
        consentAccepted: true,
        honeypotValue: '',
      },
      '203.0.113.9'
    );
    expect(sub2.deduplicated).toBe(true);

    for (let i = 0; i < 3; i++) {
      await submitPublicLeadFormService(
        db,
        {
          formSlug: form.slug,
          values: { name: `Visitor ${i}`, phone: `982209900${i}`, bhk: '3 BHK' },
          consentAccepted: true,
          honeypotValue: '',
        },
        '203.0.113.9'
      );
    }

    await expect(
      submitPublicLeadFormService(
        db,
        {
          formSlug: form.slug,
          values: { name: 'Sixth Attempt', phone: '9822099887', bhk: '3 BHK' },
          consentAccepted: true,
          honeypotValue: '',
        },
        '203.0.113.9'
      )
    ).rejects.toThrow(/Rate limit/);
  });

  it('tracks OpenAI token usage, refuses unconfigured production calls honestly, and enforces monthly AI credit caps', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'Elysium Developers',
      legalName: 'Elysium Developers Pvt Ltd',
      headquartersCity: 'Hyderabad',
    });

    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    // Without OPENAI_API_KEY and without mock client -> honest UNCONFIGURED error (never fake output!)
    await expect(
      executeAiTaskService(db, ADMIN, {
        orgId: organization.id,
        feature: 'LEAD_QUALIFICATION',
        context: { budgetMaxInr: 30000000, timeline: 'IMMEDIATE' },
      })
    ).rejects.toThrow(/OPENAI_API_KEY/);

    if (savedKey) process.env.OPENAI_API_KEY = savedKey;

    // Credit prepaid AI Wallet first (zero initial wallet balance blocks chargeable calls!)
    await superAdminAdjustWalletService(
      db,
      { uid: 'uid-sa', email: 'prateek.parts@gmail.com', isSuperAdmin: true, mfaVerified: true },
      {
        orgId: organization.id,
        walletType: 'AI',
        creditDeltaPaise: 50000,
        requestId: 'req_ai_phase7_seed',
        reason: 'Prepaid AI test wallet top-up',
      }
    );

    // With injected mocked OpenAI SDK client -> logs tokens, settles prepaid AI wallet, writes audit event
    const mockOpenAi = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: 'Qualification: HOT — Immediate timeline with ₹3 Cr verified budget.',
                },
              },
            ],
            usage: { prompt_tokens: 140, completion_tokens: 28 },
          }),
        },
      },
    } as any;

    const aiRes = await executeAiTaskService(
      db,
      ADMIN,
      {
        orgId: organization.id,
        feature: 'LEAD_QUALIFICATION',
        context: { budgetMaxInr: 30000000, timeline: 'IMMEDIATE' },
      },
      mockOpenAi
    );
    expect(aiRes.text).toContain('HOT');
    expect(aiRes.log.inputTokens).toBe(140);
    expect(aiRes.log.status).toBe('SUCCESS');

    // Exhaust prepaid AI wallet balance to 0 Paise and verify further chargeable calls are blocked
    await db.collection('entitlements').doc(organization.id).update({
      aiBalancePaise: 0,
    });

    await expect(
      executeAiTaskService(
        db,
        ADMIN,
        {
          orgId: organization.id,
          feature: 'COST_SHEET_EXPLANATION',
          context: { totalPayableInr: 39273985 },
        },
        mockOpenAi
      )
    ).rejects.toThrow(/Insufficient prepaid AI Wallet/i);
  });
});
