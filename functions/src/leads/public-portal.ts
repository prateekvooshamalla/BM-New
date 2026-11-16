import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { adminDb } from '../shared/firebase-admin';
import { ingestLeadService } from './index';
import { scheduleSiteVisitService } from '../notifications';

export const submitPublicPortalEnquiry = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().optional(),
    unitId: z.string().optional(),
    customerName: z.string().min(2).max(120),
    phone: z.string().min(10).max(16),
    email: z.string().email().optional().or(z.literal('')),
    message: z.string().max(800).optional(),
  });
  const input = schema.parse(request.data);

  // Verify organization is active
  const orgSnap = await adminDb.collection('organizations').doc(input.orgId).get();
  if (!orgSnap.exists || orgSnap.data()?.status !== 'ACTIVE') {
    throw new HttpsError('not-found', 'Builder organization is not active.');
  }

  return ingestLeadService(
    adminDb,
    { uid: 'PUBLIC_PORTAL_VISITOR', isSuperAdmin: false, mfaVerified: false },
    'PUBLIC_PORTAL',
    {
      orgId: input.orgId,
      customerName: input.customerName,
      phone: input.phone,
      email: input.email,
      source: 'PUBLIC_PORTAL',
      preferredProjectIds: input.projectId ? [input.projectId] : [],
      notes: input.message
        ? `${input.unitId ? `[Unit ${input.unitId}] ` : ''}${input.message}`
        : undefined,
    }
  );
});

export const submitPublicSiteVisit = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    unitId: z.string().optional(),
    customerName: z.string().min(2).max(120),
    customerPhone: z.string().min(10).max(16),
    customerEmail: z.string().email().optional().or(z.literal('')),
    scheduledStartAt: z.string().min(1),
    scheduledEndAt: z.string().min(1),
    notes: z.string().max(400).optional(),
  });
  const input = schema.parse(request.data);

  const projSnap = await adminDb.collection('projects').doc(input.projectId).get();
  if (!projSnap.exists || !projSnap.data()?.isPublicPublished) {
    throw new HttpsError('not-found', 'Published project not found.');
  }

  const ingested = await ingestLeadService(
    adminDb,
    { uid: 'PUBLIC_PORTAL_VISITOR', isSuperAdmin: false, mfaVerified: false },
    'PUBLIC_PORTAL',
    {
      orgId: input.orgId,
      customerName: input.customerName,
      phone: input.customerPhone,
      email: input.customerEmail,
      source: 'PUBLIC_PORTAL',
      preferredProjectIds: [input.projectId],
      notes: input.notes,
    }
  );

  return scheduleSiteVisitService(
    adminDb,
    { uid: 'PUBLIC_PORTAL_VISITOR', isSuperAdmin: false, mfaVerified: false },
    {
      orgId: input.orgId,
      projectId: input.projectId,
      unitId: input.unitId ?? null,
      leadId: ingested.lead.id,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      timezone: 'Asia/Kolkata',
      notes: input.notes,
    }
  );
});

export const submitPlatformSupportRequest = onCall(async (request) => {
  const schema = z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(20).optional(),
    companyName: z.string().max(140).optional(),
    subject: z.string().min(3).max(160),
    message: z.string().min(5).max(2000),
  });
  const input = schema.parse(request.data);
  const ref = adminDb.collection('support_requests').doc();
  const payload = {
    id: ref.id,
    ...input,
    status: 'OPEN',
    createdByUid: request.auth?.uid ?? null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(payload);
  return { ticketId: ref.id };
});
