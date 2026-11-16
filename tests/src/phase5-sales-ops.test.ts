import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrganizationService } from '../../functions/src/organizations';
import { superAdminAdjustWalletService } from '../../functions/src/billing';
import { createProjectService } from '../../functions/src/projects';
import { ingestLeadService } from '../../functions/src/leads';
import {
  onboardPartnerOrganizationService,
  registerPartnerLeadService,
  resolveLeadConflictService,
} from '../../functions/src/channel-partners';
import {
  processInboundWhatsappEventService,
  sendOutboundWhatsappService,
  verifyMetaWebhookSignature,
} from '../../functions/src/whatsapp';
import {
  scheduleSiteVisitService,
  updateSiteVisitOutcomeService,
} from '../../functions/src/notifications';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const ADMIN = {
  uid: 'uid-sales-head',
  email: 'sales.head@builder.test',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Phase 5 — Sales Operations: CRM Dedup, Partner Lead Protection, Visits & WhatsApp', () => {
  it('enforces channel partner lead protection, prevents silent ownership override, and resolves conflicts', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'Sterling Developers',
      legalName: 'Sterling Developers Pvt Ltd',
      headquartersCity: 'Bengaluru',
      leadProtectionDays: 60,
    });

    const project = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Sterling Developers',
      name: 'Sterling Park',
      code: 'STP',
      city: 'Bengaluru',
      locality: 'Bellandur',
      address: 'ORR Bellandur, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/STP/001',
      configurations: ['3 BHK'],
      constructionStatus: 'NEW_LAUNCH',
    });

    const partnerA = await onboardPartnerOrganizationService(db, ADMIN, {
      orgId: organization.id,
      companyName: 'Prime Realtors',
      contactName: 'Siddharth Jain',
      email: 'sid@primerealtors.in',
      phone: '+91 9811122233',
      officeCity: 'Bengaluru',
      projectIds: [project.id],
      commissionPct: 2.5,
      commissionTerms: 'On Agreement',
      partnerAdminUid: 'uid-partner-a',
    });

    const partnerB = await onboardPartnerOrganizationService(db, ADMIN, {
      orgId: organization.id,
      companyName: 'Metro Brokers',
      contactName: 'Neha Gupta',
      email: 'neha@metrobrokers.in',
      phone: '+91 9811122244',
      officeCity: 'Bengaluru',
      projectIds: [project.id],
      commissionPct: 2.0,
      commissionTerms: 'On Agreement',
      partnerAdminUid: 'uid-partner-b',
    });

    // Partner A registers customer first
    const regA = await registerPartnerLeadService(
      db,
      { uid: 'uid-partner-a', isSuperAdmin: false, mfaVerified: false },
      {
        orgId: organization.id,
        projectId: project.id,
        partnerOrgId: partnerA.id,
        customerName: 'Arjun Menon',
        phone: '9880011223',
      }
    );
    expect(regA.conflictDetected).toBe(false);
    expect(regA.registration.status).toBe('PROTECTED');

    // Partner B attempts duplicate registration -> flagged DISPUTED; Partner A retains lead ownership!
    const regB = await registerPartnerLeadService(
      db,
      { uid: 'uid-partner-b', isSuperAdmin: false, mfaVerified: false },
      {
        orgId: organization.id,
        projectId: project.id,
        partnerOrgId: partnerB.id,
        customerName: 'Arjun Menon',
        phone: '+91 98800 11223',
      }
    );
    expect(regB.conflictDetected).toBe(true);
    expect(regB.registration.status).toBe('DISPUTED');

    const leadSnap = await db.collection('leads').doc(regA.leadId).get();
    expect(leadSnap.data()?.partnerOrgId).toBe(partnerA.id);

    // Sales Manager resolves conflict in favour of Partner A
    const resolved = await resolveLeadConflictService(db, ADMIN, {
      orgId: organization.id,
      registrationId: regB.registration.id,
      winningPartnerOrgId: partnerA.id,
      resolutionNotes: 'Partner A registered 2 days prior with verified client email.',
    });
    expect(resolved.status).toBe('PROTECTED');
    expect(resolved.partnerOrgId).toBe(partnerA.id);
  });

  it('deduplicates repeat direct leads and schedules timezone-aware site visits', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'Horizon Homes',
      legalName: 'Horizon Homes LLP',
      headquartersCity: 'Chennai',
    });
    const project = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Horizon Homes',
      name: 'Horizon Bay',
      code: 'HZB',
      city: 'Chennai',
      locality: 'OMR',
      address: 'OMR, Chennai',
      projectType: 'APARTMENT',
      reraNumber: 'TN/RERA/0099',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const first = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      customerName: 'Meera Iyer',
      phone: '9840055667',
      source: 'WEBSITE',
      preferredProjectIds: [project.id],
      buyingTimeline: 'IMMEDIATE',
      budgetMaxInr: 20000000,
    });
    expect(first.deduplicated).toBe(false);

    const repeat = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      customerName: 'Meera Iyer',
      phone: '+919840055667',
      source: 'GOOGLE_ADS',
      preferredProjectIds: [project.id],
    });
    expect(repeat.deduplicated).toBe(true);
    expect(repeat.lead.id).toBe(first.lead.id);

    const visit = await scheduleSiteVisitService(db, ADMIN, {
      orgId: organization.id,
      projectId: project.id,
      leadId: first.lead.id,
      customerName: 'Meera Iyer',
      customerPhone: '+919840055667',
      scheduledStartAt: '2026-11-20T05:30:00.000Z',
      scheduledEndAt: '2026-11-20T06:30:00.000Z',
      timezone: 'Asia/Kolkata',
    });
    expect(visit.reminderJobKey).toBeTruthy();

    const completed = await updateSiteVisitOutcomeService(db, ADMIN, {
      orgId: organization.id,
      visitId: visit.id,
      status: 'COMPLETED',
      outcome: 'SHORTLISTED',
    });
    expect(completed.status).toBe('COMPLETED');
    const leadAfter = await db.collection('leads').doc(first.lead.id).get();
    expect(leadAfter.data()?.stage).toBe('VISITED');
  });

  it('validates Meta WhatsApp webhook HMAC signatures, 24h customer-service window, human AI gate & STOP opt-out', async () => {
    const rawPayload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const appSecret = 'meta-test-secret-key-999';
    const validHmac =
      'sha256=' + crypto.createHmac('sha256', appSecret).update(rawPayload).digest('hex');

    expect(verifyMetaWebhookSignature(rawPayload, validHmac, appSecret)).toBe(true);
    expect(verifyMetaWebhookSignature(rawPayload, 'sha256=deadbeef', appSecret)).toBe(false);

    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, ADMIN, {
      name: 'Aura Estates',
      legalName: 'Aura Estates Pvt Ltd',
      headquartersCity: 'Mumbai',
    });

    await superAdminAdjustWalletService(
      db,
      { uid: 'uid-super', email: 'prateek.parts@gmail.com', isSuperAdmin: true, mfaVerified: true },
      {
        orgId: organization.id,
        walletType: 'WHATSAPP',
        creditDeltaPaise: 50000,
        requestId: 'req_wa_phase5_seed',
        reason: 'Prepaid WhatsApp test balance',
      }
    );

    // Conversation with expired (>24h ago) customer message blocks free-form TEXT, allows TEMPLATE
    const oldTs = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const { conversation } = await processInboundWhatsappEventService(db, {
      orgId: organization.id,
      fromPhone: '+919900112233',
      customerName: 'Dev Patel',
      textBody: 'Hi, share brochure please',
      waMessageId: 'wamid.1',
      timestampIso: oldTs,
    });

    await expect(
      sendOutboundWhatsappService(db, ADMIN, {
        orgId: organization.id,
        conversationId: conversation.id,
        messageType: 'TEXT',
        content: 'Free form outside 24h window',
      })
    ).rejects.toThrow(/24-hour/);

    const tplSent = await sendOutboundWhatsappService(db, ADMIN, {
      orgId: organization.id,
      conversationId: conversation.id,
      messageType: 'TEMPLATE',
      templateName: 'project_brochure_intro',
      content: 'Template message allowed outside 24h window',
    });
    expect(tplSent.messageType).toBe('TEMPLATE');

    // Fresh inbound opens 24h window; AI reply still requires human approval by default!
    await processInboundWhatsappEventService(db, {
      orgId: organization.id,
      fromPhone: '+919900112233',
      customerName: 'Dev Patel',
      textBody: 'Yes, interested in 3 BHK',
      waMessageId: 'wamid.2',
      timestampIso: new Date().toISOString(),
    });

    const aiDraft = await sendOutboundWhatsappService(db, ADMIN, {
      orgId: organization.id,
      conversationId: conversation.id,
      messageType: 'AI_DRAFT',
      content: 'AI suggested reply with 3 BHK options',
      aiGenerated: true,
    });
    expect(aiDraft.deliveryStatus).toBe('DRAFT_PENDING_APPROVAL');

    // Inbound STOP opts out recipient and blocks further outbound messages
    await processInboundWhatsappEventService(db, {
      orgId: organization.id,
      fromPhone: '+919900112233',
      customerName: 'Dev Patel',
      textBody: 'STOP',
      waMessageId: 'wamid.3',
    });
    await expect(
      sendOutboundWhatsappService(db, ADMIN, {
        orgId: organization.id,
        conversationId: conversation.id,
        messageType: 'TEMPLATE',
        templateName: 'project_brochure_intro',
        content: 'Blocked after STOP',
      })
    ).rejects.toThrow(/opted out/);
  });
});
