import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  calculateCostSheet,
  toMinorUnits,
  type AiImportJob,
  type AiInventoryDraft,
  type DocumentRecord,
  type Floor,
  type FloorPlanVersion,
  type LeadActivity,
  type ParkingSlot,
  type PriceBook,
  type PricingScopeOverride,
  type Project,
  type Tower,
  type Unit,
} from '@bharat-makaan/shared';
import {
  cancelAiDraftSchema,
  confirmAndCommitAiDraftSchema,
} from '@bharat-makaan/validation';
import type { AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';
import {
  recomputeDraftPreviewAndConflicts,
  verifyAiSubjectPermission,
} from './tools';

const CHUNK_SIZE = 150;

function sanitizeDocIdToken(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_');
}

/**
 * Cancels a staged `AiInventoryDraft` cleanly before execution.
 * Guarantees zero unintended towers, floors, or units are left in production collections.
 */
export async function cancelInventoryDraftService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<AiInventoryDraft> {
  const input = cancelAiDraftSchema.parse(rawInput);
  const draftRef = db.collection('ai_inventory_drafts').doc(input.draftId);
  const snap = await draftRef.get();
  if (!snap.exists || snap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'AI inventory draft not found.');
  }

  const draft = snap.data() as AiInventoryDraft;
  await verifyAiSubjectPermission({
    db,
    actor,
    orgId: input.orgId,
    requiredPermission: 'inventory:view',
    targetProjectId: draft.projectId,
    disallowChannelPartner: true,
  });

  if (draft.status === 'COMMITTED') {
    throw new HttpsError(
      'failed-precondition',
      'Committed drafts cannot be cancelled retroactively.'
    );
  }

  const nowIso = new Date().toISOString();
  const cancelled: AiInventoryDraft = {
    ...draft,
    status: 'CANCELLED',
    updatedAt: nowIso,
  };
  await draftRef.set(cancelled);

  if (input.sessionId) {
    const sessRef = db.collection('ai_sessions').doc(input.sessionId);
    const sessSnap = await sessRef.get();
    if (sessSnap.exists && sessSnap.data()?.orgId === input.orgId) {
      await sessRef.update({
        confirmationState: 'CANCELLED',
        updatedAt: nowIso,
      });
    }
  }

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'AI_INVENTORY_DRAFT_CANCELLED',
    category: 'AI',
    entityType: 'ai_inventory_draft',
    entityId: draft.id,
    summary: `Cancelled staged AI inventory draft (${draft.id}). Reason: ${input.reason || 'User cancelled review'}.`,
  });

  return cancelled;
}

/**
 * Recomputes authoritative `Project` hierarchy & availability counters directly
 * from persisted Firestore records (never hardcoded or manually guessed!).
 */
export async function syncProjectActualInventoryCounts(
  db: Firestore,
  orgId: string,
  projectId: string
): Promise<void> {
  const projRef = db.collection('projects').doc(projectId);
  const [projSnap, phasesSnap, towersSnap, floorsSnap, unitsSnap] = await Promise.all([
    projRef.get(),
    db
      .collection('project_phases')
      .where('orgId', '==', orgId)
      .where('projectId', '==', projectId)
      .get(),
    db
      .collection('towers')
      .where('orgId', '==', orgId)
      .where('projectId', '==', projectId)
      .get(),
    db
      .collection('floors')
      .where('orgId', '==', orgId)
      .where('projectId', '==', projectId)
      .get(),
    db
      .collection('units')
      .where('orgId', '==', orgId)
      .where('projectId', '==', projectId)
      .get(),
  ]);

  if (!projSnap.exists) return;
  const proj = projSnap.data() as Project;
  const units = unitsSnap.docs.map((d) => d.data() as Unit);

  const counts = {
    totalUnits: units.length,
    availableUnits: 0,
    onHoldUnits: 0,
    reservedUnits: 0,
    bookedUnits: 0,
    agreementUnits: 0,
    registeredUnits: 0,
  };

  let minPositivePrice: number | undefined;
  for (const u of units) {
    if (u.status === 'AVAILABLE') counts.availableUnits++;
    else if (u.status === 'ON_HOLD') counts.onHoldUnits++;
    else if (u.status === 'RESERVED') counts.reservedUnits++;
    else if (u.status === 'BOOKED') counts.bookedUnits++;
    else if (u.status === 'AGREEMENT') counts.agreementUnits++;
    else if (u.status === 'REGISTERED') counts.registeredUnits++;

    if (u.calculatedTotalPrice > 0) {
      if (minPositivePrice === undefined || u.calculatedTotalPrice < minPositivePrice) {
        minPositivePrice = u.calculatedTotalPrice;
      }
    }
  }

  await projRef.update({
    totalPhases: phasesSnap.size,
    totalTowers: towersSnap.size,
    totalFloors: floorsSnap.size,
    totalUnits: units.length,
    ...(minPositivePrice !== undefined ? { startingPriceInr: minPositivePrice } : {}),
    stats: {
      ...proj.stats,
      ...counts,
    },
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Commits an approved `AiInventoryDraft` using idempotent deterministic IDs and
 * chunked batches (`<= 150` operations per batch) with checkpoint tracking.
 */
export async function commitApprovedInventoryDraftService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<{ job: AiImportJob; draft: AiInventoryDraft }> {
  const input = confirmAndCommitAiDraftSchema.parse(rawInput);

  // 1. Check idempotency: if a COMPLETED job already exists for this idempotencyKey or draftId, return it immediately!
  const existingJobSnap = await db
    .collection('ai_import_jobs')
    .where('orgId', '==', input.orgId)
    .where('idempotencyKey', '==', input.idempotencyKey)
    .limit(1)
    .get();

  const draftRef = db.collection('ai_inventory_drafts').doc(input.draftId);
  const draftSnap = await draftRef.get();
  if (!draftSnap.exists || draftSnap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'Staged AI draft not found in organization.');
  }

  const rawDraft = draftSnap.data() as AiInventoryDraft;

  if (!existingJobSnap.empty) {
    const existingJob = existingJobSnap.docs[0]!.data() as AiImportJob;
    if (existingJob.status === 'COMPLETED') {
      return { job: existingJob, draft: rawDraft };
    }
  }

  if (rawDraft.status === 'COMMITTED' && rawDraft.committedJobId) {
    const prevJobSnap = await db.collection('ai_import_jobs').doc(rawDraft.committedJobId).get();
    if (prevJobSnap.exists) {
      return { job: prevJobSnap.data() as AiImportJob, draft: rawDraft };
    }
  }

  if (rawDraft.status === 'CANCELLED') {
    throw new HttpsError('failed-precondition', 'Cannot commit a cancelled draft.');
  }

  if (!rawDraft.projectId) {
    throw new HttpsError(
      'failed-precondition',
      'Target project must be selected before committing inventory.'
    );
  }

  // Handle auxiliary CRM follow-up task or parking batch drafts cleanly
  if (rawDraft.draftKind === 'FOLLOW_UP_TASK') {
    await verifyAiSubjectPermission({
      db,
      actor,
      orgId: input.orgId,
      requiredPermission: 'leads:edit',
      targetProjectId: rawDraft.projectId,
      disallowChannelPartner: true,
    });
    const payload = (rawDraft.auxiliaryPayload ?? {}) as {
      leadId?: string;
      title?: string;
      body?: string;
      dueAt?: string;
    };
    if (!payload.leadId || !payload.title) {
      throw new HttpsError('failed-precondition', 'Lead ID and task title are required.');
    }
    const nowIso = new Date().toISOString();
    const actId = `${rawDraft.id}_task`;
    const act: LeadActivity = {
      id: actId,
      orgId: input.orgId,
      leadId: payload.leadId,
      type: 'FOLLOW_UP',
      title: payload.title,
      body: payload.body,
      dueAt: payload.dueAt,
      completedAt: null,
      performedByUid: actor.uid,
      createdAt: nowIso,
    };
    await db.collection('lead_activities').doc(actId).set(act);
    const jobId = `job_${rawDraft.id}`;
    const job: AiImportJob = {
      id: jobId,
      idempotencyKey: input.idempotencyKey,
      orgId: input.orgId,
      projectId: rawDraft.projectId,
      draftId: rawDraft.id,
      sessionId: input.sessionId ?? rawDraft.sessionId,
      requestedByUid: actor.uid,
      status: 'COMPLETED',
      totalOperations: 1,
      completedOperations: 1,
      currentChunkIndex: 1,
      totalChunks: 1,
      checkpoints: [{ chunkIndex: 1, entityType: 'AUXILIARY', count: 1, committedAt: nowIso }],
      createdEntityIds: { towerIds: [], floorIds: [], unitIds: [], floorPlanVersionIds: [] },
      startedAt: nowIso,
      completedAt: nowIso,
      updatedAt: nowIso,
    };
    await db.collection('ai_import_jobs').doc(jobId).set(job);
    const updatedDraft: AiInventoryDraft = {
      ...rawDraft,
      status: 'COMMITTED',
      committedJobId: jobId,
      updatedAt: nowIso,
    };
    await draftRef.set(updatedDraft);
    return { job, draft: updatedDraft };
  }

  if (rawDraft.draftKind === 'PARKING_LAYOUT') {
    await verifyAiSubjectPermission({
      db,
      actor,
      orgId: input.orgId,
      requiredPermission: 'parking:manage',
      targetProjectId: rawDraft.projectId,
      disallowChannelPartner: true,
    });
    const slotsSpec = ((rawDraft.auxiliaryPayload?.slots ?? []) as Array<{
      levelType: ParkingSlot['levelType'];
      levelName: string;
      zone: string;
      slotNumber: string;
      parkingType: ParkingSlot['parkingType'];
      priceInr: number;
    }>);
    const nowIso = new Date().toISOString();
    const batch = db.batch();
    for (const s of slotsSpec) {
      const slotId = `${rawDraft.projectId}_${sanitizeDocIdToken(s.levelName)}_${sanitizeDocIdToken(s.slotNumber)}`;
      const slotDoc: ParkingSlot = {
        id: slotId,
        orgId: input.orgId,
        projectId: rawDraft.projectId,
        levelType: s.levelType,
        levelName: s.levelName,
        zone: s.zone,
        slotNumber: s.slotNumber,
        parkingType: s.parkingType,
        priceInr: s.priceInr,
        status: 'AVAILABLE',
        allocatedUnitId: null,
        allocatedUnitNumber: null,
        allocatedBookingId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      batch.set(db.collection('parking_slots').doc(slotId), slotDoc);
    }
    await batch.commit();
    const jobId = `job_${rawDraft.id}`;
    const job: AiImportJob = {
      id: jobId,
      idempotencyKey: input.idempotencyKey,
      orgId: input.orgId,
      projectId: rawDraft.projectId,
      draftId: rawDraft.id,
      sessionId: input.sessionId ?? rawDraft.sessionId,
      requestedByUid: actor.uid,
      status: 'COMPLETED',
      totalOperations: slotsSpec.length,
      completedOperations: slotsSpec.length,
      currentChunkIndex: 1,
      totalChunks: 1,
      checkpoints: [
        { chunkIndex: 1, entityType: 'PARKING', count: slotsSpec.length, committedAt: nowIso },
      ],
      createdEntityIds: { towerIds: [], floorIds: [], unitIds: [], floorPlanVersionIds: [] },
      startedAt: nowIso,
      completedAt: nowIso,
      updatedAt: nowIso,
    };
    await db.collection('ai_import_jobs').doc(jobId).set(job);
    const updatedDraft: AiInventoryDraft = {
      ...rawDraft,
      status: 'COMMITTED',
      committedJobId: jobId,
      updatedAt: nowIso,
    };
    await draftRef.set(updatedDraft);
    return { job, draft: updatedDraft };
  }

  // 2. Enforce strict server-side `inventory:manage` permission (blocks unauthorized staff & channel partners!)
  const subject = await verifyAiSubjectPermission({
    db,
    actor,
    orgId: input.orgId,
    requiredPermission: 'inventory:manage',
    targetProjectId: rawDraft.projectId,
    disallowChannelPartner: true,
  });

  // 3. Re-validate live conflicts right before execution (do NOT rebuild user-edited unit rows!)
  const verifiedDraft = await recomputeDraftPreviewAndConflicts(db, rawDraft, false);
  const blockingErrors = verifiedDraft.conflicts.filter((c) => c.severity === 'ERROR');
  if (blockingErrors.length > 0 || verifiedDraft.missingQuestions.some((q) => q.required)) {
    throw new HttpsError(
      'failed-precondition',
      `Draft cannot be committed until conflicts and missing fields are resolved: ${
        blockingErrors[0]?.message ?? verifiedDraft.missingQuestions[0]?.question ?? 'Validation failed'
      }`
    );
  }

  const projSnap = await db.collection('projects').doc(verifiedDraft.projectId!).get();
  if (!projSnap.exists || projSnap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'Target project not found.');
  }
  const project = projSnap.data() as Project;

  // Load active price book & overrides (never fabricate prices if none active!)
  const [activePbSnap, overridesSnap] = await Promise.all([
    db
      .collection('price_books')
      .where('orgId', '==', input.orgId)
      .where('projectId', '==', project.id)
      .where('status', '==', 'ACTIVE')
      .limit(1)
      .get(),
    db.collection('pricing_overrides').where('orgId', '==', input.orgId).get(),
  ]);
  const activePriceBook = activePbSnap.empty
    ? null
    : (activePbSnap.docs[0]!.data() as PriceBook);
  const overrides = overridesSnap.docs.map((d) => d.data() as PricingScopeOverride);

  const nowIso = new Date().toISOString();
  const jobId = `job_${verifiedDraft.id}`;
  const jobRef = db.collection('ai_import_jobs').doc(jobId);

  const isTowerBased =
    verifiedDraft.propertyCategory === 'APARTMENT' ||
    verifiedDraft.propertyCategory === 'COMMERCIAL';

  let targetTowerId = verifiedDraft.towerSpec.existingTowerId ?? null;
  let targetTowerName = verifiedDraft.towerSpec.name;
  const createdTowerIds: string[] = [];
  const createdFloorIds: string[] = [];
  const createdUnitIds: string[] = [];
  const createdFpIds: string[] = [];

  const activeUnits = verifiedDraft.proposedUnits.filter((u) => u.operation !== 'SKIP');
  const distinctFloors = isTowerBased
    ? Array.from(
        new Set([
          ...activeUnits.map((u) => u.floorNumber),
          ...(verifiedDraft.towerSpec.refugeFloors ?? []),
        ])
      ).sort((a, b) => a - b)
    : [];

  const totalOps =
    (isTowerBased && !targetTowerId ? 1 : 0) +
    distinctFloors.length +
    activeUnits.length +
    verifiedDraft.linkedDocumentIds.length;

  const totalChunks = Math.max(1, Math.ceil(Math.max(1, activeUnits.length) / CHUNK_SIZE) + 1);

  let job: AiImportJob = {
    id: jobId,
    idempotencyKey: input.idempotencyKey,
    orgId: input.orgId,
    projectId: project.id,
    draftId: verifiedDraft.id,
    sessionId: input.sessionId ?? verifiedDraft.sessionId,
    requestedByUid: actor.uid,
    status: 'RUNNING',
    totalOperations: totalOps,
    completedOperations: 0,
    currentChunkIndex: 0,
    totalChunks,
    checkpoints: [],
    createdEntityIds: {
      towerIds: [],
      floorIds: [],
      unitIds: [],
      floorPlanVersionIds: [],
    },
    startedAt: nowIso,
    updatedAt: nowIso,
  };

  await jobRef.set(job);
  await draftRef.update({ status: 'COMMITTING', updatedAt: nowIso });

  try {
    // CHUNK 1: Tower & Floors (idempotent deterministic IDs)
    const structBatch = db.batch();
    let structOps = 0;

    const towerName = verifiedDraft.towerSpec.name;
    if (isTowerBased && !targetTowerId && towerName) {
      const existingTowers = await db
        .collection('towers')
        .where('orgId', '==', input.orgId)
        .where('projectId', '==', project.id)
        .get();
      const existingMatch = existingTowers.docs.find(
        (d) => (d.data() as Tower).name.trim().toLowerCase() === towerName.trim().toLowerCase()
      );

      if (existingMatch) {
        targetTowerId = existingMatch.id;
        targetTowerName = (existingMatch.data() as Tower).name;
      } else {
        const code = (
          verifiedDraft.towerSpec.code ||
          towerName.replace(/[^A-Za-z0-9]/g, '').slice(0, 6) ||
          'T1'
        ).toUpperCase();
        targetTowerId = `${verifiedDraft.id}_tw_${sanitizeDocIdToken(code)}`;
        targetTowerName = towerName.trim();

        const towerDoc: Tower = {
          id: targetTowerId,
          orgId: input.orgId,
          projectId: project.id,
          phaseId: verifiedDraft.phaseId ?? verifiedDraft.towerSpec.phaseId ?? null,
          name: targetTowerName,
          code,
          towerType: verifiedDraft.towerSpec.towerType ?? 'TOWER',
          totalFloors: verifiedDraft.towerSpec.totalFloors ?? distinctFloors.length,
          basementLevels: verifiedDraft.towerSpec.basementLevels ?? 1,
          podiumLevels: verifiedDraft.towerSpec.podiumLevels ?? 0,
          unitsPerFloorTypical:
            verifiedDraft.floorTemplates[0]?.unitsPerFloor ?? 4,
          status: 'ACTIVE',
          createdAt: nowIso,
        };
        structBatch.set(db.collection('towers').doc(targetTowerId), towerDoc);
        createdTowerIds.push(targetTowerId);
        structOps++;
      }
    }

    const floorIdByNumber = new Map<number, string>();
    const refugeSet = new Set(verifiedDraft.towerSpec.refugeFloors ?? []);

    for (const flNo of distinctFloors) {
      const floorId = `${verifiedDraft.id}_fl_${sanitizeDocIdToken(targetTowerId ?? 'direct')}_${flNo}`;
      floorIdByNumber.set(flNo, floorId);
      const unitsOnFl = activeUnits.filter((u) => u.floorNumber === flNo);
      const flCat = refugeSet.has(flNo)
        ? 'REFUGE'
        : (unitsOnFl[0]?.floorCategory ?? 'TYPICAL');

      const floorDoc: Floor = {
        id: floorId,
        orgId: input.orgId,
        projectId: project.id,
        phaseId: verifiedDraft.phaseId ?? null,
        towerId: targetTowerId ?? 'DIRECT',
        floorNumber: flNo,
        label: refugeSet.has(flNo)
          ? `Floor ${flNo} (Refuge)`
          : flNo === 0
            ? 'Ground / Lobby'
            : `Floor ${flNo}`,
        floorCategory: flCat,
        totalUnits: unitsOnFl.length,
        createdAt: nowIso,
      };
      structBatch.set(db.collection('floors').doc(floorId), floorDoc);
      createdFloorIds.push(floorId);
      structOps++;
    }

    // Prepare FloorPlanVersion mappings for any linked documents BEFORE writing units so units get `floorPlanVersionId`!
    const docIdToFpVersionId = new Map<string, string>();
    for (const docId of verifiedDraft.linkedDocumentIds) {
      const docSnap = await db.collection('documents').doc(docId).get();
      if (!docSnap.exists || docSnap.data()?.orgId !== input.orgId) continue;
      const docRec = docSnap.data() as DocumentRecord;

      const fpId = `${verifiedDraft.id}_fp_${sanitizeDocIdToken(docId)}`;
      const docUnits = activeUnits.filter(
        (u) => u.floorPlanDocumentId === docId || verifiedDraft.linkedDocumentIds.length === 1
      );
      const minFl =
        docUnits.length > 0 ? Math.min(...docUnits.map((u) => u.floorNumber)) : 0;
      const maxFl =
        docUnits.length > 0 ? Math.max(...docUnits.map((u) => u.floorNumber)) : 0;
      const uTypes = Array.from(
        new Set(docUnits.map((u) => u.unitType))
      ) as Unit['unitType'][];
      const bhks = Array.from(new Set(docUnits.map((u) => u.bhk)));

      const fpDoc: FloorPlanVersion = {
        id: fpId,
        orgId: input.orgId,
        documentId: docRec.id,
        projectId: project.id,
        towerIds: targetTowerId ? [targetTowerId] : [],
        floorCategory: docUnits[0]?.floorCategory ?? 'TYPICAL',
        minFloor: minFl,
        maxFloor: maxFl,
        applicableUnitTypes: uTypes.length > 0 ? uTypes : ['APARTMENT'],
        applicableBhk: bhks.length > 0 ? bhks : ['3 BHK'],
        carpetAreaSqft: docUnits[0]?.carpetAreaSqft ?? 1200,
        saleableAreaSqft: docUnits[0]?.saleableAreaSqft ?? 1700,
        versionNumber: 1,
        storagePath: docRec.storagePath,
        fileName: docRec.fileName,
        createdByUid: actor.uid,
        createdAt: nowIso,
      };
      structBatch.set(db.collection('floor_plan_versions').doc(fpId), fpDoc);
      // Link document to tower/project as well
      structBatch.update(db.collection('documents').doc(docRec.id), {
        projectId: project.id,
        towerId: targetTowerId ?? docRec.towerId ?? null,
        updatedAt: nowIso,
      });
      docIdToFpVersionId.set(docId, fpId);
      createdFpIds.push(fpId);
      structOps++;
    }

    if (structOps > 0) {
      await structBatch.commit();
      job = {
        ...job,
        completedOperations: job.completedOperations + structOps,
        currentChunkIndex: 1,
        checkpoints: [
          ...job.checkpoints,
          {
            chunkIndex: 1,
            entityType: 'TOWER',
            count: structOps,
            committedAt: new Date().toISOString(),
          },
        ],
      };
      await jobRef.set(job);
    }

    // CHUNKS 2..N: Units in chunks of `<= 150` with deterministic IDs
    const currencyCode = project.currencyCode ?? 'INR';
    const areaUnit = project.areaUnit ?? 'SQFT';

    for (let offset = 0; offset < activeUnits.length; offset += CHUNK_SIZE) {
      const slice = activeUnits.slice(offset, offset + CHUNK_SIZE);
      const unitBatch = db.batch();

      for (const pu of slice) {
        const unitId =
          pu.operation === 'UPDATE' && pu.existingUnitId
            ? pu.existingUnitId
            : `${verifiedDraft.id}_un_${sanitizeDocIdToken(pu.unitNumber)}`;

        // Double-check protected status if updating an existing unit
        if (pu.operation === 'UPDATE' && pu.existingUnitId) {
          const exSnap = await db.collection('units').doc(pu.existingUnitId).get();
          if (exSnap.exists) {
            const ex = exSnap.data() as Unit;
            if (
              ex.status === 'BOOKED' ||
              ex.status === 'AGREEMENT' ||
              ex.status === 'REGISTERED'
            ) {
              throw new HttpsError(
                'failed-precondition',
                `Aborted: Unit ${ex.unitNumber} is ${ex.status} and cannot be modified.`
              );
            }
          }
        }

        const resolvedFpVersionId = pu.floorPlanDocumentId
          ? (docIdToFpVersionId.get(pu.floorPlanDocumentId) ?? null)
          : verifiedDraft.linkedDocumentIds.length === 1
            ? (docIdToFpVersionId.get(verifiedDraft.linkedDocumentIds[0]!) ?? null)
            : null;

        let baseRate = 0;
        let floorRiseAmt = 0;
        let premiumAmt = 0;
        let totalPrice = 0;

        if (activePriceBook) {
          const tempUnitForCalc: Unit = {
            id: unitId,
            orgId: input.orgId,
            projectId: project.id,
            phaseId: verifiedDraft.phaseId ?? null,
            towerId: targetTowerId,
            towerName: targetTowerName,
            floorId: floorIdByNumber.get(pu.floorNumber) ?? null,
            floorNumber: pu.floorNumber,
            unitNumber: pu.unitNumber.trim().toUpperCase(),
            unitType: pu.unitType,
            bhk: pu.bhk,
            currencyCode,
            areaUnit,
            saleableAreaSqft: pu.saleableAreaSqft,
            carpetAreaSqft: pu.carpetAreaSqft,
            facing: pu.facing,
            isCorner: pu.isCorner,
            balconiesCount: pu.balconiesCount,
            parkingEntitlementCount: pu.parkingEntitlementCount,
            assignedParkingSlotIds: [],
            baseRatePerSqft: activePriceBook.basePricePerSqft,
            floorRiseAmount: 0,
            premiumChargesAmount: 0,
            calculatedTotalPrice: 0,
            status: 'AVAILABLE',
            isPublicPublished: false,
            listingMode: 'BUY',
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          const computed = calculateCostSheet({
            unit: tempUnitForCalc,
            priceBook: activePriceBook,
            overrides,
          });
          baseRate = computed.baseRatePerSqft;
          floorRiseAmt = computed.floorRiseInr;
          premiumAmt =
            computed.facingPremiumInr +
            computed.viewPremiumInr +
            computed.cornerPremiumInr +
            computed.locationPremiumInr +
            computed.unitSpecificPremiumInr;
          totalPrice = computed.totalPayableInr;
        }

        const unitDoc: Unit = {
          id: unitId,
          orgId: input.orgId,
          projectId: project.id,
          phaseId: verifiedDraft.phaseId ?? null,
          towerId: targetTowerId,
          towerName: targetTowerName,
          floorId: floorIdByNumber.get(pu.floorNumber) ?? null,
          floorNumber: pu.floorNumber,
          unitNumber: pu.unitNumber.trim().toUpperCase(),
          unitType: pu.unitType,
          inventorySource: 'PRIMARY_DEVELOPER',
          bhk: pu.bhk.trim(),
          currencyCode,
          areaUnit,
          primaryArea: pu.saleableAreaSqft,
          secondaryArea: pu.carpetAreaSqft,
          saleableAreaSqft: pu.saleableAreaSqft,
          carpetAreaSqft: pu.carpetAreaSqft,
          facing: pu.facing,
          isCorner: pu.isCorner,
          balconiesCount: pu.balconiesCount,
          parkingEntitlementCount: pu.parkingEntitlementCount,
          assignedParkingSlotIds: [],
          pricingMode: 'PER_AREA',
          baseRatePerSqft: baseRate,
          activePriceBookId: activePriceBook?.id,
          floorRiseAmount: floorRiseAmt,
          premiumChargesAmount: premiumAmt,
          calculatedTotalPrice: totalPrice,
          calculatedTotalMinor: toMinorUnits(totalPrice, currencyCode),
          status: 'AVAILABLE',
          holdExpiresAt: null,
          heldByUid: null,
          heldForLeadId: null,
          activeBookingId: null,
          floorPlanVersionId: resolvedFpVersionId,
          isPublicPublished: false, // NEVER auto-publish AI-imported inventory!
          listingMode: 'BUY',
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        unitBatch.set(db.collection('units').doc(unitId), unitDoc);
        createdUnitIds.push(unitId);
      }

      await unitBatch.commit();
      const chunkNo = Math.floor(offset / CHUNK_SIZE) + 2;
      job = {
        ...job,
        completedOperations: job.completedOperations + slice.length,
        currentChunkIndex: chunkNo,
        checkpoints: [
          ...job.checkpoints,
          {
            chunkIndex: chunkNo,
            entityType: 'UNIT',
            count: slice.length,
            committedAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      await jobRef.set(job);
    }

    // Recompute authoritative project inventory statistics
    await syncProjectActualInventoryCounts(db, input.orgId, project.id);

    const completedIso = new Date().toISOString();
    const finalJob: AiImportJob = {
      ...job,
      status: 'COMPLETED',
      createdEntityIds: {
        towerIds: createdTowerIds,
        floorIds: createdFloorIds,
        unitIds: createdUnitIds,
        floorPlanVersionIds: createdFpIds,
      },
      completedAt: completedIso,
      updatedAt: completedIso,
    };
    await jobRef.set(finalJob);

    const committedDraft: AiInventoryDraft = {
      ...verifiedDraft,
      status: 'COMMITTED',
      committedJobId: finalJob.id,
      updatedAt: completedIso,
    };
    await draftRef.set(committedDraft);

    if (input.sessionId) {
      const sessRef = db.collection('ai_sessions').doc(input.sessionId);
      const sessSnap = await sessRef.get();
      if (sessSnap.exists && sessSnap.data()?.orgId === input.orgId) {
        await sessRef.update({
          confirmationState: 'COMPLETED',
          executionJobId: finalJob.id,
          updatedAt: completedIso,
        });
      }
    }

    await writeAuditEvent(db, {
      orgId: input.orgId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: subject.role,
      action: 'AI_INVENTORY_IMPORT_COMMITTED',
      category: 'INVENTORY',
      entityType: 'ai_import_job',
      entityId: finalJob.id,
      summary: `Committed AI inventory draft (${committedDraft.id}) into project "${project.name}": ${createdTowerIds.length} tower(s), ${createdFloorIds.length} floor(s), ${createdUnitIds.length} unit(s), ${createdFpIds.length} floor-plan mapping(s).`,
      after: {
        draftId: committedDraft.id,
        projectId: project.id,
        towersCreated: createdTowerIds.length,
        floorsCreated: createdFloorIds.length,
        unitsCreated: createdUnitIds.length,
        floorPlansLinked: createdFpIds.length,
        confirmationNote: input.confirmationNote ?? null,
      },
    });

    return { job: finalJob, draft: committedDraft };
  } catch (err) {
    const failIso = new Date().toISOString();
    const errMsg = err instanceof Error ? err.message : 'Import job encountered an error.';
    const failedJob: AiImportJob = {
      ...job,
      status: 'PARTIAL_FAILURE_RECOVERABLE',
      createdEntityIds: {
        towerIds: createdTowerIds,
        floorIds: createdFloorIds,
        unitIds: createdUnitIds,
        floorPlanVersionIds: createdFpIds,
      },
      errorMessage: errMsg,
      updatedAt: failIso,
    };
    await jobRef.set(failedJob);
    await draftRef.update({ status: 'FAILED', updatedAt: failIso });
    throw err;
  }
}

/**
 * Resumes / retries a recoverable import job idempotently without duplicating already-committed records.
 */
export async function retryImportJobService(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  jobId: string;
}): Promise<{ job: AiImportJob; draft: AiInventoryDraft }> {
  const jobSnap = await params.db.collection('ai_import_jobs').doc(params.jobId).get();
  if (!jobSnap.exists || jobSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Import job not found.');
  }
  const job = jobSnap.data() as AiImportJob;
  if (job.status === 'COMPLETED') {
    const dSnap = await params.db.collection('ai_inventory_drafts').doc(job.draftId).get();
    return { job, draft: dSnap.data() as AiInventoryDraft };
  }

  return commitApprovedInventoryDraftService(params.db, params.actor, {
    orgId: params.orgId,
    sessionId: job.sessionId ?? undefined,
    draftId: job.draftId,
    idempotencyKey: `${job.idempotencyKey}_retry`,
    confirmationNote: 'Resumed recoverable import job',
  });
}
