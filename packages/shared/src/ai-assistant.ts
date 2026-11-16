/**
 * @bharat-makaan/shared — Internal AI Assistant, Conversational Inventory Wizards,
 * Provenance-Tracked Floor-Plan Extraction & Chunked Import Contracts
 */

import type {
  ConstructionStatus,
  FacingDirection,
  FloorCategory,
  ISODateString,
  TowerKind,
  UnitType,
} from './entities';

export const DEFAULT_OPENAI_MODELS = {
  orchestrator: 'gpt-4.1',
  visionFloorPlan: 'gpt-4.1',
  complexEscalation: 'o4-mini',
  fastClassifier: 'gpt-4.1-mini',
} as const;

export type AiWizardKind =
  | 'NONE'
  | 'ADD_PROJECT'
  | 'ADD_PHASE'
  | 'ADD_TOWER'
  | 'ADD_FLOOR_RANGE'
  | 'ADD_UNITS'
  | 'UNIT_NUMBERING'
  | 'UNIT_TYPES'
  | 'ASSIGN_FLOOR_PLAN'
  | 'CREATE_PARKING'
  | 'CREATE_PRICE_BOOK_DRAFT'
  | 'CREATE_QUOTATION_TEMPLATE'
  | 'SEARCH_INVENTORY'
  | 'EXPLAIN_INVENTORY_CHANGES'
  | 'CREATE_FOLLOW_UP'
  | 'SUMMARIZE_LEADS';

export type UnitNumberingPattern =
  | 'FLOOR_INDEX_3DIGIT' // e.g. 101..104 on Floor 1, 2501..2504 on Floor 25
  | 'TOWER_FLOOR_INDEX' // e.g. T1-101..T1-104 or B-1201..B-1204
  | 'SEQUENTIAL_GROUND' // e.g. VILLA-01..VILLA-20 or PLOT-01..PLOT-40
  | 'CUSTOM_PREFIX';

export interface AiExtractedFieldEvidence {
  id: string;
  fieldPath: string;
  label: string;
  value: unknown;
  sourceDocumentId: string;
  sourceFileName: string;
  sourcePage: number;
  sourceRegion?: string;
  extractionStatus: 'EXTRACTED' | 'AMBIGUOUS' | 'MISSING' | 'USER_CORRECTED';
  confidence: number; // 0.0 - 1.0
  reviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'CORRECTED' | 'SKIPPED';
  notes?: string;
}

export interface AiUnitPositionTemplate {
  positionIndex: number; // 1-based position on floor (1, 2, 3, 4...)
  unitSuffix?: string; // e.g. "01", "02", "A", "B"
  unitType: UnitType;
  bhk: string; // e.g. "3 BHK", "4 BHK", "Villa", "Office"
  saleableAreaSqft?: number;
  carpetAreaSqft?: number;
  facing?: FacingDirection;
  isCorner?: boolean;
  balconiesCount?: number;
  parkingEntitlementCount?: number;
  floorPlanDocumentId?: string | null;
  layoutLabel?: string;
  roomNames?: string[];
}

export interface AiFloorTemplateSpec {
  id: string;
  label: string; // e.g. "Typical Residential Floors (1-25)", "Penthouse Floor (26)"
  floorCategory: FloorCategory;
  applicableFloors: number[]; // Empty when "Typical Floor" range is not yet confirmed!
  isTypicalUnbounded?: boolean; // True when source says "Typical Floor" without explicit floor range
  unitsPerFloor: number;
  numberingPattern: UnitNumberingPattern;
  customPrefix?: string;
  positionConfigs: AiUnitPositionTemplate[];
  sourceDocumentId?: string | null;
  sourcePage?: number | null;
}

export interface AiTowerDraftSpec {
  existingTowerId?: string | null;
  phaseId?: string | null;
  phaseName?: string | null;
  name?: string;
  code?: string;
  towerType: TowerKind;
  totalFloors?: number;
  residentialStartFloor?: number;
  residentialEndFloor?: number;
  hasGroundLobby?: boolean;
  stiltLevels?: number;
  podiumLevels?: number;
  basementLevels?: number;
  refugeFloors: number[];
  excludedFloors: number[];
  constructionStatus?: ConstructionStatus;
}

export interface AiProposedUnitRecord {
  tempId: string;
  existingUnitId?: string | null;
  operation: 'CREATE' | 'UPDATE' | 'SKIP';
  towerCode?: string;
  towerName?: string;
  floorNumber: number;
  floorLabel: string;
  floorCategory: FloorCategory;
  positionIndex: number;
  unitNumber: string;
  unitType: UnitType;
  bhk: string;
  saleableAreaSqft: number;
  carpetAreaSqft: number;
  facing: FacingDirection;
  isCorner: boolean;
  balconiesCount: number;
  parkingEntitlementCount: number;
  floorPlanDocumentId?: string | null;
  sourcePage?: number | null;
  confidence: number;
  reviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'CORRECTED' | 'SKIPPED';
  warnings: string[];
  duplicateConflict?: boolean;
  protectedStatusConflict?: boolean;
}

export interface AiDraftConflict {
  code:
    | 'DUPLICATE_TOWER_CODE'
    | 'DUPLICATE_UNIT_NUMBER'
    | 'PROTECTED_BOOKED_UNIT'
    | 'MISSING_MANDATORY_FIELD'
    | 'AMBIGUOUS_FLOOR_RANGE';
  severity: 'ERROR' | 'WARNING';
  message: string;
  entityRef?: string;
}

export interface AiStructuredQuestion {
  fieldKey: string;
  question: string;
  inputType:
    | 'PROJECT_SELECT'
    | 'NUMBER'
    | 'FLOOR_RANGE'
    | 'NUMBERING_PATTERN'
    | 'UNIT_POSITIONS'
    | 'FILE_UPLOAD'
    | 'TEXT'
    | 'CONFIRMATION';
  suggestedOptions?: string[];
  required: boolean;
}

export interface AiDraftChangeSummary {
  towersToCreate: number;
  floorsToCreate: number;
  unitsToCreate: number;
  unitsToUpdate: number;
  unitsSkipped: number;
  duplicateRecordsDetected: number;
  missingInfoCount: number;
  documentsToLink: number;
  conflictsCount: number;
  readyToCommit: boolean;
}

export interface AiInventoryDraft {
  id: string;
  orgId: string;
  projectId: string | null;
  phaseId?: string | null;
  sessionId: string;
  createdByUid: string;
  draftKind:
    | 'TOWER_INVENTORY'
    | 'VILLA_PLOT_INVENTORY'
    | 'PARKING_LAYOUT'
    | 'PRICE_BOOK_DRAFT'
    | 'QUOTATION_TEMPLATE_DRAFT'
    | 'FOLLOW_UP_TASK';
  propertyCategory: 'APARTMENT' | 'VILLA' | 'PLOT' | 'COMMERCIAL';
  sourceType: 'CONVERSATIONAL_WIZARD' | 'DOCUMENT_EXTRACTION' | 'HYBRID';
  status:
    | 'COLLECTING_INFO'
    | 'READY_FOR_REVIEW'
    | 'APPROVED_FOR_IMPORT'
    | 'COMMITTING'
    | 'COMMITTED'
    | 'CANCELLED'
    | 'FAILED';
  towerSpec: AiTowerDraftSpec;
  floorTemplates: AiFloorTemplateSpec[];
  proposedUnits: AiProposedUnitRecord[];
  linkedDocumentIds: string[];
  extractedEvidence: AiExtractedFieldEvidence[];
  missingQuestions: AiStructuredQuestion[];
  conflicts: AiDraftConflict[];
  changeSummary: AiDraftChangeSummary;
  auxiliaryPayload?: Record<string, unknown>;
  committedJobId?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AiSessionContextSnapshot {
  currentRoute?: string;
  activeProjectId?: string | null;
  selectedTowerId?: string | null;
  selectedUnitId?: string | null;
}

export interface AiSessionMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL_SUMMARY';
  content: string;
  structuredQuestions?: AiStructuredQuestion[];
  queryResults?: {
    kind: string;
    count: number;
    items: Array<Record<string, unknown>>;
    summary?: string;
  };
  draftPreviewId?: string | null;
  deepLinks?: Array<{ label: string; route: string }>;
  modelUsed?: string;
  createdAt: ISODateString;
}

export interface AiAssistantSession {
  id: string;
  orgId: string;
  projectId: string | null;
  uid: string;
  actorRole: string;
  partnerOrgId?: string | null;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  contextSnapshot: AiSessionContextSnapshot;
  activeWizard: AiWizardKind;
  draftId?: string | null;
  collectedAnswers: Record<string, unknown>;
  missingFields: string[];
  uploadedDocumentIds: string[];
  validationErrors: string[];
  confirmationState:
    | 'IDLE'
    | 'AWAITING_USER_CONFIRMATION'
    | 'CONFIRMED'
    | 'EXECUTING'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'FAILED';
  executionJobId?: string | null;
  messages: AiSessionMessage[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AiImportJob {
  id: string;
  idempotencyKey: string;
  orgId: string;
  projectId: string;
  draftId: string;
  sessionId?: string | null;
  requestedByUid: string;
  status:
    | 'QUEUED'
    | 'RUNNING'
    | 'COMPLETED'
    | 'PARTIAL_FAILURE_RECOVERABLE'
    | 'ROLLED_BACK'
    | 'CANCELLED';
  totalOperations: number;
  completedOperations: number;
  currentChunkIndex: number;
  totalChunks: number;
  checkpoints: Array<{
    chunkIndex: number;
    entityType: 'TOWER' | 'FLOOR' | 'UNIT' | 'FLOOR_PLAN_MAPPING' | 'PARKING' | 'AUXILIARY';
    count: number;
    committedAt: ISODateString;
  }>;
  createdEntityIds: {
    towerIds: string[];
    floorIds: string[];
    unitIds: string[];
    floorPlanVersionIds: string[];
  };
  errorMessage?: string | null;
  startedAt: ISODateString;
  completedAt?: ISODateString | null;
  updatedAt: ISODateString;
}

/**
 * Deterministic unit number formatter supporting standard high-rise, tower-prefixed,
 * and ground/villa/plot numbering patterns.
 */
export function formatGeneratedUnitNumber(params: {
  pattern: UnitNumberingPattern;
  towerCode?: string;
  customPrefix?: string;
  floorNumber: number;
  positionIndex: number; // 1-based
  explicitSuffix?: string;
}): string {
  const posPadded = params.explicitSuffix?.trim()
    ? params.explicitSuffix.trim().toUpperCase()
    : String(params.positionIndex).padStart(2, '0');
  const code = (params.towerCode || '').trim().toUpperCase();
  const prefix = (params.customPrefix || code || 'UNIT').trim().toUpperCase();

  switch (params.pattern) {
    case 'FLOOR_INDEX_3DIGIT':
      if (params.floorNumber <= 0) {
        return `G${posPadded}`;
      }
      return `${params.floorNumber}${posPadded}`;
    case 'TOWER_FLOOR_INDEX':
      if (params.floorNumber <= 0) {
        return code ? `${code}-G${posPadded}` : `G${posPadded}`;
      }
      return code ? `${code}-${params.floorNumber}${posPadded}` : `${params.floorNumber}${posPadded}`;
    case 'SEQUENTIAL_GROUND':
      return `${prefix}-${String(params.positionIndex).padStart(2, '0')}`;
    case 'CUSTOM_PREFIX':
      return params.floorNumber > 0
        ? `${prefix}-${params.floorNumber}${posPadded}`
        : `${prefix}-${posPadded}`;
  }
}

/**
 * Generates deterministic proposed unit & floor previews from a `AiTowerDraftSpec`
 * and `AiFloorTemplateSpec[]`, automatically excluding skipped and refuge floors from
 * residential unit generation.
 */
export function buildProposedUnitsFromTemplates(params: {
  towerSpec: AiTowerDraftSpec;
  floorTemplates: AiFloorTemplateSpec[];
  defaultUnitType?: UnitType;
}): {
  proposedUnits: AiProposedUnitRecord[];
  residentialFloorsGenerated: number[];
  refugeFloorsRecorded: number[];
} {
  const { towerSpec, floorTemplates, defaultUnitType = 'APARTMENT' } = params;
  const excludedSet = new Set<number>([
    ...(towerSpec.excludedFloors ?? []),
    ...(towerSpec.refugeFloors ?? []),
  ]);

  const proposedUnits: AiProposedUnitRecord[] = [];
  const residentialFloorSet = new Set<number>();

  // Sort templates so specific/exceptional templates (fewer floors, e.g. Penthouse or Lower Floor)
  // override broad typical floor templates if floor numbers overlap!
  const prioritizedTemplates = [...floorTemplates].sort(
    (a, b) => a.applicableFloors.length - b.applicableFloors.length
  );
  const coveredFloors = new Set<number>();

  for (const tpl of prioritizedTemplates) {
    if (tpl.isTypicalUnbounded || tpl.applicableFloors.length === 0) {
      continue;
    }

    for (const floorNo of tpl.applicableFloors) {
      if (excludedSet.has(floorNo)) continue;
      if (coveredFloors.has(floorNo)) continue;
      coveredFloors.add(floorNo);
      residentialFloorSet.add(floorNo);

      for (let idx = 1; idx <= tpl.unitsPerFloor; idx++) {
        const posCfg =
          tpl.positionConfigs.find((p) => p.positionIndex === idx) ??
          tpl.positionConfigs[tpl.positionConfigs.length - 1];

        const unitType = posCfg?.unitType ?? defaultUnitType;
        const bhk = posCfg?.bhk || '3 BHK';
        const saleable = posCfg?.saleableAreaSqft ?? 1800;
        const carpet = posCfg?.carpetAreaSqft ?? Math.round(saleable * 0.7);
        const facing = posCfg?.facing ?? 'EAST';
        const unitNumber = formatGeneratedUnitNumber({
          pattern: tpl.numberingPattern,
          towerCode: towerSpec.code,
          customPrefix: tpl.customPrefix,
          floorNumber: floorNo,
          positionIndex: idx,
          explicitSuffix: posCfg?.unitSuffix,
        });

        const warnings: string[] = [];
        if (!posCfg?.saleableAreaSqft) {
          warnings.push('Saleable area using placeholder until confirmed or extracted from plan.');
        }
        if (!posCfg?.facing) {
          warnings.push('Facing defaulted to EAST — review and confirm unit orientation.');
        }

        proposedUnits.push({
          tempId: `prop_${floorNo}_${idx}`,
          operation: 'CREATE',
          towerCode: towerSpec.code,
          towerName: towerSpec.name,
          floorNumber: floorNo,
          floorLabel: floorNo === 0 ? 'Ground / Plot' : `Floor ${floorNo}`,
          floorCategory: tpl.floorCategory,
          positionIndex: idx,
          unitNumber,
          unitType,
          bhk,
          saleableAreaSqft: saleable,
          carpetAreaSqft: Math.min(carpet, saleable),
          facing,
          isCorner: posCfg?.isCorner ?? (idx === 1 || idx === tpl.unitsPerFloor),
          balconiesCount: posCfg?.balconiesCount ?? (unitType === 'PLOT' ? 0 : 2),
          parkingEntitlementCount: posCfg?.parkingEntitlementCount ?? (unitType === 'PLOT' ? 0 : 1),
          floorPlanDocumentId: posCfg?.floorPlanDocumentId ?? tpl.sourceDocumentId ?? null,
          sourcePage: tpl.sourcePage ?? null,
          confidence: posCfg?.saleableAreaSqft ? 0.95 : 0.75,
          reviewStatus: 'PENDING_REVIEW',
          warnings,
        });
      }
    }
  }

  proposedUnits.sort((a, b) =>
    a.floorNumber !== b.floorNumber
      ? a.floorNumber - b.floorNumber
      : a.positionIndex - b.positionIndex
  );

  return {
    proposedUnits,
    residentialFloorsGenerated: Array.from(residentialFloorSet).sort((a, b) => a - b),
    refugeFloorsRecorded: [...(towerSpec.refugeFloors ?? [])].sort((a, b) => a - b),
  };
}
