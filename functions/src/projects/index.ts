import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  GLOBAL_COUNTRIES,
  PROJECT_STRUCTURE_TEMPLATES,
  type Floor,
  type Organization,
  type Project,
  type ProjectPhase,
  type ProjectStructureTemplateKey,
  type ProjectType,
  type Subscription,
  type TenantEntitlements,
  type Tower,
} from '@bharat-makaan/shared';
import {
  areaUnitSchema,
  createFloorSchema,
  createPhaseSchema,
  createProjectSchema,
  createTowerSchema,
  currencyCodeSchema,
  setProjectLifecycleStatusSchema,
} from '@bharat-makaan/validation';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';
import { ensureBaselinePriceBookForProject } from '../pricing';

function defaultTemplateForProjectType(projectType: ProjectType): ProjectStructureTemplateKey {
  switch (projectType) {
    case 'APARTMENT':
      return 'APARTMENT_TOWER';
    case 'VILLA':
    case 'INDEPENDENT_HOUSE':
      return 'VILLA_COMMUNITY';
    case 'PLOTTED':
      return 'PLOTTED_LAYOUT';
    case 'COMMERCIAL':
    case 'OFFICE':
    case 'RETAIL':
      return 'COMMERCIAL_BUILDING';
    case 'MIXED':
    case 'RESALE_PORTFOLIO':
    case 'RENTAL_PORTFOLIO':
      return 'CUSTOM_HIERARCHY';
  }
}

export async function createProjectService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Project> {
  const input = createProjectSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const orgRef = db.collection('organizations').doc(input.orgId);
    const subRef = db.collection('subscriptions').doc(input.orgId);
    const entRef = db.collection('entitlements').doc(input.orgId);
    const existingProjectsQuery = db
      .collection('projects')
      .where('orgId', '==', input.orgId);

    const [orgSnap, subSnap, entSnap, existingProjectsSnap] = await Promise.all([
      tx.get(orgRef),
      tx.get(subRef),
      tx.get(entRef),
      tx.get(existingProjectsQuery),
    ]);
    const org = orgSnap.exists ? (orgSnap.data() as Organization) : null;

    if (org?.status === 'SUSPENDED') {
      throw new HttpsError(
        'permission-denied',
        'Organization is suspended; cannot create active projects.'
      );
    }

    const activeProjectsCount = existingProjectsSnap.docs.filter(
      (d) => ((d.data() as Project).lifecycleStatus ?? 'ACTIVE') === 'ACTIVE'
    ).length;

    if (entSnap.exists) {
      const ent = entSnap.data() as TenantEntitlements;
      if (ent.workspaceAccessMode === 'READ_ONLY_SUSPENDED') {
        throw new HttpsError(
          'failed-precondition',
          'SUBSCRIPTION_READ_ONLY: Subscription is cancelled or read-only. Renew your builder package in Billing to create projects.'
        );
      }
      if (activeProjectsCount >= ent.subscribedProjectCapacity) {
        throw new HttpsError(
          'resource-exhausted',
          `Project limit reached (${ent.subscribedProjectCapacity} active project slot(s) on ${ent.packageCode}). Upgrade to Multi-Project Builder or add paid project capacity in Billing.`
        );
      }
    } else if (subSnap.exists) {
      const sub = subSnap.data() as Subscription;
      const maxProjects =
        sub.entitlements.maxProjects === -1
          ? Infinity
          : sub.entitlements.maxProjects + (sub.addons?.extraProjects ?? 0);
      if (activeProjectsCount >= maxProjects) {
        throw new HttpsError(
          'resource-exhausted',
          `Project limit reached (${maxProjects}). Upgrade SaaS plan or add extra project entitlement.`
        );
      }
    }

    const dupCode = existingProjectsSnap.docs.some(
      (d) => (d.data() as Project).code === input.code.toUpperCase()
    );
    if (dupCode) {
      throw new HttpsError(
        'already-exists',
        `Project code "${input.code.toUpperCase()}" already exists in this organization.`
      );
    }

    const countryCode = (input.countryCode || org?.countryCode || 'IN').toUpperCase();
    const countryCfg = GLOBAL_COUNTRIES[countryCode] ?? GLOBAL_COUNTRIES.IN!;
    const structureTemplate =
      input.structureTemplate ?? defaultTemplateForProjectType(input.projectType);
    const tplDef = PROJECT_STRUCTURE_TEMPLATES[structureTemplate];

    const projectRef = db.collection('projects').doc();
    const projectSlug = `${input.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48)}-${projectRef.id.slice(0, 6).toLowerCase()}`;
    const project: Project = {
      id: projectRef.id,
      orgId: input.orgId,
      builderName: input.builderName.trim(),
      name: input.name.trim(),
      slug: projectSlug,
      code: input.code.trim().toUpperCase(),
      lifecycleStatus: 'ACTIVE',
      countryCode,
      stateOrRegion: input.stateOrRegion?.trim() || org?.stateOrRegion || undefined,
      city: input.city.trim(),
      locality: input.locality.trim(),
      address: input.address.trim(),
      coordinates: input.coordinates,
      currencyCode: input.currencyCode ?? org?.defaultCurrency ?? countryCfg.defaultCurrency,
      areaUnit: input.areaUnit ?? org?.defaultAreaUnit ?? countryCfg.defaultAreaUnit,
      timezone: input.timezone ?? org?.defaultTimezone ?? countryCfg.defaultTimezone,
      projectType: input.projectType,
      structureTemplate,
      hierarchyLabels: input.hierarchyLabels ?? {
        phaseLabel: tplDef.hierarchyLabels.phaseLabel,
        structureLabel: tplDef.hierarchyLabels.structureLabel,
        floorLabel: tplDef.hierarchyLabels.floorLabel,
        unitLabel: tplDef.hierarchyLabels.unitLabel,
        requiresStructure: tplDef.requiresStructure,
        requiresFloor: tplDef.requiresFloor,
      },
      regulatoryAuthorityLabel:
        input.regulatoryAuthorityLabel ??
        org?.regulatoryAuthorityLabel ??
        countryCfg.regulatoryAuthorityLabel,
      reraNumber: input.reraNumber.trim(),
      reraValidUntil: input.reraValidUntil || undefined,
      defaultCostSheetTemplateId: input.defaultCostSheetTemplateId ?? null,
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

    const nextActiveCount = activeProjectsCount + 1;
    if (subSnap.exists) {
      tx.update(subRef, {
        'usageThisCycle.projectsCount': nextActiveCount,
        updatedAt: nowIso,
      });
    }
    if (entSnap.exists) {
      tx.update(entRef, {
        activeProjectsCount: nextActiveCount,
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

  const createdTower = await db.runTransaction(async (tx) => {
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

  await ensureBaselinePriceBookForProject(db, {
    orgId: input.orgId,
    projectId: input.projectId,
    baseRatePerSqft: 0,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
  }).catch(() => {
    // Non-blocking baseline pricing initialization
  });

  return createdTower;
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

export async function updateProjectConfigurationService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  params: {
    orgId: string;
    projectId: string;
    defaultCostSheetTemplateId?: string | null;
    currencyCode?: Project['currencyCode'];
    areaUnit?: Project['areaUnit'];
    regulatoryAuthorityLabel?: string;
    hierarchyLabels?: Project['hierarchyLabels'];
  }
): Promise<Project> {
  const projRef = db.collection('projects').doc(params.projectId);
  const snap = await projRef.get();
  if (!snap.exists || snap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Project not found in organization.');
  }
  const prev = snap.data() as Project;
  const nowIso = new Date().toISOString();
  const updated: Project = {
    ...prev,
    defaultCostSheetTemplateId:
      params.defaultCostSheetTemplateId !== undefined
        ? params.defaultCostSheetTemplateId
        : prev.defaultCostSheetTemplateId,
    currencyCode: params.currencyCode ?? prev.currencyCode,
    areaUnit: params.areaUnit ?? prev.areaUnit,
    regulatoryAuthorityLabel: params.regulatoryAuthorityLabel ?? prev.regulatoryAuthorityLabel,
    hierarchyLabels: params.hierarchyLabels ?? prev.hierarchyLabels,
    updatedAt: nowIso,
  };
  await projRef.set(updated);
  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole,
    action: 'PROJECT_CONFIGURATION_UPDATED',
    category: 'INVENTORY',
    entityType: 'project',
    entityId: params.projectId,
    summary: `Updated project configuration for "${updated.name}" (${updated.code}).`,
    after: {
      defaultCostSheetTemplateId: updated.defaultCostSheetTemplateId,
      currencyCode: updated.currencyCode,
      areaUnit: updated.areaUnit,
    },
  });
  return updated;
}

export const updateProjectConfiguration = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    defaultCostSheetTemplateId: z.string().nullable().optional(),
    currencyCode: currencyCodeSchema.optional(),
    areaUnit: areaUnitSchema.optional(),
    regulatoryAuthorityLabel: z.string().max(60).optional(),
    hierarchyLabels: z
      .object({
        phaseLabel: z.string().min(1).max(40),
        structureLabel: z.string().min(1).max(40),
        floorLabel: z.string().min(1).max(40),
        unitLabel: z.string().min(1).max(40),
        requiresStructure: z.boolean(),
        requiresFloor: z.boolean(),
      })
      .optional(),
  });
  const input = schema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    input.orgId,
    'projects:edit',
    input.projectId
  );
  return updateProjectConfigurationService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    input
  );
});

export async function setProjectLifecycleStatusService(
  db: Firestore,
  actor: AuthenticatedActor,
  actorRole: string,
  rawInput: unknown
): Promise<Project> {
  const input = setProjectLifecycleStatusSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const projRef = db.collection('projects').doc(input.projectId);
    const entRef = db.collection('entitlements').doc(input.orgId);
    const subRef = db.collection('subscriptions').doc(input.orgId);
    const allProjQuery = db.collection('projects').where('orgId', '==', input.orgId);

    const [projSnap, entSnap, subSnap, allProjSnap] = await Promise.all([
      tx.get(projRef),
      tx.get(entRef),
      tx.get(subRef),
      tx.get(allProjQuery),
    ]);

    if (!projSnap.exists || projSnap.data()?.orgId !== input.orgId) {
      throw new HttpsError('not-found', 'Project not found in organization.');
    }

    const current = projSnap.data() as Project;
    const prevLifecycle = current.lifecycleStatus ?? 'ACTIVE';
    if (prevLifecycle === input.lifecycleStatus) {
      return current;
    }

    const otherActiveCount = allProjSnap.docs.filter(
      (d) =>
        d.id !== input.projectId &&
        ((d.data() as Project).lifecycleStatus ?? 'ACTIVE') === 'ACTIVE'
    ).length;

    if (input.lifecycleStatus === 'ACTIVE' && entSnap.exists) {
      const ent = entSnap.data() as TenantEntitlements;
      if (ent.workspaceAccessMode === 'READ_ONLY_SUSPENDED') {
        throw new HttpsError(
          'failed-precondition',
          'SUBSCRIPTION_READ_ONLY: Renew your subscription before reactivating archived projects.'
        );
      }
      if (otherActiveCount + 1 > ent.subscribedProjectCapacity) {
        throw new HttpsError(
          'resource-exhausted',
          `Project limit reached (${ent.subscribedProjectCapacity} active project slot(s)). Upgrade package or add project slots in Billing before reactivating "${current.name}".`
        );
      }
    }

    const nextActiveCount =
      input.lifecycleStatus === 'ACTIVE' ? otherActiveCount + 1 : otherActiveCount;

    const updated: Project = {
      ...current,
      lifecycleStatus: input.lifecycleStatus,
      isPublicPublished:
        input.lifecycleStatus === 'ARCHIVED_READ_ONLY' ? false : current.isPublicPublished,
      updatedAt: nowIso,
    };

    tx.set(projRef, updated);
    if (entSnap.exists) {
      tx.update(entRef, {
        activeProjectsCount: nextActiveCount,
        updatedAt: nowIso,
      });
    }
    if (subSnap.exists) {
      tx.update(subRef, {
        'usageThisCycle.projectsCount': nextActiveCount,
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
        action:
          input.lifecycleStatus === 'ACTIVE'
            ? 'PROJECT_REACTIVATED'
            : 'PROJECT_ARCHIVED_READ_ONLY',
        category: 'INVENTORY',
        entityType: 'project',
        entityId: updated.id,
        summary: `Changed project "${updated.name}" lifecycle status to ${input.lifecycleStatus}. Reason: ${input.reason}`,
      },
      tx
    );

    return updated;
  });
}

export const setProjectLifecycleStatus = onCall(async (request) => {
  const parsed = setProjectLifecycleStatusSchema.parse(request.data);
  const { actor, member } = await requireOrgPermission(
    request,
    parsed.orgId,
    'projects:edit',
    parsed.projectId
  );
  return setProjectLifecycleStatusService(
    adminDb,
    actor,
    member?.role ?? 'PLATFORM_SUPER_ADMIN',
    parsed
  );
});

/**
 * Public read-only catalog returning strictly `isPublicPublished === true`
 * projects and units for the Customer Property Portal.
 */
export const listPublicPublishedCatalog = onCall(async () => {
  const [pSnap, uSnap] = await Promise.all([
    adminDb.collection('projects').where('isPublicPublished', '==', true).limit(200).get(),
    adminDb.collection('units').where('isPublicPublished', '==', true).limit(500).get(),
  ]);
  return {
    projects: pSnap.docs
      .map((d) => d.data() as Project)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    units: uSnap.docs.map((d) => d.data()),
  };
});
