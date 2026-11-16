import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeIndianPhone,
  type Lead,
  type LeadRegistration,
  type Organization,
  type PartnerMember,
  type PartnerOrganization,
} from '@bharat-makaan/shared';
import { registerPartnerLeadSchema } from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import {
  requireOrgPermission,
  requirePartnerProjectScope,
  type AuthenticatedActor,
} from '../shared/auth-guard';
import { ingestLeadService } from '../leads';
import { writeAuditEvent } from '../audit';

function hashPhone(normalizedPhone: string): string {
  return crypto.createHash('sha256').update(normalizedPhone).digest('hex').slice(0, 20);
}

export async function onboardPartnerOrganizationService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    reraNumber?: string;
    gstin?: string;
    officeCity: string;
    projectIds: string[];
    commissionPct: number;
    commissionTerms: string;
    partnerAdminUid?: string;
  }
): Promise<PartnerOrganization> {
  const nowIso = new Date().toISOString();
  const ref = db.collection('partner_organizations').doc();
  const partnerOrg: PartnerOrganization = {
    id: ref.id,
    companyName: params.companyName.trim(),
    contactName: params.contactName.trim(),
    email: params.email.trim().toLowerCase(),
    phone: normalizeIndianPhone(params.phone),
    reraNumber: params.reraNumber?.trim() || undefined,
    gstin: params.gstin?.trim() || undefined,
    officeCity: params.officeCity.trim(),
    status: 'ACTIVE',
    authorizedOrgIds: [params.orgId],
    builderScopes: {
      [params.orgId]: {
        orgId: params.orgId,
        projectIds: params.projectIds,
        commissionPct: params.commissionPct,
        commissionTerms: params.commissionTerms,
        status: 'AUTHORIZED',
      },
    },
    metrics: {
      registeredLeadsCount: 0,
      siteVisitsCount: 0,
      bookingsCount: 0,
      eligibleCommissionInr: 0,
      paidCommissionInr: 0,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ref.set(partnerOrg);

  if (params.partnerAdminUid) {
    const pmId = `${partnerOrg.id}_${params.partnerAdminUid}`;
    const pm: PartnerMember = {
      id: pmId,
      partnerOrgId: partnerOrg.id,
      uid: params.partnerAdminUid,
      email: partnerOrg.email,
      displayName: partnerOrg.contactName,
      phone: partnerOrg.phone,
      role: 'CHANNEL_PARTNER_ADMIN',
      permissions: [...DEFAULT_ROLE_PERMISSIONS.CHANNEL_PARTNER_ADMIN],
      status: 'ACTIVE',
      createdAt: nowIso,
    };
    await db.collection('partner_members').doc(pmId).set(pm);
  }

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'CHANNEL_PARTNER_ONBOARDED',
    category: 'PERMISSION',
    entityType: 'partner_organization',
    entityId: partnerOrg.id,
    summary: `Onboarded channel partner "${partnerOrg.companyName}" (${params.commissionPct}% commission).`,
  });

  return partnerOrg;
}

/**
 * Protected Channel Partner Lead Registration.
 * NEVER silently overrides existing lead ownership!
 * If an active protected registration or existing lead already exists, flags a
 * `DISPUTED` registration conflict for Sales Manager / Admin conflict resolution.
 */
export async function registerPartnerLeadService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<{
  registration: LeadRegistration;
  conflictDetected: boolean;
  leadId: string;
}> {
  const input = registerPartnerLeadSchema.parse(rawInput);
  const normalizedPhone = normalizeIndianPhone(input.phone);
  const phoneHash = hashPhone(normalizedPhone);
  const lockId = `${input.orgId}_${input.projectId}_${phoneHash}`;
  const now = new Date();
  const nowIso = now.toISOString();

  const orgSnap = await db.collection('organizations').doc(input.orgId).get();
  if (!orgSnap.exists) {
    throw new HttpsError('not-found', 'Builder organization not found.');
  }
  const org = orgSnap.data() as Organization;
  const protectionDays = org.leadProtectionDays || 60;
  const protectedUntil = new Date(
    now.getTime() + protectionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // Check if builder CRM already owns this customer phone directly or via another partner
  const existingLeadSnap = await db
    .collection('leads')
    .where('orgId', '==', input.orgId)
    .where('normalizedPhone', '==', normalizedPhone)
    .limit(1)
    .get();

  return db.runTransaction(async (tx) => {
    const regRef = db.collection('lead_registrations').doc(lockId);
    const regSnap = await tx.get(regRef);

    if (regSnap.exists) {
      const existingReg = regSnap.data() as LeadRegistration;
      const isStillProtected =
        existingReg.status === 'PROTECTED' && Date.parse(existingReg.protectedUntil) > now.getTime();

      if (isStillProtected && existingReg.partnerOrgId !== input.partnerOrgId) {
        // Record DISPUTED claim WITHOUT overwriting original partner's lead ownership!
        const disputed: LeadRegistration = {
          ...existingReg,
          status: 'DISPUTED',
          disputedByPartnerOrgId: input.partnerOrgId,
          conflictReason: `Competing claim by partner ${input.partnerOrgId} while protected under ${existingReg.partnerOrgId} until ${existingReg.protectedUntil.slice(0, 10)}.`,
          updatedAt: nowIso,
        };
        tx.set(regRef, disputed);

        await writeAuditEvent(
          db,
          {
            orgId: input.orgId,
            actorUid: actor.uid,
            action: 'PARTNER_LEAD_CONFLICT_FLAGGED',
            category: 'APPROVAL',
            entityType: 'lead_registration',
            entityId: lockId,
            summary: `Duplicate partner claim on ${normalizedPhone} flagged as DISPUTED (Original owner: ${existingReg.partnerOrgId}).`,
          },
          tx
        );

        return {
          registration: disputed,
          conflictDetected: true,
          leadId: existingReg.leadId,
        };
      }
    }

    if (!existingLeadSnap.empty) {
      const existingLead = existingLeadSnap.docs[0]!.data() as Lead;
      if (existingLead.partnerOrgId !== input.partnerOrgId) {
        const conflictReg: LeadRegistration = {
          id: lockId,
          orgId: input.orgId,
          projectId: input.projectId,
          leadId: existingLead.id,
          partnerOrgId: existingLead.partnerOrgId ?? 'DIRECT_BUILDER_CRM',
          partnerMemberUid: actor.uid,
          customerName: input.customerName.trim(),
          normalizedPhone,
          source: 'CHANNEL_PARTNER',
          status: 'DISPUTED',
          protectedUntil: existingLead.protectionExpiresAt ?? nowIso,
          disputedByPartnerOrgId: input.partnerOrgId,
          conflictReason: 'Customer already exists in Builder CRM prior to partner registration.',
          registeredAt: nowIso,
          updatedAt: nowIso,
        };
        tx.set(regRef, conflictReg);
        return {
          registration: conflictReg,
          conflictDetected: true,
          leadId: existingLead.id,
        };
      }
    }

    // Clean registration: create protected lead & registration record
    const ingested = await ingestLeadService(db, actor, 'CHANNEL_PARTNER_AGENT', {
      orgId: input.orgId,
      customerName: input.customerName,
      phone: input.phone,
      email: input.email,
      source: 'CHANNEL_PARTNER',
      budgetMaxInr: input.budgetMaxInr,
      preferredProjectIds: [input.projectId],
      bhkPreference: input.bhkPreference,
      partnerOrgId: input.partnerOrgId,
      notes: input.notes,
    });

    const leadRef = db.collection('leads').doc(ingested.lead.id);
    tx.update(leadRef, {
      partnerOrgId: input.partnerOrgId,
      partnerAgentUid: actor.uid,
      protectionExpiresAt: protectedUntil,
      updatedAt: nowIso,
    });

    const registration: LeadRegistration = {
      id: lockId,
      orgId: input.orgId,
      projectId: input.projectId,
      leadId: ingested.lead.id,
      partnerOrgId: input.partnerOrgId,
      partnerMemberUid: actor.uid,
      customerName: input.customerName.trim(),
      normalizedPhone,
      source: 'CHANNEL_PARTNER',
      status: 'PROTECTED',
      protectedUntil,
      registeredAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(regRef, registration);

    const poRef = db.collection('partner_organizations').doc(input.partnerOrgId);
    const poSnap = await tx.get(poRef);
    if (poSnap.exists) {
      const po = poSnap.data() as PartnerOrganization;
      tx.update(poRef, {
        'metrics.registeredLeadsCount': (po.metrics?.registeredLeadsCount ?? 0) + 1,
        updatedAt: nowIso,
      });
    }

    return {
      registration,
      conflictDetected: false,
      leadId: ingested.lead.id,
    };
  });
}

export async function resolveLeadConflictService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    registrationId: string;
    winningPartnerOrgId: string | null; // null = Direct Builder CRM retains ownership
    resolutionNotes: string;
  }
): Promise<LeadRegistration> {
  const regRef = db.collection('lead_registrations').doc(params.registrationId);
  const snap = await regRef.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Lead registration record not found.');
  }
  const reg = snap.data() as LeadRegistration;
  const nowIso = new Date().toISOString();

  const updated: LeadRegistration = {
    ...reg,
    partnerOrgId: params.winningPartnerOrgId ?? 'DIRECT_BUILDER_CRM',
    status: params.winningPartnerOrgId ? 'PROTECTED' : 'REJECTED',
    resolvedByUid: actor.uid,
    resolutionNotes: params.resolutionNotes,
    updatedAt: nowIso,
  };
  await regRef.set(updated);

  await db.collection('leads').doc(reg.leadId).update({
    partnerOrgId: params.winningPartnerOrgId,
    updatedAt: nowIso,
  });

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    action: 'PARTNER_LEAD_CONFLICT_RESOLVED',
    category: 'APPROVAL',
    entityType: 'lead_registration',
    entityId: reg.id,
    summary: `Resolved disputed lead registration (${reg.normalizedPhone}): winner=${params.winningPartnerOrgId ?? 'Direct CRM'}.`,
  });

  return updated;
}

// --- Cloud Functions v2 Callables ---

export const onboardPartnerOrganization = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    companyName: z.string().min(2).max(140),
    contactName: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().min(10).max(16),
    reraNumber: z.string().optional(),
    gstin: z.string().optional(),
    officeCity: z.string().min(2).max(80),
    projectIds: z.array(z.string()).min(1),
    commissionPct: z.coerce.number().min(0).max(20),
    commissionTerms: z.string().min(3).max(400),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'partners:manage');
  return onboardPartnerOrganizationService(adminDb, actor, input);
});

export const registerPartnerLead = onCall(async (request) => {
  const parsed = registerPartnerLeadSchema.parse(request.data);
  // Allow either authorized Partner member OR Builder Sales Manager registering on partner's behalf
  try {
    const { actor } = await requirePartnerProjectScope(
      request,
      parsed.partnerOrgId,
      parsed.orgId,
      parsed.projectId,
      'partners:register_lead'
    );
    return registerPartnerLeadService(adminDb, actor, parsed);
  } catch {
    const { actor } = await requireOrgPermission(
      request,
      parsed.orgId,
      'partners:manage',
      parsed.projectId
    );
    return registerPartnerLeadService(adminDb, actor, parsed);
  }
});

export const resolvePartnerLeadConflict = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    registrationId: z.string().min(1),
    winningPartnerOrgId: z.string().nullable(),
    resolutionNotes: z.string().min(3).max(400),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'partners:resolve_conflict');
  return resolveLeadConflictService(adminDb, actor, input);
});
