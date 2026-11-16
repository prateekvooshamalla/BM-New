import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  buildProposedUnitsFromTemplates,
  calculateCostSheet,
  hasPermission,
  type AiDraftChangeSummary,
  type AiDraftConflict,
  type AiFloorTemplateSpec,
  type AiImportJob,
  type AiInventoryDraft,
  type AiProposedUnitRecord,
  type AiStructuredQuestion,
  type AiTowerDraftSpec,
  type FacingDirection,
  type Floor,
  type FloorPlanVersion,
  type Lead,
  type Organization,
  type OrganizationMember,
  type PartnerMember,
  type PartnerOrganization,
  type PaymentPlan,
  type PermissionKey,
  type PriceBook,
  type PriceRevision,
  type Project,
  type ProjectPhase,
  type Tower,
  type Unit,
  type UnitStatus,
  type UnitType,
} from '@bharat-makaan/shared';
import type { AuthenticatedActor } from '../shared/auth-guard';
import {
  DEFAULT_LINE_ITEMS_TEMPLATE,
  savePriceBookDraftService,
  upsertCostSheetTemplateService,
} from '../pricing';

export interface AiVerifiedSubject {
  actor: AuthenticatedActor;
  orgId: string;
  isChannelPartner: boolean;
  partnerOrgId?: string | null;
  role: string;
  permissions: PermissionKey[];
  allowedProjectIds: string[] | 'ALL';
}

/**
 * Verifies server-side tenant membership OR authorized channel-partner builder scope
 * and enforces explicit permission & project-level access before ANY AI tool runs.
 */
export async function verifyAiSubjectPermission(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  requiredPermission: PermissionKey;
  targetProjectId?: string | null;
  partnerOrgId?: string | null;
  disallowChannelPartner?: boolean;
}): Promise<AiVerifiedSubject> {
  const { db, actor, orgId, requiredPermission, targetProjectId, partnerOrgId } = params;

  const orgSnap = await db.collection('organizations').doc(orgId).get();
  if (!orgSnap.exists) {
    throw new HttpsError('not-found', 'Organization not found.');
  }
  const org = orgSnap.data() as Organization;
  if (org.status === 'SUSPENDED' && !actor.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Organization is currently suspended.');
  }

  if (partnerOrgId) {
    if (params.disallowChannelPartner) {
      throw new HttpsError(
        'permission-denied',
        'Channel partners are not permitted to perform internal builder mutations.'
      );
    }
    const pmSnap = await db
      .collection('partner_members')
      .doc(`${partnerOrgId}_${actor.uid}`)
      .get();
    if (!pmSnap.exists || pmSnap.data()?.status !== 'ACTIVE') {
      throw new HttpsError('permission-denied', 'Active channel partner membership required.');
    }
    const pm = pmSnap.data() as PartnerMember;
    if (!pm.permissions.includes(requiredPermission)) {
      throw new HttpsError(
        'permission-denied',
        `Channel partner lacks permission: ${requiredPermission}`
      );
    }

    const poSnap = await db.collection('partner_organizations').doc(partnerOrgId).get();
    const po = poSnap.exists ? (poSnap.data() as PartnerOrganization) : null;
    const scope = po?.builderScopes?.[orgId];
    if (!po || po.status !== 'ACTIVE' || !scope || scope.status !== 'AUTHORIZED') {
      throw new HttpsError(
        'permission-denied',
        'Channel partner is not authorized for this builder organization.'
      );
    }
    if (targetProjectId && !scope.projectIds.includes(targetProjectId)) {
      throw new HttpsError(
        'permission-denied',
        'Channel partner is not authorized for the requested project.'
      );
    }

    return {
      actor,
      orgId,
      isChannelPartner: true,
      partnerOrgId,
      role: pm.role,
      permissions: pm.permissions,
      allowedProjectIds: scope.projectIds,
    };
  }

  // Internal Organization Member (or Super Admin)
  if (actor.isSuperAdmin) {
    return {
      actor,
      orgId,
      isChannelPartner: false,
      role: 'PLATFORM_SUPER_ADMIN',
      permissions: [requiredPermission],
      allowedProjectIds: 'ALL',
    };
  }

  const memSnap = await db
    .collection('organization_members')
    .doc(`${orgId}_${actor.uid}`)
    .get();
  if (!memSnap.exists) {
    throw new HttpsError('permission-denied', 'You are not a member of this organization.');
  }
  const member = memSnap.data() as OrganizationMember;

  if (
    !hasPermission(
      {
        status: member.status,
        role: member.role,
        permissions: member.permissions,
        assignedProjectIds: member.assignedProjectIds,
      },
      requiredPermission,
      targetProjectId
    )
  ) {
    throw new HttpsError(
      'permission-denied',
      `Permission denied: missing ${requiredPermission}${targetProjectId ? ` for project ${targetProjectId}` : ''}.`
    );
  }

  const unrestricted =
    member.role === 'BUILDER_ADMIN' ||
    member.role === 'PROJECT_DIRECTOR' ||
    member.assignedProjectIds.length === 0;

  return {
    actor,
    orgId,
    isChannelPartner: false,
    role: member.role,
    permissions: member.permissions,
    allowedProjectIds: unrestricted ? 'ALL' : member.assignedProjectIds,
  };
}

function isProjectAllowed(subject: AiVerifiedSubject, projectId: string): boolean {
  return (
    subject.allowedProjectIds === 'ALL' || subject.allowedProjectIds.includes(projectId)
  );
}

// ============================================================================
// 1. READ-ONLY AUTHORIZED CRM & INVENTORY TOOLS
// ============================================================================

export async function listAuthorizedOrganizationsTool(
  db: Firestore,
  actor: AuthenticatedActor
): Promise<Array<{ id: string; name: string; city: string; defaultCurrency: string; relation: 'MEMBER' | 'PARTNER' }>> {
  const [memSnap, pmSnap] = await Promise.all([
    db
      .collection('organization_members')
      .where('uid', '==', actor.uid)
      .where('status', '==', 'ACTIVE')
      .get(),
    db
      .collection('partner_members')
      .where('uid', '==', actor.uid)
      .where('status', '==', 'ACTIVE')
      .get(),
  ]);

  const results: Array<{
    id: string;
    name: string;
    city: string;
    defaultCurrency: string;
    relation: 'MEMBER' | 'PARTNER';
  }> = [];

  for (const mDoc of memSnap.docs) {
    const m = mDoc.data() as OrganizationMember;
    const oSnap = await db.collection('organizations').doc(m.orgId).get();
    if (oSnap.exists && oSnap.data()?.status === 'ACTIVE') {
      const o = oSnap.data() as Organization;
      results.push({
        id: o.id,
        name: o.name,
        city: o.headquartersCity,
        defaultCurrency: o.defaultCurrency ?? 'INR',
        relation: 'MEMBER',
      });
    }
  }

  for (const pDoc of pmSnap.docs) {
    const pm = pDoc.data() as PartnerMember;
    const poSnap = await db.collection('partner_organizations').doc(pm.partnerOrgId).get();
    if (!poSnap.exists || poSnap.data()?.status !== 'ACTIVE') continue;
    const po = poSnap.data() as PartnerOrganization;
    for (const [bOrgId, scope] of Object.entries(po.builderScopes ?? {})) {
      if (scope.status !== 'AUTHORIZED') continue;
      if (results.some((r) => r.id === bOrgId)) continue;
      const oSnap = await db.collection('organizations').doc(bOrgId).get();
      if (oSnap.exists && oSnap.data()?.status === 'ACTIVE') {
        const o = oSnap.data() as Organization;
        results.push({
          id: o.id,
          name: o.name,
          city: o.headquartersCity,
          defaultCurrency: o.defaultCurrency ?? 'INR',
          relation: 'PARTNER',
        });
      }
    }
  }

  return results;
}

export async function listAuthorizedProjectsTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  partnerOrgId?: string | null;
}): Promise<Project[]> {
  const subject = await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'projects:view',
    partnerOrgId: params.partnerOrgId,
  });

  const snap = await params.db
    .collection('projects')
    .where('orgId', '==', params.orgId)
    .get();

  return snap.docs
    .map((d) => d.data() as Project)
    .filter((p) => isProjectAllowed(subject, p.id));
}

export async function getProjectStructureTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  partnerOrgId?: string | null;
}) {
  await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'projects:view',
    targetProjectId: params.projectId,
    partnerOrgId: params.partnerOrgId,
  });

  const [projSnap, phasesSnap, towersSnap, floorsSnap] = await Promise.all([
    params.db.collection('projects').doc(params.projectId).get(),
    params.db
      .collection('project_phases')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
    params.db
      .collection('towers')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
    params.db
      .collection('floors')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
  ]);

  if (!projSnap.exists || projSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Project not found in organization.');
  }

  return {
    project: projSnap.data() as Project,
    phases: phasesSnap.docs.map((d) => d.data() as ProjectPhase),
    towers: towersSnap.docs.map((d) => d.data() as Tower),
    floors: floorsSnap.docs.map((d) => d.data() as Floor),
  };
}

export async function getTowerStructureTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  towerIdOrName: string;
  partnerOrgId?: string | null;
}) {
  await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'inventory:view',
    targetProjectId: params.projectId,
    partnerOrgId: params.partnerOrgId,
  });

  const towersSnap = await params.db
    .collection('towers')
    .where('orgId', '==', params.orgId)
    .where('projectId', '==', params.projectId)
    .get();

  const needle = params.towerIdOrName.trim().toLowerCase();
  const tower = towersSnap.docs
    .map((d) => d.data() as Tower)
    .find(
      (t) =>
        t.id.toLowerCase() === needle ||
        t.code.toLowerCase() === needle ||
        t.name.toLowerCase() === needle ||
        t.name.toLowerCase().includes(needle)
    );

  if (!tower) {
    return { tower: null, floors: [], unitsCount: 0 };
  }

  const [floorsSnap, unitsSnap] = await Promise.all([
    params.db
      .collection('floors')
      .where('orgId', '==', params.orgId)
      .where('towerId', '==', tower.id)
      .get(),
    params.db
      .collection('units')
      .where('orgId', '==', params.orgId)
      .where('towerId', '==', tower.id)
      .get(),
  ]);

  return {
    tower,
    floors: floorsSnap.docs.map((d) => d.data() as Floor),
    unitsCount: unitsSnap.size,
  };
}

export interface FindUnitsCriteria {
  projectId: string;
  towerNameOrCode?: string;
  bhk?: string;
  unitType?: UnitType;
  status?: UnitStatus;
  facing?: FacingDirection;
  minFloor?: number;
  maxFloor?: number;
  minArea?: number;
  maxPrice?: number;
  missingFloorPlanOnly?: boolean;
  unitNumberQuery?: string;
}

export async function findExistingUnitsTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  partnerOrgId?: string | null;
  criteria: FindUnitsCriteria;
}) {
  const subject = await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'inventory:view',
    targetProjectId: params.criteria.projectId,
    partnerOrgId: params.partnerOrgId,
  });

  const [unitsSnap, towersSnap] = await Promise.all([
    params.db
      .collection('units')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.criteria.projectId)
      .get(),
    params.db
      .collection('towers')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.criteria.projectId)
      .get(),
  ]);

  const towerMap = new Map<string, Tower>();
  for (const d of towersSnap.docs) {
    const t = d.data() as Tower;
    towerMap.set(t.id, t);
  }

  const c = params.criteria;
  const matched = unitsSnap.docs
    .map((d) => d.data() as Unit)
    .filter((u) => {
      // Channel partners can only inspect AVAILABLE / ON_HOLD inventory
      if (subject.isChannelPartner && u.status !== 'AVAILABLE' && u.status !== 'ON_HOLD') {
        return false;
      }
      if (c.status && u.status !== c.status) return false;
      if (c.unitType && u.unitType !== c.unitType) return false;
      if (c.bhk && !u.bhk.toLowerCase().includes(c.bhk.trim().toLowerCase())) return false;
      if (c.facing && u.facing !== c.facing) return false;
      if (typeof c.minFloor === 'number' && u.floorNumber < c.minFloor) return false;
      if (typeof c.maxFloor === 'number' && u.floorNumber > c.maxFloor) return false;
      if (typeof c.minArea === 'number' && u.saleableAreaSqft < c.minArea) return false;
      if (typeof c.maxPrice === 'number' && u.calculatedTotalPrice > c.maxPrice) return false;
      if (c.missingFloorPlanOnly && Boolean(u.floorPlanVersionId)) return false;
      if (
        c.unitNumberQuery &&
        !u.unitNumber.toLowerCase().includes(c.unitNumberQuery.trim().toLowerCase())
      ) {
        return false;
      }
      if (c.towerNameOrCode) {
        const needle = c.towerNameOrCode.trim().toLowerCase();
        const t = u.towerId ? towerMap.get(u.towerId) : undefined;
        const matchesTower =
          (u.towerName && u.towerName.toLowerCase().includes(needle)) ||
          (t &&
            (t.name.toLowerCase().includes(needle) ||
              t.code.toLowerCase() === needle ||
              `tower ${t.code.toLowerCase()}` === needle));
        if (!matchesTower) return false;
      }
      return true;
    });

  // Redact internal hold/booking references if caller is a channel partner
  return matched.map((u) =>
    subject.isChannelPartner
      ? {
          id: u.id,
          unitNumber: u.unitNumber,
          towerName: u.towerName,
          floorNumber: u.floorNumber,
          unitType: u.unitType,
          bhk: u.bhk,
          saleableAreaSqft: u.saleableAreaSqft,
          carpetAreaSqft: u.carpetAreaSqft,
          facing: u.facing,
          calculatedTotalPrice: u.calculatedTotalPrice,
          status: u.status,
          floorPlanVersionId: u.floorPlanVersionId ?? null,
        }
      : u
  );
}

export async function getInventoryAvailabilityTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  partnerOrgId?: string | null;
  minFloor?: number;
  maxFloor?: number;
  towerNameOrCode?: string;
}) {
  const units = await findExistingUnitsTool({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    partnerOrgId: params.partnerOrgId,
    criteria: {
      projectId: params.projectId,
      minFloor: params.minFloor,
      maxFloor: params.maxFloor,
      towerNameOrCode: params.towerNameOrCode,
    },
  });

  const byStatus: Record<UnitStatus, number> = {
    AVAILABLE: 0,
    ON_HOLD: 0,
    RESERVED: 0,
    BOOKED: 0,
    AGREEMENT: 0,
    REGISTERED: 0,
  };

  for (const u of units) {
    byStatus[u.status] = (byStatus[u.status] ?? 0) + 1;
  }

  return {
    totalMatched: units.length,
    byStatus,
  };
}

export async function getFloorPlanMappingsTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  partnerOrgId?: string | null;
}) {
  await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'documents:view',
    targetProjectId: params.projectId,
    partnerOrgId: params.partnerOrgId,
  });

  const snap = await params.db
    .collection('floor_plan_versions')
    .where('orgId', '==', params.orgId)
    .where('projectId', '==', params.projectId)
    .get();

  return snap.docs.map((d) => d.data() as FloorPlanVersion);
}

export async function explainInventoryChangesTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  sinceDays?: number;
}) {
  await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'pricing:view',
    targetProjectId: params.projectId,
    disallowChannelPartner: true,
  });

  const cutoffMs = Date.now() - (params.sinceDays ?? 30) * 24 * 60 * 60 * 1000;
  const revSnap = await params.db
    .collection('price_revisions')
    .where('orgId', '==', params.orgId)
    .where('projectId', '==', params.projectId)
    .get();

  const revisions = revSnap.docs
    .map((d) => d.data() as PriceRevision)
    .filter((r) => Date.parse(r.createdAt) >= cutoffMs)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    sinceDays: params.sinceDays ?? 30,
    revisionsCount: revisions.length,
    revisions: revisions.slice(0, 50),
  };
}

export async function prepareLeadMatchingTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  partnerOrgId?: string | null;
  leadId?: string;
  budgetMax?: number;
  bhk?: string;
  minArea?: number;
  facing?: FacingDirection;
  minFloor?: number;
}) {
  await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'leads:view',
    targetProjectId: params.projectId,
    partnerOrgId: params.partnerOrgId,
  });

  let lead: Lead | null = null;
  if (params.leadId) {
    const lSnap = await params.db.collection('leads').doc(params.leadId).get();
    if (lSnap.exists && lSnap.data()?.orgId === params.orgId) {
      lead = lSnap.data() as Lead;
    }
  }

  const availableUnits = await findExistingUnitsTool({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    partnerOrgId: params.partnerOrgId,
    criteria: {
      projectId: params.projectId,
      status: 'AVAILABLE',
      bhk: params.bhk ?? lead?.bhkPreference,
      maxPrice: params.budgetMax ?? lead?.budgetMaxInr,
      minArea: params.minArea,
      facing: params.facing,
      minFloor: params.minFloor,
    },
  });

  return {
    leadSummary: lead
      ? {
          id: lead.id,
          customerName: lead.customerName,
          budgetMaxInr: lead.budgetMaxInr,
          bhkPreference: lead.bhkPreference,
        }
      : null,
    matchingAvailableUnitsCount: availableUnits.length,
    matchingUnits: availableUnits.slice(0, 25),
  };
}

export async function summarizeProjectLeadsTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  partnerOrgId?: string | null;
}) {
  const subject = await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'leads:view',
    targetProjectId: params.projectId,
    partnerOrgId: params.partnerOrgId,
  });

  const snap = await params.db
    .collection('leads')
    .where('orgId', '==', params.orgId)
    .get();

  const canViewAll =
    !subject.isChannelPartner &&
    (subject.actor.isSuperAdmin || subject.permissions.includes('leads:view_all'));

  const projectLeads = snap.docs
    .map((d) => d.data() as Lead)
    .filter((l) => {
      const inProject =
        l.projectId === params.projectId || l.preferredProjectIds.includes(params.projectId);
      if (!inProject) return false;
      if (subject.isChannelPartner) {
        return l.partnerOrgId === subject.partnerOrgId;
      }
      if (!canViewAll) {
        return l.assignedAgentUid === params.actor.uid;
      }
      return true;
    });

  const byStage: Record<string, number> = {};
  for (const l of projectLeads) {
    byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
  }

  return {
    totalProjectLeads: projectLeads.length,
    byStage,
    recentLeads: projectLeads.slice(0, 15).map((l) => ({
      id: l.id,
      customerName: l.customerName,
      stage: l.stage,
      qualificationStatus: l.qualificationStatus,
      bhkPreference: l.bhkPreference,
      budgetMaxInr: l.budgetMaxInr,
    })),
  };
}

export async function prepareQuotationPreviewTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  unitNumberOrId: string;
  partnerOrgId?: string | null;
}) {
  await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'quotations:view',
    targetProjectId: params.projectId,
    partnerOrgId: params.partnerOrgId,
  });

  const [unitsSnap, pbSnap, planSnap] = await Promise.all([
    params.db
      .collection('units')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
    params.db
      .collection('price_books')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
    params.db
      .collection('payment_plans')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
  ]);

  const needle = params.unitNumberOrId.trim().toUpperCase();
  const unit = unitsSnap.docs
    .map((d) => d.data() as Unit)
    .find((u) => u.id === params.unitNumberOrId || u.unitNumber.toUpperCase() === needle);

  if (!unit) {
    return {
      ready: false,
      reason: `Unit "${params.unitNumberOrId}" was not found in this project.`,
    };
  }

  const approvedBook = pbSnap.docs
    .map((d) => d.data() as PriceBook)
    .find((b) => b.status === 'ACTIVE' || b.status === 'APPROVED');

  if (!approvedBook) {
    return {
      ready: false,
      reason:
        'No APPROVED or ACTIVE Price Book exists for this project. Approve a Price Book before generating customer cost sheets.',
      unitNumber: unit.unitNumber,
    };
  }

  const activePlan = planSnap.docs.map((d) => d.data() as PaymentPlan)[0] ?? null;
  const breakdown = calculateCostSheet({
    unit,
    priceBook: approvedBook,
    paymentPlan: activePlan,
  });

  return {
    ready: true,
    unit: {
      id: unit.id,
      unitNumber: unit.unitNumber,
      bhk: unit.bhk,
      saleableAreaSqft: unit.saleableAreaSqft,
      status: unit.status,
    },
    priceBook: {
      id: approvedBook.id,
      name: approvedBook.name,
      versionNumber: approvedBook.versionNumber,
    },
    paymentPlan: activePlan ? { id: activePlan.id, name: activePlan.name } : null,
    breakdown,
  };
}

// ============================================================================
// 2. VALIDATION, STAGED DRAFT & CONFLICT PREVIEW TOOLS
// ============================================================================

export async function validateUnitNumberingTool(params: {
  db: Firestore;
  orgId: string;
  projectId: string;
  proposedUnits: AiProposedUnitRecord[];
  towerSpec: AiTowerDraftSpec;
}): Promise<{
  annotatedUnits: AiProposedUnitRecord[];
  conflicts: AiDraftConflict[];
  duplicateCount: number;
}> {
  const [existingUnitsSnap, existingTowersSnap] = await Promise.all([
    params.db
      .collection('units')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
    params.db
      .collection('towers')
      .where('orgId', '==', params.orgId)
      .where('projectId', '==', params.projectId)
      .get(),
  ]);

  const conflicts: AiDraftConflict[] = [];

  if (!params.towerSpec.existingTowerId && params.towerSpec.code) {
    const codeUpper = params.towerSpec.code.trim().toUpperCase();
    const dupTower = existingTowersSnap.docs
      .map((d) => d.data() as Tower)
      .find(
        (t) =>
          t.code.toUpperCase() === codeUpper ||
          (params.towerSpec.name &&
            t.name.trim().toLowerCase() === params.towerSpec.name.trim().toLowerCase())
      );
    if (dupTower) {
      conflicts.push({
        code: 'DUPLICATE_TOWER_CODE',
        severity: 'ERROR',
        message: `Tower "${dupTower.name}" (${dupTower.code}) already exists in this project. Choose an existing tower to append units or specify a distinct tower name/code.`,
        entityRef: dupTower.id,
      });
    }
  }

  const existingByNumber = new Map<string, Unit>();
  for (const d of existingUnitsSnap.docs) {
    const u = d.data() as Unit;
    existingByNumber.set(u.unitNumber.trim().toUpperCase(), u);
  }

  const seenInBatch = new Set<string>();
  let duplicateCount = 0;

  const annotatedUnits = params.proposedUnits.map((pu) => {
    if (pu.operation === 'SKIP') {
      return { ...pu, duplicateConflict: false, protectedStatusConflict: false };
    }

    const norm = pu.unitNumber.trim().toUpperCase();
    const existing = existingByNumber.get(norm);
    const dupInBatch = seenInBatch.has(norm);
    seenInBatch.add(norm);

    if (dupInBatch) {
      duplicateCount++;
      conflicts.push({
        code: 'DUPLICATE_UNIT_NUMBER',
        severity: 'ERROR',
        message: `Unit number "${norm}" appears multiple times inside this draft.`,
        entityRef: norm,
      });
      return { ...pu, duplicateConflict: true };
    }

    if (existing) {
      const isProtected =
        existing.status === 'BOOKED' ||
        existing.status === 'AGREEMENT' ||
        existing.status === 'REGISTERED';

      if (isProtected) {
        duplicateCount++;
        conflicts.push({
          code: 'PROTECTED_BOOKED_UNIT',
          severity: 'ERROR',
          message: `Unit "${norm}" is already ${existing.status} and cannot be overwritten or modified.`,
          entityRef: existing.id,
        });
        return {
          ...pu,
          existingUnitId: existing.id,
          duplicateConflict: true,
          protectedStatusConflict: true,
        };
      }

      if (pu.operation === 'CREATE') {
        duplicateCount++;
        conflicts.push({
          code: 'DUPLICATE_UNIT_NUMBER',
          severity: 'ERROR',
          message: `Unit "${norm}" already exists in project (${existing.status}). Mark as SKIP, rename, or switch operation to UPDATE.`,
          entityRef: existing.id,
        });
        return {
          ...pu,
          existingUnitId: existing.id,
          duplicateConflict: true,
        };
      }

      return {
        ...pu,
        existingUnitId: existing.id,
        duplicateConflict: false,
        protectedStatusConflict: false,
      };
    }

    return {
      ...pu,
      duplicateConflict: false,
      protectedStatusConflict: false,
    };
  });

  return { annotatedUnits, conflicts, duplicateCount };
}

/**
 * Recomputes missing questions, generated floor/unit hierarchy, live duplicate/lock conflicts,
 * and `changeSummary` for any staged `AiInventoryDraft`.
 */
export async function recomputeDraftPreviewAndConflicts(
  db: Firestore,
  draft: AiInventoryDraft,
  rebuildUnitsFromTemplates = true
): Promise<AiInventoryDraft> {
  const missingQuestions: AiStructuredQuestion[] = [];
  const conflicts: AiDraftConflict[] = [];

  if (!draft.projectId) {
    missingQuestions.push({
      fieldKey: 'projectId',
      question: 'Which project should I add this inventory to?',
      inputType: 'PROJECT_SELECT',
      required: true,
    });
  }

  const isTowerBased =
    draft.propertyCategory === 'APARTMENT' || draft.propertyCategory === 'COMMERCIAL';

  if (isTowerBased && !draft.towerSpec.name && !draft.towerSpec.existingTowerId) {
    missingQuestions.push({
      fieldKey: 'towerName',
      question: 'What is the tower or building name (e.g., Tower 1, Block A)?',
      inputType: 'TEXT',
      required: true,
    });
  }

  if (isTowerBased && typeof draft.towerSpec.totalFloors !== 'number') {
    missingQuestions.push({
      fieldKey: 'totalFloors',
      question: `How many residential/usable floors will ${draft.towerSpec.name || 'this tower'} have?`,
      inputType: 'NUMBER',
      required: true,
    });
  }

  // Check if any template is a "Typical Floor" without explicit floor range (Phase 2 non-extrapolation rule!)
  for (const tpl of draft.floorTemplates) {
    if (tpl.isTypicalUnbounded || tpl.applicableFloors.length === 0) {
      missingQuestions.push({
        fieldKey: `applicableFloors_${tpl.id}`,
        question: `Floor plan "${tpl.label}" is labeled as a Typical Floor without explicit floor numbers. Which floors use this layout (e.g., Floors 1 to 25)?`,
        inputType: 'FLOOR_RANGE',
        required: true,
      });
      conflicts.push({
        code: 'AMBIGUOUS_FLOOR_RANGE',
        severity: 'ERROR',
        message: `Applicable floor range must be confirmed for "${tpl.label}" before generating units.`,
        entityRef: tpl.id,
      });
    }
  }

  if (draft.floorTemplates.length === 0 && typeof draft.towerSpec.totalFloors === 'number') {
    missingQuestions.push({
      fieldKey: 'unitsPerFloor',
      question:
        'Are all floors residential, or are there ground-floor lobby, podium, stilt, or refuge floors? How many units are on each typical floor?',
      inputType: 'FLOOR_RANGE',
      required: true,
    });
  }

  let candidateUnits = draft.proposedUnits;
  let floorsCount = 0;

  if (rebuildUnitsFromTemplates && draft.floorTemplates.length > 0) {
    const defaultType: UnitType =
      draft.propertyCategory === 'VILLA'
        ? 'VILLA'
        : draft.propertyCategory === 'PLOT'
          ? 'PLOT'
          : draft.propertyCategory === 'COMMERCIAL'
            ? 'OFFICE'
            : 'APARTMENT';

    const built = buildProposedUnitsFromTemplates({
      towerSpec: draft.towerSpec,
      floorTemplates: draft.floorTemplates,
      defaultUnitType: defaultType,
    });
    candidateUnits = built.proposedUnits;
    floorsCount =
      built.residentialFloorsGenerated.length + built.refugeFloorsRecorded.length;
  } else {
    floorsCount = new Set(
      candidateUnits.filter((u) => u.operation !== 'SKIP').map((u) => u.floorNumber)
    ).size;
  }

  let duplicateCount = 0;
  if (draft.projectId && candidateUnits.length > 0) {
    const check = await validateUnitNumberingTool({
      db,
      orgId: draft.orgId,
      projectId: draft.projectId,
      proposedUnits: candidateUnits,
      towerSpec: draft.towerSpec,
    });
    candidateUnits = check.annotatedUnits;
    conflicts.push(...check.conflicts);
    duplicateCount = check.duplicateCount;
  } else if (draft.projectId && !draft.towerSpec.existingTowerId && draft.towerSpec.code) {
    const check = await validateUnitNumberingTool({
      db,
      orgId: draft.orgId,
      projectId: draft.projectId,
      proposedUnits: [],
      towerSpec: draft.towerSpec,
    });
    conflicts.push(...check.conflicts);
  }

  const unitsToCreate = candidateUnits.filter((u) => u.operation === 'CREATE').length;
  const unitsToUpdate = candidateUnits.filter((u) => u.operation === 'UPDATE').length;
  const unitsSkipped = candidateUnits.filter((u) => u.operation === 'SKIP').length;
  const requiredMissingCount = missingQuestions.filter((q) => q.required).length;
  const blockingConflicts = conflicts.filter((c) => c.severity === 'ERROR').length;

  const readyToCommit =
    Boolean(draft.projectId) &&
    requiredMissingCount === 0 &&
    blockingConflicts === 0 &&
    unitsToCreate + unitsToUpdate > 0;

  const changeSummary: AiDraftChangeSummary = {
    towersToCreate:
      isTowerBased && !draft.towerSpec.existingTowerId && draft.towerSpec.name ? 1 : 0,
    floorsToCreate: isTowerBased ? floorsCount : 0,
    unitsToCreate,
    unitsToUpdate,
    unitsSkipped,
    duplicateRecordsDetected: duplicateCount,
    missingInfoCount: requiredMissingCount,
    documentsToLink: draft.linkedDocumentIds.length,
    conflictsCount: blockingConflicts,
    readyToCommit,
  };

  return {
    ...draft,
    proposedUnits: candidateUnits,
    missingQuestions,
    conflicts,
    changeSummary,
    status: readyToCommit ? 'READY_FOR_REVIEW' : 'COLLECTING_INFO',
    updatedAt: new Date().toISOString(),
  };
}

export async function createPricingDraftTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId: string;
  name: string;
  basePricePerSqft: number;
  floorRiseStartFloor?: number;
  floorRiseRate?: number;
  primaryTaxPct?: number;
  primaryTaxLabel?: string;
}) {
  const subject = await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'pricing:edit_draft',
    targetProjectId: params.projectId,
    disallowChannelPartner: true,
  });

  const projSnap = await params.db.collection('projects').doc(params.projectId).get();
  const proj = projSnap.exists ? (projSnap.data() as Project) : null;

  return savePriceBookDraftService(params.db, params.actor, subject.role, {
    orgId: params.orgId,
    projectId: params.projectId,
    name: params.name,
    effectiveFrom: new Date().toISOString(),
    currencyCode: proj?.currencyCode ?? 'INR',
    areaUnit: proj?.areaUnit ?? 'SQFT',
    basePricePerSqft: params.basePricePerSqft,
    floorRise: {
      enabled: (params.floorRiseRate ?? 0) > 0,
      startFloor: params.floorRiseStartFloor ?? 5,
      ratePerFloorPerSqft: params.floorRiseRate ?? 0,
    },
    facingPremiumPerSqft: {},
    viewPremiumPerSqft: {},
    cornerPremiumPerSqft: 0,
    locationPremiumPerSqft: 0,
    unitSpecificPremiumInr: {},
    parkingPricesByType: {
      STANDARD: 400000,
      TANDEM: 700000,
      MECHANICAL: 350000,
      EV: 500000,
      ACCESSIBLE: 400000,
    },
    lineItems: DEFAULT_LINE_ITEMS_TEMPLATE,
    taxConfig: {
      agreementGstPct: params.primaryTaxPct ?? 5,
      otherServiceGstPct: 18,
      primaryTaxLabel: params.primaryTaxLabel ?? 'GST',
      roundingMode: 'NEAREST_RUPEE',
      registrationDisclaimer:
        'Statutory stamp duty & registration fees are payable at actuals.',
    },
    maxDiscountPctWithoutApproval: 2,
  });
}

export async function createQuotationTemplateDraftTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  projectId?: string | null;
  name: string;
  code: string;
  headerTitle?: string;
}) {
  const subject = await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'pricing:edit_draft',
    targetProjectId: params.projectId ?? null,
    disallowChannelPartner: true,
  });

  return upsertCostSheetTemplateService(params.db, params.actor, subject.role, {
    orgId: params.orgId,
    projectId: params.projectId ?? null,
    name: params.name,
    code: params.code,
    isDefault: false,
    headerConfig: {
      title: params.headerTitle || 'OFFICIAL COST SHEET & QUOTATION',
      showOrgLogo: true,
      showRegulatoryNumber: true,
      accentColor: '#0F265C',
    },
    sectionToggles: {
      showCustomerSection: true,
      showUnitSection: true,
      showAreaBreakdown: true,
      showParkingBreakdown: true,
      showTaxBreakdown: true,
      showOfferRebates: true,
      showPaymentSchedule: true,
      showTerms: true,
      showSalesRepSection: true,
      showSignatureBlocks: true,
    },
    customLabels: {
      unitSectionTitle: 'Unit Specifications',
      customerSectionTitle: 'Prospective Buyer',
      pricingTableTitle: 'Consideration & Charge Breakdown',
      primaryTaxSummaryLabel: 'Primary Tax',
      secondaryTaxSummaryLabel: 'Service Tax',
      exemptSummaryLabel: 'Exempt Deposits',
      netConsiderationLabel: 'Net Consideration',
      grandTotalLabel: 'Total All-Inclusive Payable',
      scheduleSectionTitle: 'Payment Schedule',
    },
    defaultTermsAndConditions:
      'Quotation valid for 15 days subject to unit availability and management confirmation.',
    footerText: 'Generated via Bharat Makaan Enterprise.',
  });
}

export async function getJobStatusTool(params: {
  db: Firestore;
  actor: AuthenticatedActor;
  orgId: string;
  jobId: string;
}): Promise<AiImportJob> {
  const jobSnap = await params.db.collection('ai_import_jobs').doc(params.jobId).get();
  if (!jobSnap.exists || jobSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Import job not found in organization.');
  }
  const job = jobSnap.data() as AiImportJob;
  await verifyAiSubjectPermission({
    db: params.db,
    actor: params.actor,
    orgId: params.orgId,
    requiredPermission: 'inventory:view',
    targetProjectId: job.projectId,
    disallowChannelPartner: true,
  });
  return job;
}

export { type AiFloorTemplateSpec };
