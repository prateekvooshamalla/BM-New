import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type {
  Floor,
  Project,
  ProjectPhase,
  Subscription,
  Tower,
} from '@bharat-makaan/shared';
import {
  createFloorSchema,
  createPhaseSchema,
  createProjectSchema,
  createTowerSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

export async function createProjectService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Project> {
  const input = createProjectSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const subRef = db.collection('subscriptions').doc(input.orgId);
    const subSnap = await tx.get(subRef);
    if (subSnap.exists) {
      const sub = subSnap.data() as Subscription;
      const maxProjects =
        sub.entitlements.maxProjects === -1
          ? Infinity
          : sub.entitlements.maxProjects + sub.addons.extraProjects;
      if (sub.usageThisCycle.projectsCount >= maxProjects) {
        throw new HttpsError(
          'resource-exhausted',
          `Project limit reached (${maxProjects}). Upgrade SaaS plan or add extra project entitlement.`
        );
      }
    }

    const dupCodeSnap = await tx.get(
      db
        .collection('projects')
        .where('orgId', '==', input.orgId)
        .where('code', '==', input.code.toUpperCase())
        .limit(1)
    );
    if (!dupCodeSnap.empty) {
      throw new HttpsError(
        'already-exists',
        `Project code "${input.code.toUpperCase()}" already exists in this organization.`
      );
    }

    const projectRef = db.collection('projects').doc();
    const project: Project = {
      id: projectRef.id,
      orgId: input.orgId,
      builderName: input.builderName.trim(),
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      city: input.city.trim(),
      locality: input.locality.trim(),
      address: input.address.trim(),
      coordinates: input.coordinates,
      projectType: input.projectType,
      reraNumber: input.reraNumber.trim(),
      reraValidUntil: input.reraValidUntil || undefined,
      landAreaAcres: input.landAreaAcres,
      totalPhases: 0,
      totalTowers: 0,
      totalFloors: 0,
      totalUnits: 0,
      configurations: input.configurations,
      amenities: input.amenities,
      constructionStatus: input.constructionStatus,
      possessionDate: input.possessionDate || undefined,
      galleryImageUrls: [],
      videoUrls: [],
      teamMemberUids: [actor.uid],
      isPublicPublished: input.isPublicPublished,
      listingIntent: input.listingIntent,
      stats: {
        totalUnits: 0,
        availableUnits: 0,
        onHoldUnits: 0,
        reservedUnits: 0,
        bookedUnits: 0,
        agreementUnits: 0,
        registeredUnits: 0,
        totalLeads: 0,
        totalSiteVisits: 0,
        bookedSalesValueInr: 0,
        collectionsVerifiedInr: 0,
        pendingTasksCount: 0,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(projectRef, project);

    if (subSnap.exists) {
      const sub = subSnap.data() as Subscription;
      tx.update(subRef, {
        'usageThisCycle.projectsCount': sub.usageThisCycle.projectsCount + 1,
        updatedAt: nowIso,
      });
    }

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'PROJECT_CREATED',
        category: 'INVENTORY',
        entityType: 'project',
        entityId: project.id,
        summary: `Created project "${project.name}" (${project.code}) in ${project.city}.`,
        after: {
          name: project.name,
          code: project.code,
          projectType: project.projectType,
          reraNumber: project.reraNumber,
        },
      },
      tx
    );

    return project;
  });
}

export async function createPhaseService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<ProjectPhase> {
  const input = createPhaseSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const projRef = db.collection('projects').doc(input.projectId);
    const projSnap = await tx.get(projRef);
    if (!projSnap.exists || projSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Project not found in organization.');
    }
    const proj = projSnap.data() as Project;

    const ref = db.collection('project_phases').doc();
    const phase: ProjectPhase = {
      id: ref.id,
      orgId: input.orgId,
      projectId: input.projectId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      sequence: input.sequence,
      reraNumber: input.reraNumber || undefined,
      constructionStatus: input.constructionStatus,
      possessionDate: input.possessionDate || undefined,
      totalTowers: 0,
      totalUnits: 0,
      createdAt: nowIso,
    };

    tx.set(ref, phase);
    tx.update(projRef, {
      totalPhases: proj.totalPhases + 1,
      updatedAt: nowIso,
    });

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'PHASE_CREATED',
        category: 'INVENTORY',
        entityType: 'project_phase',
        entityId: phase.id,
        summary: `Created phase "${phase.name}" under project ${proj.name}.`,
      },
      tx
    );

    return phase;
  });
}

export async function createTowerService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Tower> {
  const input = createTowerSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const projRef = db.collection('projects').doc(input.projectId);
    const projSnap = await tx.get(projRef);
    if (!projSnap.exists || projSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Project not found.');
    }
    const proj = projSnap.data() as Project;

    const ref = db.collection('towers').doc();
    const tower: Tower = {
      id: ref.id,
      orgId: input.orgId,
      projectId: input.projectId,
      phaseId: input.phaseId ?? null,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      towerType: input.towerType,
      totalFloors: input.totalFloors,
      basementLevels: input.basementLevels,
      podiumLevels: input.podiumLevels,
      unitsPerFloorTypical: input.unitsPerFloorTypical,
      status: 'ACTIVE',
      createdAt: nowIso,
    };

    tx.set(ref, tower);
    tx.update(projRef, {
      totalTowers: proj.totalTowers + 1,
      updatedAt: nowIso,
    });

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'TOWER_CREATED',
        category: 'INVENTORY',
        entityType: 'tower',
        entityId: tower.id,
        summary: `Created ${tower.towerType} "${tower.name}" (${tower.code}) in ${proj.name}.`,
      },
      tx
    );

    return tower;
  });
}

export async function createFloorService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Floor> {
  const input = createFloorSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const projRef = db.collection('projects').doc(input.projectId);
    const projSnap = await tx.get(projRef);
    if (!projSnap.exists || projSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Project not found.');
    }
    const proj = projSnap.data() as Project;

    const floorRef = db.collection('floors').doc();
    const floor: Floor = {
      id: floorRef.id,
      orgId: input.orgId,
      projectId: input.projectId,
      phaseId: input.phaseId ?? null,
      towerId: input.towerId,
      floorNumber: input.floorNumber,
      label: input.label.trim(),
      floorCategory: input.floorCategory,
      totalUnits: 0,
      createdAt: nowIso,
    };

    tx.set(floorRef, floor);
    tx.update(projRef, {
      totalFloors: proj.totalFloors + 1,
      updatedAt: nowIso,
    });

    await writeAuditEvent(
      db,
      {
        orgId: input.orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole,
        action: 'FLOOR_CREATED',
        category: 'INVENTORY',
        entityType: 'floor',
        entityId: floor.id,
        summary: `Created floor "${floor.label}" (category=${floor.floorCategory}) in ${proj.name}.`,
      },
      tx
    );

    return floor;
  });
}

// --- Cloud Functions v2 Callables ---

export const createProject = onCall(async (request) => {
  const parsed = createProjectSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(request, parsed.orgId, 'projects:create');
  return createProjectService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const toggleProjectPublicVisibility = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    isPublicPublished: z.boolean(),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'projects:publish_public',
    input.projectId
  );

  const projRef = adminDb.collection('projects').doc(input.projectId);
  const snap = await projRef.get();
  if (!snap.exists || snap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'Project not found.');
  }

  await projRef.update({
    isPublicPublished: input.isPublicPublished,
    updatedAt: new Date().toISOString(),
  });

  await writeAuditEvent(adminDb, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: member?.role ?? 'PLATFORM_SUPER_ADMIN',
    action: 'PROJECT_PUBLIC_VISIBILITY_CHANGED',
    category: 'INVENTORY',
    entityType: 'project',
    entityId: input.projectId,
    summary: `Set public portal visibility=${input.isPublicPublished} for project ${snap.data()?.name}.`,
  });

  return { success: true, isPublicPublished: input.isPublicPublished };
});

export const createPhase = onCall(async (request) => {
  const parsed = createPhaseSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'projects:edit',
    parsed.projectId
  );
  return createPhaseService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const createTower = onCall(async (request) => {
  const parsed = createTowerSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'projects:edit',
    parsed.projectId
  );
  return createTowerService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});

export const createFloor = onCall(async (request) => {
  const parsed = createFloorSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'projects:edit',
    parsed.projectId
  );
  return createFloorService(adminDb, actor, member?.role ?? 'PLATFORM_SUPER_ADMIN', parsed);
});
