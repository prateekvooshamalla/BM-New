import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import type {
  FormSubmission,
  LeadCaptureForm,
} from '@bharat-makaan/shared';
import {
  publicFormSubmissionSchema,
  upsertLeadFormSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { ingestLeadService } from '../leads';
import { verifyMetaWebhookSignature } from '../whatsapp';
import {
  initiateSubscriptionCheckoutService,
  processRazorpayWebhookService,
} from '../billing';
import { writeAuditEvent } from '../audit';

// ============================================================================
// 1. Visual Lead Form Builder & Public Spam-Protected Ingestion
// ============================================================================

export async function upsertLeadFormService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<LeadCaptureForm> {
  const input = upsertLeadFormSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  // Check slug uniqueness across published forms
  const dupSlugSnap = await db
    .collection('forms')
    .where('slug', '==', input.slug)
    .limit(1)
    .get();

  if (!dupSlugSnap.empty && dupSlugSnap.docs[0]!.id !== input.formId) {
    throw new HttpsError('already-exists', `Form slug "${input.slug}" is already taken.`);
  }

  const ref = input.formId
    ? db.collection('forms').doc(input.formId)
    : db.collection('forms').doc();

  let viewsCount = 0;
  let submissionsCount = 0;
  let createdAt = nowIso;

  if (input.formId) {
    const prevSnap = await ref.get();
    if (prevSnap.exists) {
      const prev = prevSnap.data() as LeadCaptureForm;
      viewsCount = prev.viewsCount;
      submissionsCount = prev.submissionsCount;
      createdAt = prev.createdAt;
    }
  }

  const form: LeadCaptureForm = {
    id: ref.id,
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    name: input.name.trim(),
    slug: input.slug.trim().toLowerCase(),
    status: input.status,
    fields: input.fields,
    branding: input.branding,
    consentText: input.consentText.trim(),
    successMessage: input.successMessage.trim(),
    honeypotEnabled: input.honeypotEnabled,
    rateLimitPerHour: input.rateLimitPerHour,
    viewsCount,
    submissionsCount,
    createdByUid: actor.uid,
    createdAt,
    updatedAt: nowIso,
  };

  await ref.set(form);
  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    action: input.formId ? 'FORM_UPDATED' : 'FORM_CREATED',
    category: 'SYSTEM',
    entityType: 'form',
    entityId: form.id,
    summary: `Saved lead capture form "${form.name}" (/f/${form.slug}, status=${form.status}).`,
  });

  return form;
}

export async function submitPublicLeadFormService(
  db: Firestore,
  rawInput: unknown,
  clientIp = '0.0.0.0'
): Promise<{ submission: FormSubmission; deduplicated: boolean; successMessage: string }> {
  const input = publicFormSubmissionSchema.parse(rawInput);

  if (input.honeypotValue && input.honeypotValue.length > 0) {
    throw new HttpsError('permission-denied', 'Automated bot submission rejected.');
  }

  const formSnap = await db
    .collection('forms')
    .where('slug', '==', input.formSlug.toLowerCase())
    .where('status', '==', 'PUBLISHED')
    .limit(1)
    .get();

  if (formSnap.empty) {
    throw new HttpsError('not-found', 'Published form not found.');
  }

  const form = formSnap.docs[0]!.data() as LeadCaptureForm;
  const ipHash = crypto
    .createHash('sha256')
    .update(`${form.id}:${clientIp}:${new Date().toISOString().slice(0, 13)}`)
    .digest('hex')
    .slice(0, 24);

  // Per-hour IP rate limit enforcement
  const rlRef = db.collection('_rate_limits').doc(ipHash);
  const rlSnap = await rlRef.get();
  const currentHits = rlSnap.exists ? ((rlSnap.data()?.hits as number) ?? 0) : 0;
  if (currentHits >= form.rateLimitPerHour) {
    throw new HttpsError('resource-exhausted', 'Rate limit exceeded. Please try again later.');
  }
  await rlRef.set({ hits: currentHits + 1, updatedAt: new Date().toISOString() });

  // Extract canonical buyer attributes from dynamic fields
  const values = input.values;
  let customerName = 'Website Visitor';
  let phone = '';
  let email = '';
  let bhkPreference: string | undefined;
  let budgetMaxInr: number | undefined;

  for (const field of form.fields) {
    const rawVal = values[field.id];
    if (field.required && (rawVal === undefined || rawVal === null || String(rawVal).trim() === '')) {
      // Check if field was hidden by a non-matching condition
      if (field.condition) {
        const depVal = String(values[field.condition.dependsOnFieldId] ?? '');
        if (depVal !== field.condition.equalsValue) continue;
      }
      throw new HttpsError('invalid-argument', `Required field missing: ${field.label}`);
    }
    const strVal = rawVal != null ? String(rawVal).trim() : '';
    if (!strVal) continue;

    if (field.type === 'PHONE') phone = strVal;
    else if (field.type === 'EMAIL') email = strVal;
    else if (field.type === 'BHK') bhkPreference = strVal;
    else if (field.type === 'BUDGET') budgetMaxInr = Number(strVal.replace(/[^\d]/g, '')) || undefined;
    else if (field.type === 'TEXT' && /name/i.test(field.label)) customerName = strVal;
  }

  if (!phone) {
    throw new HttpsError('invalid-argument', 'A valid phone number field is required for lead capture.');
  }

  const ingested = await ingestLeadService(
    db,
    { uid: 'PUBLIC_CAPTURE', isSuperAdmin: false, mfaVerified: false },
    'PUBLIC_FORM',
    {
      orgId: form.orgId,
      customerName,
      phone,
      email,
      source: 'HOSTED_FORM',
      campaign: `form:${form.slug}`,
      budgetMaxInr,
      preferredProjectIds: form.projectId ? [form.projectId] : [],
      bhkPreference,
      assignedAgentUid: form.assignToAgentUid ?? undefined,
      whatsappOptIn: true,
    }
  );

  const nowIso = new Date().toISOString();
  const subRef = db.collection('form_submissions').doc();
  const submission: FormSubmission = {
    id: subRef.id,
    orgId: form.orgId,
    formId: form.id,
    projectId: form.projectId ?? null,
    values,
    consentAccepted: true,
    resultingLeadId: ingested.lead.id,
    isDuplicate: ingested.deduplicated,
    ipHash,
    submittedAt: nowIso,
  };

  await subRef.set(submission);
  await formSnap.docs[0]!.ref.update({
    submissionsCount: (form.submissionsCount ?? 0) + 1,
    updatedAt: nowIso,
  });

  return {
    submission,
    deduplicated: ingested.deduplicated,
    successMessage: form.successMessage,
  };
}

export const upsertLeadForm = onCall(async (request) => {
  const parsed = upsertLeadFormSchema.parse(request.data);
  const { actor } = await requireOrgPermission(request, parsed.orgId, 'forms:manage');
  return upsertLeadFormService(adminDb, actor, parsed);
});

export const submitPublicLeadForm = onCall(async (request) => {
  const ip = request.rawRequest?.ip || '0.0.0.0';
  return submitPublicLeadFormService(adminDb, request.data, ip);
});

// ============================================================================
// 2. Meta (Facebook / Instagram) & Google Ads Authenticated Lead Webhooks
// ============================================================================

export const metaLeadsWebhook = onRequest(async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && process.env.META_VERIFY_TOKEN && token === process.env.META_VERIFY_TOKEN) {
      res.status(200).send(String(challenge));
      return;
    }
    res.status(403).json({ error: 'Meta verify token mismatch.' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const secret = process.env.META_APP_SECRET || '';
  if (!verifyMetaWebhookSignature(req.rawBody, req.header('x-hub-signature-256'), secret)) {
    res.status(401).json({ error: 'Invalid Meta signature.' });
    return;
  }

  const body = req.body as any;
  for (const entry of body?.entry ?? []) {
    const pageId = String(entry?.id ?? '');
    const intSnap = await adminDb
      .collection('integrations')
      .where('provider', '==', 'META_LEAD_ADS')
      .where('publicMetadata.pageId', '==', pageId)
      .limit(1)
      .get();
    if (intSnap.empty) continue;
    const orgId = intSnap.docs[0]!.data().orgId as string;

    for (const ch of entry?.changes ?? []) {
      const v = ch?.value;
      if (v?.phone || v?.full_name) {
        await ingestLeadService(
          adminDb,
          { uid: 'META_WEBHOOK', isSuperAdmin: false, mfaVerified: false },
          'WEBHOOK',
          {
            orgId,
            customerName: v.full_name || 'Meta Lead',
            phone: v.phone || '+919000000000',
            email: v.email || '',
            source: v.platform === 'ig' ? 'INSTAGRAM_ADS' : 'FACEBOOK_ADS',
            campaign: String(v.campaign_name || v.form_id || 'meta_leadgen'),
          }
        );
      }
    }
  }

  res.status(200).json({ received: true });
});

export const googleAdsWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const payload = req.body as any;
  const providedKey = String(payload?.google_key || '');
  const expectedDefault = process.env.GOOGLE_ADS_DEFAULT_WEBHOOK_SECRET || '';

  if (!providedKey || !expectedDefault || providedKey !== expectedDefault) {
    res.status(401).json({ error: 'Invalid Google Ads webhook key.' });
    return;
  }

  const orgId = String(payload?.org_id || '');
  if (!orgId) {
    res.status(400).json({ error: 'Missing org_id.' });
    return;
  }

  const columnData: Array<{ column_id: string; string_value: string }> =
    payload?.user_column_data ?? [];
  const findCol = (id: string) =>
    columnData.find((c) => c.column_id === id)?.string_value ?? '';

  await ingestLeadService(
    adminDb,
    { uid: 'GOOGLE_ADS_WEBHOOK', isSuperAdmin: false, mfaVerified: false },
    'WEBHOOK',
    {
      orgId,
      customerName: findCol('FULL_NAME') || 'Google Ads Lead',
      phone: findCol('PHONE_NUMBER'),
      email: findCol('EMAIL'),
      source: 'GOOGLE_ADS',
      campaign: String(payload?.campaign_id || 'google_ads'),
    }
  );

  res.status(200).json({ received: true });
});

// ============================================================================
// 3. Legacy Compatibility Aliases -> Delegated to Authoritative `billing` Module
// ============================================================================

export const changeSaasSubscriptionPlan = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = String(data.orgId || '');
  const { actor } = await requireOrgPermission(request, orgId, 'billing:manage', null, {
    isReadOrBillingOperation: true,
  });
  return initiateSubscriptionCheckoutService(adminDb, actor, {
    orgId,
    packageCode: data.planCode === 'MULTI_PROJECT' ? 'MULTI_PROJECT' : 'SINGLE_PROJECT',
    requestedProjectCapacity: Number(data.requestedProjectCapacity ?? 1),
    onboardingServiceCode: 'SELF_SERVICE',
    clientPlatform: (data.clientPlatform as string) || 'WEB',
    idempotencyKey: String(data.idempotencyKey || `legacy_${orgId}_${Date.now()}`),
  });
});

export const razorpaySaasWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const secret = process.env.RAZORPAY_SAAS_WEBHOOK_SECRET || '';
  try {
    const result = await processRazorpayWebhookService({
      db: adminDb,
      rawBody: req.rawBody,
      signatureHeader: req.header('x-razorpay-signature'),
      eventIdHeader: req.header('x-razorpay-event-id'),
      webhookSecret: secret,
    });
    res.status(200).json(result);
  } catch (err) {
    const code = err instanceof HttpsError && err.code === 'unauthenticated' ? 401 : 400;
    res.status(code).json({
      error: err instanceof Error ? err.message : 'Invalid SaaS webhook signature.',
    });
  }
});
