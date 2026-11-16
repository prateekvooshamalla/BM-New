import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { DocumentRecord, FloorPlanVersion, Unit } from '@bharat-makaan/shared';
import {
  mapFloorPlanVersionSchema,
  registerDocumentMetadataSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { parseCallableInput } from '../shared/validation';
import { writeAuditEvent } from '../audit';
import { isAiFloorPlanStoragePath } from './ai-floorplan-path';

export async function registerDocumentService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<DocumentRecord> {
  const input = registerDocumentMetadataSchema.parse(rawInput);
  const nowIso = new Date().toISOString();
  const ref = db.collection('documents').doc();

  const docRecord: DocumentRecord = {
    id: ref.id,
    orgId: input.orgId,
    projectId: input.projectId ?? null,
    towerId: input.towerId ?? null,
    floorId: input.floorId ?? null,
    unitId: input.unitId ?? null,
    category: input.category,
    title: input.title.trim(),
    fileName: input.fileName.trim(),
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storagePath: input.storagePath,
    currentVersion: 1,
    versionHistory: [
      {
        version: 1,
        storagePath: input.storagePath,
        fileName: input.fileName.trim(),
        uploadedByUid: actor.uid,
        uploadedAt: nowIso,
      },
    ],
    visibility: input.visibility,
    watermarkEnabled: input.watermarkEnabled,
    shareLinks: [],
    uploadedByUid: actor.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ref.set(docRecord);
  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'DOCUMENT_UPLOADED',
    category: 'DOCUMENT',
    entityType: 'document',
    entityId: docRecord.id,
    summary: `Uploaded ${docRecord.category} "${docRecord.title}" (v1).`,
  });

  return docRecord;
}

export async function replaceDocumentVersionService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  params: {
    orgId: string;
    documentId: string;
    newStoragePath: string;
    newFileName: string;
    sizeBytes: number;
    newTitle?: string;
  }
): Promise<DocumentRecord> {
  const ref = db.collection('documents').doc(params.documentId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Document not found.');
  }

  const prev = snap.data() as DocumentRecord;
  const nextVer = prev.currentVersion + 1;
  const nowIso = new Date().toISOString();

  const updated: DocumentRecord = {
    ...prev,
    title: params.newTitle?.trim() || prev.title,
    fileName: params.newFileName.trim(),
    sizeBytes: params.sizeBytes,
    storagePath: params.newStoragePath,
    currentVersion: nextVer,
    versionHistory: [
      ...prev.versionHistory,
      {
        version: nextVer,
        storagePath: params.newStoragePath,
        fileName: params.newFileName.trim(),
        uploadedByUid: actor.uid,
        uploadedAt: nowIso,
      },
    ],
    updatedAt: nowIso,
  };

  await ref.set(updated);
  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'DOCUMENT_VERSION_REPLACED',
    category: 'DOCUMENT',
    entityType: 'document',
    entityId: updated.id,
    summary: `Replaced "${updated.title}" with version v${nextVer}.`,
    before: { version: prev.currentVersion, fileName: prev.fileName },
    after: { version: nextVer, fileName: updated.fileName },
  });

  return updated;
}

/**
 * Maps a floor plan version to explicit Towers, Floor Category (e.g. TYPICAL vs PODIUM),
 * Floor Range (`minFloor`..`maxFloor`), and Unit Types/BHKs — preventing typical upper-floor
 * plans from mistakenly applying to podium or lower residential floors!
 */
export async function mapFloorPlanToUnitsService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<{ floorPlanVersion: FloorPlanVersion; matchedUnitsCount: number }> {
  const input = mapFloorPlanVersionSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  const existingSnap = await db
    .collection('floor_plan_versions')
    .where('orgId', '==', input.orgId)
    .where('documentId', '==', input.documentId)
    .get();
  const nextVer = existingSnap.size + 1;

  const ref = db.collection('floor_plan_versions').doc();
  const fpVersion: FloorPlanVersion = {
    id: ref.id,
    orgId: input.orgId,
    documentId: input.documentId,
    projectId: input.projectId,
    towerIds: input.towerIds,
    floorCategory: input.floorCategory,
    minFloor: input.minFloor,
    maxFloor: input.maxFloor,
    applicableUnitTypes: input.applicableUnitTypes,
    applicableBhk: input.applicableBhk,
    carpetAreaSqft: input.carpetAreaSqft,
    saleableAreaSqft: input.saleableAreaSqft,
    versionNumber: nextVer,
    storagePath: input.storagePath,
    fileName: input.fileName,
    createdByUid: actor.uid,
    createdAt: nowIso,
  };

  await ref.set(fpVersion);

  // Link only matching units inside the exact tower + floor range + unit type + BHK
  const unitsSnap = await db
    .collection('units')
    .where('orgId', '==', input.orgId)
    .where('projectId', '==', input.projectId)
    .get();

  const batch = db.batch();
  let matchedUnitsCount = 0;

  for (const unitDoc of unitsSnap.docs) {
    const unit = unitDoc.data() as Unit;
    if (input.towerIds.length > 0 && (!unit.towerId || !input.towerIds.includes(unit.towerId))) {
      continue;
    }
    if (unit.floorNumber < input.minFloor || unit.floorNumber > input.maxFloor) continue;
    if (!input.applicableUnitTypes.includes(unit.unitType)) continue;
    if (!input.applicableBhk.includes(unit.bhk)) continue;

    batch.update(unitDoc.ref, {
      floorPlanVersionId: fpVersion.id,
      updatedAt: nowIso,
    });
    matchedUnitsCount++;
  }

  await batch.commit();

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'FLOOR_PLAN_MAPPED',
    category: 'DOCUMENT',
    entityType: 'floor_plan_version',
    entityId: fpVersion.id,
    summary: `Mapped ${input.floorCategory} floor plan (Floors ${input.minFloor}-${input.maxFloor}) to ${matchedUnitsCount} unit(s).`,
  });

  return { floorPlanVersion: fpVersion, matchedUnitsCount };
}

export async function createExpiringShareLinkService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  params: { orgId: string; documentId: string; expiresInHours: number }
): Promise<{ tokenId: string; expiresAt: string }> {
  const ref = db.collection('documents').doc(params.documentId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Document not found.');
  }

  const docRec = snap.data() as DocumentRecord;
  const tokenId = crypto.randomBytes(18).toString('hex');
  const expiresAt = new Date(Date.now() + params.expiresInHours * 3600 * 1000).toISOString();

  await ref.update({
    shareLinks: [
      ...docRec.shareLinks,
      {
        tokenId,
        expiresAt,
        createdByUid: actor.uid,
        revoked: false,
      },
    ],
    updatedAt: new Date().toISOString(),
  });

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'DOCUMENT_SHARE_LINK_CREATED',
    category: 'DOCUMENT',
    entityType: 'document',
    entityId: docRec.id,
    summary: `Created expiring share link (${params.expiresInHours}h) for "${docRec.title}".`,
  });

  return { tokenId, expiresAt };
}

// --- Cloud Functions v2 Callables ---

export const registerDocument = onCall(async (request) => {
  const parsed = parseCallableInput(registerDocumentMetadataSchema, request.data);
  let actor: AuthenticatedActor;
  let member: Awaited<ReturnType<typeof requireOrgPermission>>['member'];

  try {
    ({ actor, member } = await requireOrgPermission(
      request,
      parsed.orgId,
      'documents:upload',
      parsed.projectId
    ));
  } catch (error) {
    if (
      !isAiFloorPlanStoragePath(parsed) ||
      !(error instanceof HttpsError) ||
      error.code !== 'permission-denied'
    ) {
      throw error;
    }
    ({ actor, member } = await requireOrgPermission(
      request,
      parsed.orgId,
      'ai:use',
      parsed.projectId
    ));
  }

  return registerDocumentService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const replaceDocumentVersion = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    documentId: z.string().min(1),
    newStoragePath: z.string().min(5),
    newFileName: z.string().min(1),
    sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
    newTitle: z.string().optional(),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'documents:manage_versions'
  );
  return replaceDocumentVersionService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    input
  );
});

export const mapFloorPlanVersion = onCall(async (request) => {
  const parsed = mapFloorPlanVersionSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'documents:manage_versions',
    parsed.projectId
  );
  return mapFloorPlanToUnitsService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const createDocumentShareLink = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    documentId: z.string().min(1),
    expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'documents:share_external'
  );
  return createExpiringShareLinkService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    input
  );
});

export const resolveSharedDocumentLink = onCall(async (request) => {
  const schema = z.object({
    tokenId: z.string().min(8).max(128),
  });
  const { tokenId } = schema.parse(request.data);

  const snap = await adminDb.collection('documents').get();
  for (const docSnap of snap.docs) {
    const rec = docSnap.data() as DocumentRecord;
    const link = (rec.shareLinks ?? []).find((l) => l.tokenId === tokenId && !l.revoked);
    if (link) {
      if (Date.parse(link.expiresAt) > Date.now()) {
        return {
          valid: true,
          document: {
            id: rec.id,
            title: rec.title,
            category: rec.category,
            fileName: rec.fileName,
            mimeType: rec.mimeType,
            sizeBytes: rec.sizeBytes,
            currentVersion: rec.currentVersion,
            watermarkEnabled: rec.watermarkEnabled,
            storagePath: rec.storagePath,
          },
          expiresAt: link.expiresAt,
        };
      }
      return { valid: false, document: null };
    }
  }
  return { valid: false, document: null };
});
