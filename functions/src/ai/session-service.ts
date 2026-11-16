import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type {
  AiAssistantSession,
  AiFloorTemplateSpec,
  AiInventoryDraft,
  AiSessionMessage,
  AiStructuredQuestion,
  AiUnitPositionTemplate,
  FacingDirection,
  Project,
  UnitStatus,
  UnitType,
} from '@bharat-makaan/shared';
import {
  createAiSessionSchema,
  sendAiMessageSchema,
  updateAiInventoryDraftSchema,
} from '@bharat-makaan/validation';
import type { AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';
import {
  enforceAiRateLimit,
  getConfiguredAiModels,
  invokeStructuredResponsesApi,
  type MinimalResponsesClient,
} from './models';
import {
  createPricingDraftTool,
  createQuotationTemplateDraftTool,
  explainInventoryChangesTool,
  findExistingUnitsTool,
  getInventoryAvailabilityTool,
  listAuthorizedProjectsTool,
  prepareLeadMatchingTool,
  prepareQuotationPreviewTool,
  recomputeDraftPreviewAndConflicts,
  summarizeProjectLeadsTool,
  verifyAiSubjectPermission,
} from './tools';

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

function parseWordOrDigit(token?: string): number | null {
  if (!token) return null;
  const lower = token.trim().toLowerCase();
  if (WORD_NUMBERS[lower] !== undefined) return WORD_NUMBERS[lower]!;
  const n = Number(lower);
  return Number.isFinite(n) ? n : null;
}

export async function createAiSessionService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<AiAssistantSession> {
  const input = createAiSessionSchema.parse(rawInput);
  const candidateProjectId =
    input.projectId ?? input.contextSnapshot?.activeProjectId ?? null;

  const subject = await verifyAiSubjectPermission({
    db,
    actor,
    orgId: input.orgId,
    requiredPermission: 'projects:view',
    targetProjectId: candidateProjectId,
    partnerOrgId: input.partnerOrgId ?? null,
  });

  const nowIso = new Date().toISOString();
  const ref = db.collection('ai_sessions').doc();
  const session: AiAssistantSession = {
    id: ref.id,
    orgId: input.orgId,
    projectId: candidateProjectId,
    uid: actor.uid,
    actorRole: subject.role,
    partnerOrgId: input.partnerOrgId ?? null,
    title: input.title?.trim() || 'AI Workspace Session',
    status: 'ACTIVE',
    contextSnapshot: input.contextSnapshot ?? {
      activeProjectId: candidateProjectId,
    },
    activeWizard: 'NONE',
    draftId: null,
    collectedAnswers: candidateProjectId ? { projectId: candidateProjectId } : {},
    missingFields: [],
    uploadedDocumentIds: [],
    validationErrors: [],
    confirmationState: 'IDLE',
    executionJobId: null,
    messages: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ref.set(session);
  return session;
}

interface WizardExtractedSlots {
  towerName?: string;
  towerCode?: string;
  totalFloors?: number;
  residentialStartFloor?: number;
  residentialEndFloor?: number;
  hasGroundLobby?: boolean;
  podiumLevels?: number;
  stiltLevels?: number;
  refugeFloors?: number[];
  excludedFloors?: number[];
  unitsPerFloor?: number;
  numberingConfirmed?: boolean;
  numberingPattern?: 'FLOOR_INDEX_3DIGIT' | 'TOWER_FLOOR_INDEX';
  bhkMix?: Array<{ count: number; bhk: string; saleableAreaSqft?: number; facing?: FacingDirection }>;
  exceptionalFloor?: {
    floorNumber: number;
    unitsCount: number;
    bhk: string;
    unitType: UnitType;
    saleableAreaSqft?: number;
  };
  positionConfirmed?: boolean;
}

/**
 * Extracts structured wizard slots and natural mid-conversation corrections
 * from a user's message deterministically (with optional OpenAI Responses API enrichment).
 */
function extractTowerWizardSlotsFromMessage(text: string): WizardExtractedSlots {
  const slots: WizardExtractedSlots = {};
  const trimmed = text.trim();

  // Tower / Block / Building identifier
  const towerMatch = trimmed.match(
    /\b(?:add|create|configure|update)?\s*(Tower\s+[A-Za-z0-9-]+|Block\s+[A-Za-z0-9-]+|Building\s+[A-Za-z0-9-]+)\b/i
  );
  if (towerMatch) {
    slots.towerName = towerMatch[1]!.replace(/\s+/g, ' ').trim();
    const rawCode = slots.towerName.replace(/^(Tower|Block|Building)\s+/i, '').trim();
    slots.towerCode = /^\d+$/.test(rawCode) ? `T${rawCode}` : rawCode.toUpperCase();
  }

  // Floor range e.g. "floors 1 to 25" or "floors 5 through 10"
  const floorRangeMatch = trimmed.match(
    /\bfloors?\s+(\d{1,3})\s*(?:to|through|-|–)\s*(\d{1,3})\b/i
  );
  if (floorRangeMatch) {
    const s = Number(floorRangeMatch[1]);
    const e = Number(floorRangeMatch[2]);
    if (e >= s) {
      slots.residentialStartFloor = s;
      slots.residentialEndFloor = e;
      if (!slots.totalFloors) slots.totalFloors = e;
    }
  }

  // Total floor count (including natural corrections like "Actually 20 floors" or "25 floors")
  const totalFloorsMatch = trimmed.match(
    /\b(?:actually|make\s+it|change\s+to|total\s+of)?\s*(\d{1,3})\s+(?:residential\s+)?floors?\b/i
  );
  if (totalFloorsMatch && !floorRangeMatch) {
    slots.totalFloors = Number(totalFloorsMatch[1]);
  }

  if (/\bground[- ]floor\s+lobby\b|\blobbies?\b/i.test(trimmed)) {
    slots.hasGroundLobby = true;
  }

  const podiumMatch = trimmed.match(/(\d{1,2})\s*podium/i);
  if (podiumMatch) slots.podiumLevels = Number(podiumMatch[1]);
  else if (/\bpodium\b/i.test(trimmed) && !/\bno\s+podium\b/i.test(trimmed)) {
    slots.podiumLevels = 1;
  }

  if (/\bstilt\b/i.test(trimmed) && !/\bno\s+stilt\b/i.test(trimmed)) {
    slots.stiltLevels = 1;
  }

  // Refuge floors e.g. "refuge floor 8 and 16" or "floor 14 is refuge"
  const refugeMatches = [
    ...trimmed.matchAll(/refuge\s+floors?\s*(?:on|at|:)?\s*(\d{1,3})(?:\s*(?:,|and|&)\s*(\d{1,3}))?/gi),
    ...trimmed.matchAll(/floors?\s+(\d{1,3})\s+is\s+(?:a\s+)?refuge/gi),
  ];
  const refuges: number[] = [];
  for (const rm of refugeMatches) {
    if (rm[1]) refuges.push(Number(rm[1]));
    if (rm[2]) refuges.push(Number(rm[2]));
  }
  if (refuges.length > 0) slots.refugeFloors = Array.from(new Set(refuges));

  // Skipped / excluded floors e.g. "skip floor 13" or "exclude floor 13"
  const skipMatches = [
    ...trimmed.matchAll(/(?:skip|skipped|exclude|excluded|without)\s+floors?\s*(\d{1,3})(?:\s*(?:,|and|&)\s*(\d{1,3}))?/gi),
  ];
  const skipped: number[] = [];
  for (const sm of skipMatches) {
    if (sm[1]) skipped.push(Number(sm[1]));
    if (sm[2]) skipped.push(Number(sm[2]));
  }
  if (skipped.length > 0) slots.excludedFloors = Array.from(new Set(skipped));

  // Units per floor e.g. "four apartments on each floor", "4 flats per floor", "add four new flats to floors 5 through 10"
  const upfMatch =
    trimmed.match(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d{1,2})\s+(?:new\s+)?(?:apartments?|flats?|units?|offices?)\s+(?:on\s+each\s+floor|per\s+floor|each\s+floor|to\s+floors?)\b/i
    ) ??
    trimmed.match(
      /\bwith\s+(one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d{1,2})\s+(?:apartments?|flats?|units?)\b/i
    );
  if (upfMatch) {
    const parsedUpf = parseWordOrDigit(upfMatch[1]);
    if (parsedUpf && parsedUpf > 0) slots.unitsPerFloor = parsedUpf;
  }

  // Numbering confirmation / pattern preference
  if (/^(yes|yep|sure|ok|okay|confirm|sounds good)\b/i.test(trimmed)) {
    slots.numberingConfirmed = true;
  }
  if (/\b101\s*[-–to]+\s*10\d\b/i.test(trimmed)) {
    slots.numberingPattern = 'FLOOR_INDEX_3DIGIT';
    slots.numberingConfirmed = true;
  } else if (/\b[A-Z]\d?-\d{3}\b/i.test(trimmed) || /\btower\s+prefix\b/i.test(trimmed)) {
    slots.numberingPattern = 'TOWER_FLOOR_INDEX';
    slots.numberingConfirmed = true;
  }

  // BHK mix e.g. "Three apartments are 3 BHK and one apartment is 4 BHK" or "all 3 BHK 1850 sqft east facing"
  const mixList: NonNullable<WizardExtractedSlots['bhkMix']> = [];
  const mixRegex =
    /\b(one|two|three|four|five|six|seven|eight|\d{1,2})\s+(?:apartments?|flats?|units?|positions?)?\s*(?:are|is|of)?\s*([1-6]\s*BHK)(?:\s*\(?(\d{3,5})\s*(?:sq\.?\s*ft|sqft)?\)?)?/gi;
  for (const mm of trimmed.matchAll(mixRegex)) {
    const cnt = parseWordOrDigit(mm[1]);
    if (cnt && cnt > 0) {
      mixList.push({
        count: cnt,
        bhk: mm[2]!.toUpperCase().replace(/\s+/, ' '),
        saleableAreaSqft: mm[3] ? Number(mm[3]) : undefined,
      });
    }
  }
  if (mixList.length === 0) {
    const singleBhk = trimmed.match(/\b([1-6]\s*BHK)\b/i);
    const areaMatch = trimmed.match(/\b(\d{3,5})\s*(?:sq\.?\s*ft|sqft)\b/i);
    const facingMatch = trimmed.match(
      /\b(NORTH_EAST|NORTH_WEST|SOUTH_EAST|SOUTH_WEST|EAST|WEST|NORTH|SOUTH)(?:[- ]facing)?\b/i
    );
    if (singleBhk && !/\bshow\b|\bfind\b|\bsearch\b|\bavailable\b/i.test(trimmed)) {
      mixList.push({
        count: slots.unitsPerFloor ?? 4,
        bhk: singleBhk[1]!.toUpperCase().replace(/\s+/, ' '),
        saleableAreaSqft: areaMatch ? Number(areaMatch[1]) : undefined,
        facing: facingMatch ? (facingMatch[1]!.toUpperCase() as FacingDirection) : undefined,
      });
    }
  }
  if (mixList.length > 0) slots.bhkMix = mixList;

  // Exceptional / Penthouse floor e.g. "penthouse on floor 25 with 2 units of 5 BHK"
  const pentMatch = trimmed.match(
    /\bpenthouse\s+on\s+floor\s+(\d{1,3})\s+with\s+(one|two|three|four|\d{1,2})\s+(?:units?|apartments?|penthouses?)?(?:\s+of\s+([1-6]\s*BHK))?/i
  );
  if (pentMatch) {
    slots.exceptionalFloor = {
      floorNumber: Number(pentMatch[1]),
      unitsCount: parseWordOrDigit(pentMatch[2]) ?? 2,
      bhk: pentMatch[3] ? pentMatch[3].toUpperCase().replace(/\s+/, ' ') : '4 BHK',
      unitType: 'PENTHOUSE',
    };
  }

  // Explicit unit positions confirmation e.g. "positions 1-3 are 3 BHK and position 4 is 4 BHK" or "no floor plan yet, generate preview"
  if (
    /\bpositions?\s+1\b/i.test(trimmed) ||
    /\bfirst\s+three\b/i.test(trimmed) ||
    /\bno\s+floor\s*plan\b/i.test(trimmed) ||
    /\bready\s+to\s+review\b/i.test(trimmed) ||
    /\bgenerate\s+preview\b/i.test(trimmed)
  ) {
    slots.positionConfirmed = true;
  }

  return slots;
}

/**
 * Classifies natural-language read/CRM queries vs inventory creation wizards.
 */
function detectConversationalIntent(text: string):
  | { type: 'READ_UNITS'; status?: UnitStatus; bhk?: string; tower?: string; facing?: FacingDirection; minFloor?: number; maxFloor?: number; missingFloorPlan?: boolean }
  | { type: 'COUNT_AVAILABILITY'; status?: UnitStatus; minFloor?: number; maxFloor?: number; tower?: string }
  | { type: 'PREPARE_QUOTATION'; unitRef: string }
  | { type: 'EXPLAIN_PRICE_CHANGES' }
  | { type: 'SUMMARIZE_LEADS' }
  | { type: 'MATCH_BUYER_UNITS'; bhk?: string; budgetMax?: number; facing?: FacingDirection; minFloor?: number }
  | { type: 'CREATE_PRICING_DRAFT'; baseRate: number; name?: string }
  | { type: 'CREATE_TEMPLATE_DRAFT'; name: string; code: string }
  | { type: 'TOWER_OR_UNIT_WIZARD' }
  | { type: 'GENERAL_HELP' } {
  const lower = text.trim().toLowerCase();

  // Cost sheet / Quotation request
  const qtMatch = text.match(
    /(?:prepare|generate|create|preview)\s+(?:a\s+)?(?:cost\s*sheet|quotation)\s+for\s+(?:unit\s+)?([A-Za-z0-9_-]+)/i
  );
  if (qtMatch) {
    return { type: 'PREPARE_QUOTATION', unitRef: qtMatch[1]! };
  }

  // Price change history
  if (
    /\bprice\s+changed\b|\bprice\s+revisions?\b|\binventory\s+changes\b/i.test(text)
  ) {
    return { type: 'EXPLAIN_PRICE_CHANGES' };
  }

  // Missing floor plans
  if (/\bmissing\s+floor\s*plans?\b|\bwithout\s+floor\s*plans?\b/i.test(text)) {
    return { type: 'READ_UNITS', missingFloorPlan: true };
  }

  // Leads summary
  if (/\bshow\s+all\s+leads\b|\bsummarize\s+leads\b|\bleads\s+interested\b/i.test(text)) {
    return { type: 'SUMMARIZE_LEADS' };
  }

  // Buyer matching
  if (/\bmatch\b.*\b(?:buyer|budget|lead|units?)\b/i.test(text)) {
    const bhkM = text.match(/\b([1-6]\s*BHK)\b/i);
    const crM = text.match(/(\d+(?:\.\d+)?)\s*cr/i);
    return {
      type: 'MATCH_BUYER_UNITS',
      bhk: bhkM ? bhkM[1]!.toUpperCase() : undefined,
      budgetMax: crM ? Number(crM[1]) * 10_000_000 : undefined,
    };
  }

  // Create draft price book
  const pbMatch = text.match(
    /\bcreate\s+(?:a\s+)?draft\s+price\s*book.*?(?:at|base|rate)\s*(?:rs\.?|₹|\$)?\s*(\d{3,7})/i
  );
  if (pbMatch) {
    return { type: 'CREATE_PRICING_DRAFT', baseRate: Number(pbMatch[1]) };
  }

  // Create draft quotation template
  const tplMatch = text.match(
    /\bcreate\s+(?:a\s+)?(?:draft\s+)?(?:quotation|cost[- ]sheet)\s+template\s+([A-Za-z0-9 _-]+)/i
  );
  if (tplMatch) {
    const nm = tplMatch[1]!.trim();
    return {
      type: 'CREATE_TEMPLATE_DRAFT',
      name: nm,
      code: nm.replace(/[^A-Za-z0-9]/g, '_').slice(0, 16).toUpperCase() || 'TPL_CUSTOM',
    };
  }

  // Count flats booked/available on floor range
  if (/\bhow\s+many\s+(?:flats|apartments|units)\b/i.test(text)) {
    const flRange = text.match(/floors?\s+(\d{1,3})\s*(?:to|through|-|–)\s*(\d{1,3})/i);
    const st: UnitStatus | undefined = /\bbooked\b/i.test(lower)
      ? 'BOOKED'
      : /\bavailable\b/i.test(lower)
        ? 'AVAILABLE'
        : undefined;
    return {
      type: 'COUNT_AVAILABILITY',
      status: st,
      minFloor: flRange ? Number(flRange[1]) : undefined,
      maxFloor: flRange ? Number(flRange[2]) : undefined,
    };
  }

  // Read / Search units e.g. "Show all available 3 BHK flats in Tower B" or "Find east-facing apartments above the 15th floor"
  if (/^(show|find|list|search|which\s+units)\b/i.test(lower)) {
    const bhkM = text.match(/\b([1-6]\s*BHK)\b/i);
    const twM = text.match(/\b(Tower\s+[A-Za-z0-9-]+|Block\s+[A-Za-z0-9-]+)\b/i);
    const facingM = text.match(
      /\b(north[- ]east|north[- ]west|south[- ]east|south[- ]west|east|west|north|south)(?:[- ]facing)?\b/i
    );
    const aboveM = text.match(/\babove\s+(?:the\s+)?(\d{1,3})(?:st|nd|rd|th)?\s+floor\b/i);
    const flRange = text.match(/floors?\s+(\d{1,3})\s*(?:to|through|-|–)\s*(\d{1,3})/i);

    const status: UnitStatus | undefined = /\bavailable\b/i.test(lower)
      ? 'AVAILABLE'
      : /\bbooked\b/i.test(lower)
        ? 'BOOKED'
        : /\bon\s+hold\b/i.test(lower)
          ? 'ON_HOLD'
          : undefined;

    return {
      type: 'READ_UNITS',
      status,
      bhk: bhkM ? bhkM[1]!.toUpperCase().replace(/\s+/, ' ') : undefined,
      tower: twM ? twM[1]!.trim() : undefined,
      facing: facingM
        ? (facingM[1]!.toUpperCase().replace(/[-\s]/g, '_') as FacingDirection)
        : undefined,
      minFloor: aboveM
        ? Number(aboveM[1]) + 1
        : flRange
          ? Number(flRange[1])
          : undefined,
      maxFloor: flRange ? Number(flRange[2]) : undefined,
    };
  }

  // Tower / Floor / Unit creation or ongoing wizard
  if (
    /\b(add|create|configure|build|generate)\b.*\b(tower|block|building|floors?|flats?|apartments?|units?|villas?|plots?)\b/i.test(
      text
    )
  ) {
    return { type: 'TOWER_OR_UNIT_WIZARD' };
  }

  return { type: 'GENERAL_HELP' };
}

/**
 * Main conversational turn handler (`sendAiAssistantMessageService`).
 * Manages session context, project disambiguation, progressive multi-turn inventory wizards,
 * CRM read tools, and OpenAI Responses API orchestration.
 */
export async function sendAiAssistantMessageService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown,
  customClient?: MinimalResponsesClient
): Promise<{
  session: AiAssistantSession;
  replyMessage: AiSessionMessage;
  draft: AiInventoryDraft | null;
}> {
  const input = sendAiMessageSchema.parse(rawInput);

  await enforceAiRateLimit(db, input.orgId, actor.uid);

  const sessRef = db.collection('ai_sessions').doc(input.sessionId);
  const sessSnap = await sessRef.get();
  if (!sessSnap.exists) {
    throw new HttpsError('not-found', 'AI Assistant session not found.');
  }
  const session = sessSnap.data() as AiAssistantSession;

  // Strict cross-builder & user ownership check
  if (session.orgId !== input.orgId) {
    throw new HttpsError(
      'permission-denied',
      'Cross-organization session access rejected.'
    );
  }
  if (session.uid !== actor.uid && !actor.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Session belongs to a different user.');
  }

  const partnerOrgId = input.partnerOrgId ?? session.partnerOrgId ?? null;
  await verifyAiSubjectPermission({
    db,
    actor,
    orgId: input.orgId,
    requiredPermission: 'projects:view',
    targetProjectId: input.contextSnapshot?.activeProjectId ?? session.projectId,
    partnerOrgId,
  });

  const authorizedProjects = await listAuthorizedProjectsTool({
    db,
    actor,
    orgId: input.orgId,
    partnerOrgId,
  });

  const nowIso = new Date().toISOString();
  const userMsg: AiSessionMessage = {
    id: `msg_${Date.now()}_u`,
    role: 'USER',
    content: input.message.trim(),
    createdAt: nowIso,
  };

  // Resolve current project context (UI context, existing session, structured patch, or project name mentioned in message!)
  let resolvedProjectId: string | null =
    (input.structuredAnswerPatch?.projectId as string | undefined) ??
    input.contextSnapshot?.activeProjectId ??
    session.projectId ??
    null;

  let unknownProjectMention: string | null = null;
  if (!resolvedProjectId) {
    const lowerMsg = input.message.trim().toLowerCase();
    const matchedProj = authorizedProjects.find(
      (p) =>
        lowerMsg === p.name.toLowerCase() ||
        lowerMsg === p.code.toLowerCase() ||
        lowerMsg.includes(p.name.toLowerCase())
    );
    if (matchedProj) {
      resolvedProjectId = matchedProj.id;
    } else if (
      session.missingFields.includes('projectId') &&
      authorizedProjects.length > 0
    ) {
      // User was answering "Which project?" with an unrecognized name!
      unknownProjectMention = input.message.trim();
    } else {
      // Check if user said "Add Tower 1 to <Unknown Project>"
      const inProjMatch = input.message.match(
        /\b(?:in|to|under|for)\s+project\s+([A-Za-z0-9 _-]+)$/i
      );
      if (inProjMatch) {
        const candidateName = inProjMatch[1]!.trim();
        const found = authorizedProjects.find(
          (p) => p.name.toLowerCase() === candidateName.toLowerCase()
        );
        if (found) resolvedProjectId = found.id;
        else unknownProjectMention = candidateName;
      }
    }
  }

  const activeProject: Project | null = resolvedProjectId
    ? (authorizedProjects.find((p) => p.id === resolvedProjectId) ?? null)
    : null;

  if (resolvedProjectId && !activeProject) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to access the requested project.'
    );
  }

  const intent =
    session.activeWizard === 'ADD_TOWER' || session.activeWizard === 'ADD_UNITS'
      ? (() => {
          const detected = detectConversationalIntent(input.message);
          return detected.type === 'GENERAL_HELP'
            ? ({ type: 'TOWER_OR_UNIT_WIZARD' } as const)
            : detected;
        })()
      : detectConversationalIntent(input.message);

  const models = getConfiguredAiModels();
  let assistantText = '';
  let structuredQuestions: AiStructuredQuestion[] | undefined;
  let queryResults: AiSessionMessage['queryResults'] | undefined;
  let deepLinks: AiSessionMessage['deepLinks'] | undefined;
  let activeDraft: AiInventoryDraft | null = null;
  let nextWizard = session.activeWizard;
  let nextConfirmationState = session.confirmationState;
  const nextCollected: Record<string, unknown> = {
    ...session.collectedAnswers,
    ...(input.structuredAnswerPatch ?? {}),
    ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
  };

  // =========================================================================
  // BRANCH A: CONVERSATIONAL READ & CRM QUERIES (Phase 3)
  // =========================================================================
  if (intent.type === 'READ_UNITS') {
    if (!activeProject) {
      assistantText =
        authorizedProjects.length === 0
          ? 'No authorized projects exist yet. Create a project first to search inventory.'
          : `Which project would you like me to search? (${authorizedProjects.map((p) => p.name).join(', ')})`;
      structuredQuestions = [
        {
          fieldKey: 'projectId',
          question: 'Select a project to search inventory:',
          inputType: 'PROJECT_SELECT',
          suggestedOptions: authorizedProjects.map((p) => p.name),
          required: true,
        },
      ];
    } else {
      const units = await findExistingUnitsTool({
        db,
        actor,
        orgId: input.orgId,
        partnerOrgId,
        criteria: {
          projectId: activeProject.id,
          status: intent.status,
          bhk: intent.bhk,
          towerNameOrCode: intent.tower,
          facing: intent.facing,
          minFloor: intent.minFloor,
          maxFloor: intent.maxFloor,
          missingFloorPlanOnly: intent.missingFloorPlan,
        },
      });
      assistantText =
        units.length === 0
          ? `Found 0 matching units in ${activeProject.name} for your filter criteria.`
          : `Found ${units.length} matching unit(s) in ${activeProject.name}: ${units
              .slice(0, 6)
              .map((u) => `${u.unitNumber} (${u.bhk}, Fl ${u.floorNumber}, ${u.facing}, ${u.status})`)
              .join(', ')}${units.length > 6 ? '...' : ''}.`;
      queryResults = {
        kind: 'UNITS',
        count: units.length,
        items: units.slice(0, 30) as unknown as Array<Record<string, unknown>>,
      };
      deepLinks = [{ label: 'Open Inventory Matrix', route: '/app/inventory' }];
    }
  } else if (intent.type === 'COUNT_AVAILABILITY') {
    if (!activeProject) {
      assistantText = 'Please select a project first so I can check live floor availability.';
    } else {
      const avail = await getInventoryAvailabilityTool({
        db,
        actor,
        orgId: input.orgId,
        projectId: activeProject.id,
        partnerOrgId,
        minFloor: intent.minFloor,
        maxFloor: intent.maxFloor,
        towerNameOrCode: intent.tower,
      });
      const rangeText =
        intent.minFloor !== undefined && intent.maxFloor !== undefined
          ? ` on floors ${intent.minFloor} to ${intent.maxFloor}`
          : '';
      if (intent.status === 'BOOKED') {
        assistantText = `There are ${avail.byStatus.BOOKED} booked unit(s)${rangeText} in ${activeProject.name} (out of ${avail.totalMatched} total units in that range; ${avail.byStatus.AVAILABLE} available).`;
      } else {
        assistantText = `In ${activeProject.name}${rangeText}: ${avail.byStatus.AVAILABLE} Available, ${avail.byStatus.BOOKED} Booked, ${avail.byStatus.ON_HOLD} On Hold, ${avail.byStatus.RESERVED} Reserved (Total: ${avail.totalMatched}).`;
      }
      queryResults = {
        kind: 'AVAILABILITY_SUMMARY',
        count: avail.totalMatched,
        items: [avail.byStatus as unknown as Record<string, unknown>],
      };
    }
  } else if (intent.type === 'PREPARE_QUOTATION') {
    if (!activeProject) {
      assistantText = 'Please select a project first to prepare a unit cost sheet.';
    } else {
      const preview = await prepareQuotationPreviewTool({
        db,
        actor,
        orgId: input.orgId,
        projectId: activeProject.id,
        unitNumberOrId: intent.unitRef,
        partnerOrgId,
      });
      if (!preview.ready) {
        assistantText = preview.reason ?? 'Unable to prepare quotation preview.';
      } else {
        assistantText = `Prepared deterministic cost-sheet preview for Unit ${preview.unit!.unitNumber} (${preview.unit!.bhk}) using approved Price Book "${preview.priceBook!.name}" (v${preview.priceBook!.versionNumber}): All-inclusive payable = ${preview.breakdown!.currencyCode ?? 'INR'} ${preview.breakdown!.totalPayableInr.toLocaleString('en-IN')}.`;
        queryResults = {
          kind: 'QUOTATION_PREVIEW',
          count: 1,
          items: [preview as unknown as Record<string, unknown>],
        };
        deepLinks = [
          {
            label: `Open Cost Sheet Generator for ${preview.unit!.unitNumber}`,
            route: `/app/pricing?tab=quotations&unitId=${preview.unit!.id}`,
          },
        ];
      }
    }
  } else if (intent.type === 'EXPLAIN_PRICE_CHANGES') {
    if (!activeProject) {
      assistantText = 'Select a project first to inspect recent unit price revisions.';
    } else {
      const rev = await explainInventoryChangesTool({
        db,
        actor,
        orgId: input.orgId,
        projectId: activeProject.id,
        sinceDays: 30,
      });
      assistantText =
        rev.revisionsCount === 0
          ? `No unit price revisions were recorded in ${activeProject.name} over the past 30 days.`
          : `${rev.revisionsCount} unit price revision(s) were recorded in ${activeProject.name} in the past 30 days.`;
      queryResults = {
        kind: 'PRICE_REVISIONS',
        count: rev.revisionsCount,
        items: rev.revisions as unknown as Array<Record<string, unknown>>,
      };
      deepLinks = [{ label: 'Open Price Books & Revisions', route: '/app/pricing' }];
    }
  } else if (intent.type === 'SUMMARIZE_LEADS') {
    if (!activeProject) {
      assistantText = 'Select a project first to summarize interested leads.';
    } else {
      const summary = await summarizeProjectLeadsTool({
        db,
        actor,
        orgId: input.orgId,
        projectId: activeProject.id,
        partnerOrgId,
      });
      assistantText = `Found ${summary.totalProjectLeads} authorized lead(s) interested in ${activeProject.name}.`;
      queryResults = {
        kind: 'LEADS_SUMMARY',
        count: summary.totalProjectLeads,
        items: summary.recentLeads as unknown as Array<Record<string, unknown>>,
      };
      deepLinks = [{ label: 'Open Leads & CRM', route: '/app/leads' }];
    }
  } else if (intent.type === 'MATCH_BUYER_UNITS') {
    if (!activeProject) {
      assistantText = 'Select a project first to match buyer requirements to available units.';
    } else {
      const matched = await prepareLeadMatchingTool({
        db,
        actor,
        orgId: input.orgId,
        projectId: activeProject.id,
        partnerOrgId,
        bhk: intent.bhk,
        budgetMax: intent.budgetMax,
      });
      assistantText = `Matched ${matched.matchingAvailableUnitsCount} AVAILABLE unit(s) in ${activeProject.name} meeting the buyer criteria.`;
      queryResults = {
        kind: 'LEAD_UNIT_MATCHES',
        count: matched.matchingAvailableUnitsCount,
        items: matched.matchingUnits as unknown as Array<Record<string, unknown>>,
      };
    }
  } else if (intent.type === 'CREATE_PRICING_DRAFT') {
    if (!activeProject) {
      assistantText = 'Select a project first to create a draft Price Book.';
    } else {
      const pb = await createPricingDraftTool({
        db,
        actor,
        orgId: input.orgId,
        projectId: activeProject.id,
        name: intent.name || `${activeProject.name} AI Draft Price Book`,
        basePricePerSqft: intent.baseRate,
      });
      assistantText = `Created DRAFT Price Book "${pb.name}" (v${pb.versionNumber}) at base rate ${pb.basePricePerSqft}. Review and submit for approval in Pricing & Cost Sheets.`;
      deepLinks = [{ label: 'Review Draft Price Book', route: '/app/pricing' }];
    }
  } else if (intent.type === 'CREATE_TEMPLATE_DRAFT') {
    const tpl = await createQuotationTemplateDraftTool({
      db,
      actor,
      orgId: input.orgId,
      projectId: activeProject?.id ?? null,
      name: intent.name,
      code: intent.code,
    });
    assistantText = `Created customizable Cost-Sheet Template "${tpl.name}" (${tpl.code}).`;
    deepLinks = [{ label: 'Open Pricing & Templates', route: '/app/pricing' }];
  }
  // =========================================================================
  // BRANCH B: PROGRESSIVE TOWER / FLOOR / UNIT CONVERSATIONAL WIZARD (Phase 1)
  // =========================================================================
  else if (intent.type === 'TOWER_OR_UNIT_WIZARD') {
    // Channel partners cannot create internal builder towers/units!
    if (partnerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'Channel partners cannot create or modify builder inventory structures.'
      );
    }

    await verifyAiSubjectPermission({
      db,
      actor,
      orgId: input.orgId,
      requiredPermission: 'inventory:manage',
      targetProjectId: resolvedProjectId,
      disallowChannelPartner: true,
    });

    nextWizard = 'ADD_TOWER';

    // Load or initialize staged draft
    if (session.draftId) {
      const dSnap = await db.collection('ai_inventory_drafts').doc(session.draftId).get();
      if (dSnap.exists && dSnap.data()?.orgId === input.orgId) {
        activeDraft = dSnap.data() as AiInventoryDraft;
      }
    }

    if (!activeDraft || activeDraft.status === 'COMMITTED' || activeDraft.status === 'CANCELLED') {
      const draftId = db.collection('ai_inventory_drafts').doc().id;
      activeDraft = {
        id: draftId,
        orgId: input.orgId,
        projectId: resolvedProjectId,
        sessionId: session.id,
        createdByUid: actor.uid,
        draftKind: 'TOWER_INVENTORY',
        propertyCategory:
          activeProject?.projectType === 'VILLA'
            ? 'VILLA'
            : activeProject?.projectType === 'PLOTTED'
              ? 'PLOT'
              : activeProject?.projectType === 'COMMERCIAL'
                ? 'COMMERCIAL'
                : 'APARTMENT',
        sourceType: 'CONVERSATIONAL_WIZARD',
        status: 'COLLECTING_INFO',
        towerSpec: {
          towerType: 'TOWER',
          refugeFloors: [],
          excludedFloors: [],
        },
        floorTemplates: [],
        proposedUnits: [],
        linkedDocumentIds: [...session.uploadedDocumentIds],
        extractedEvidence: [],
        missingQuestions: [],
        conflicts: [],
        changeSummary: {
          towersToCreate: 0,
          floorsToCreate: 0,
          unitsToCreate: 0,
          unitsToUpdate: 0,
          unitsSkipped: 0,
          duplicateRecordsDetected: 0,
          missingInfoCount: 0,
          documentsToLink: 0,
          conflictsCount: 0,
          readyToCommit: false,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }

    if (resolvedProjectId) {
      activeDraft.projectId = resolvedProjectId;
    }

    // Parse slots from user message (including natural corrections!)
    const slots = extractTowerWizardSlotsFromMessage(input.message);

    // Optional OpenAI Responses API (`gpt-6.1-sol`) slot extraction enrichment when customClient is passed
    if (customClient) {
      try {
        await invokeStructuredResponsesApi<{ acknowledged: boolean }>({
          db,
          actor,
          orgId: input.orgId,
          feature: 'CONVERSATIONAL_ORCHESTRATION',
          model: models.orchestrator,
          instructions:
            'Extract real estate inventory parameters without inventing values not stated by the user.',
          input: input.message,
          schemaName: 'wizard_turn_ack',
          jsonSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['acknowledged'],
            properties: { acknowledged: { type: 'boolean' } },
          },
          creditsCost: 1,
          entityType: 'ai_session',
          entityId: session.id,
          customClient,
        });
      } catch {
        // Non-fatal if custom client only mocks vision or throws
      }
    }

    if (slots.towerName) {
      activeDraft.towerSpec.name = slots.towerName;
      activeDraft.towerSpec.code = slots.towerCode;
      nextCollected.towerName = slots.towerName;
    }

    // Also bind to existing tower if user says "Add four new flats to floors 5 through 10" and selectedTowerId is in context!
    if (!activeDraft.towerSpec.name && resolvedProjectId) {
      if (input.contextSnapshot?.selectedTowerId) {
        const twSnap = await db
          .collection('towers')
          .doc(input.contextSnapshot.selectedTowerId)
          .get();
        if (twSnap.exists && twSnap.data()?.orgId === input.orgId) {
          activeDraft.towerSpec.existingTowerId = twSnap.id;
          activeDraft.towerSpec.name = twSnap.data()?.name;
          activeDraft.towerSpec.code = twSnap.data()?.code;
        }
      } else if (slots.residentialStartFloor && slots.residentialEndFloor && slots.unitsPerFloor) {
        // Check if project has an existing single tower to append to
        const existingTwSnap = await db
          .collection('towers')
          .where('orgId', '==', input.orgId)
          .where('projectId', '==', resolvedProjectId)
          .limit(1)
          .get();
        if (!existingTwSnap.empty) {
          const tw = existingTwSnap.docs[0]!;
          activeDraft.towerSpec.existingTowerId = tw.id;
          activeDraft.towerSpec.name = tw.data().name;
          activeDraft.towerSpec.code = tw.data().code;
          activeDraft.towerSpec.totalFloors = Math.max(
            tw.data().totalFloors ?? 0,
            slots.residentialEndFloor
          );
        }
      }
    }

    if (typeof slots.totalFloors === 'number') {
      activeDraft.towerSpec.totalFloors = slots.totalFloors;
      nextCollected.totalFloors = slots.totalFloors;
      // If a typical floor template already existed, update its end floor on natural correction!
      if (activeDraft.floorTemplates.length > 0 && !slots.residentialEndFloor) {
        const startFl = activeDraft.towerSpec.residentialStartFloor ?? 1;
        activeDraft.towerSpec.residentialEndFloor = slots.totalFloors;
        activeDraft.floorTemplates = activeDraft.floorTemplates.map((tpl) =>
          tpl.floorCategory === 'TYPICAL'
            ? {
                ...tpl,
                applicableFloors: Array.from(
                  { length: Math.max(0, slots.totalFloors! - startFl + 1) },
                  (_, i) => startFl + i
                ),
              }
            : tpl
        );
      }
    }

    if (typeof slots.residentialStartFloor === 'number' && typeof slots.residentialEndFloor === 'number') {
      activeDraft.towerSpec.residentialStartFloor = slots.residentialStartFloor;
      activeDraft.towerSpec.residentialEndFloor = slots.residentialEndFloor;
      nextCollected.residentialStartFloor = slots.residentialStartFloor;
      nextCollected.residentialEndFloor = slots.residentialEndFloor;

      // Also resolve unbounded Typical Floor templates if any were waiting for floor range!
      if (activeDraft.floorTemplates.some((t) => t.isTypicalUnbounded)) {
        const rangeFloors = Array.from(
          { length: slots.residentialEndFloor - slots.residentialStartFloor + 1 },
          (_, i) => slots.residentialStartFloor! + i
        );
        activeDraft.floorTemplates = activeDraft.floorTemplates.map((t) =>
          t.isTypicalUnbounded
            ? { ...t, applicableFloors: rangeFloors, isTypicalUnbounded: false }
            : t
        );
      }
    }

    if (slots.hasGroundLobby !== undefined) {
      activeDraft.towerSpec.hasGroundLobby = slots.hasGroundLobby;
    }
    if (slots.podiumLevels !== undefined) {
      activeDraft.towerSpec.podiumLevels = slots.podiumLevels;
    }
    if (slots.stiltLevels !== undefined) {
      activeDraft.towerSpec.stiltLevels = slots.stiltLevels;
    }
    if (slots.refugeFloors) {
      activeDraft.towerSpec.refugeFloors = slots.refugeFloors;
    }
    if (slots.excludedFloors) {
      activeDraft.towerSpec.excludedFloors = slots.excludedFloors;
    }

    if (slots.unitsPerFloor) {
      nextCollected.unitsPerFloor = slots.unitsPerFloor;
    }
    if (slots.numberingConfirmed) {
      nextCollected.numberingConfirmed = true;
    }
    if (slots.numberingPattern) {
      nextCollected.numberingPattern = slots.numberingPattern;
    }
    if (slots.bhkMix) {
      nextCollected.bhkMix = slots.bhkMix;
    }
    if (slots.positionConfirmed) {
      nextCollected.positionConfirmed = true;
    }

    // Build / update floor templates when we know floor range/count + unitsPerFloor!
    const effStart = activeDraft.towerSpec.residentialStartFloor ?? 1;
    const effEnd =
      activeDraft.towerSpec.residentialEndFloor ?? activeDraft.towerSpec.totalFloors;
    const effUpf = (nextCollected.unitsPerFloor as number | undefined) ?? undefined;

    if (typeof effEnd === 'number' && effEnd >= effStart && typeof effUpf === 'number' && effUpf > 0) {
      const mix =
        (nextCollected.bhkMix as WizardExtractedSlots['bhkMix'] | undefined) ?? [];
      const positions: AiUnitPositionTemplate[] = [];
      let posCursor = 1;
      for (const item of mix) {
        for (let c = 0; c < item.count && posCursor <= effUpf; c++) {
          positions.push({
            positionIndex: posCursor,
            unitSuffix: String(posCursor).padStart(2, '0'),
            unitType: 'APARTMENT',
            bhk: item.bhk,
            saleableAreaSqft: item.saleableAreaSqft ?? (item.bhk.startsWith('4') ? 2600 : 1850),
            carpetAreaSqft: item.saleableAreaSqft
              ? Math.round(item.saleableAreaSqft * 0.7)
              : item.bhk.startsWith('4')
                ? 1820
                : 1295,
            facing: item.facing ?? (posCursor % 2 === 1 ? 'EAST' : 'NORTH'),
            parkingEntitlementCount: item.bhk.startsWith('4') ? 2 : 1,
          });
          posCursor++;
        }
      }
      while (posCursor <= effUpf) {
        positions.push({
          positionIndex: posCursor,
          unitSuffix: String(posCursor).padStart(2, '0'),
          unitType: 'APARTMENT',
          bhk: '3 BHK',
          saleableAreaSqft: 1850,
          carpetAreaSqft: 1295,
          facing: posCursor % 2 === 1 ? 'EAST' : 'NORTH',
          parkingEntitlementCount: 1,
        });
        posCursor++;
      }

      const pattern =
        (nextCollected.numberingPattern as 'FLOOR_INDEX_3DIGIT' | 'TOWER_FLOOR_INDEX' | undefined) ??
        'FLOOR_INDEX_3DIGIT';

      const typicalFloors: number[] = [];
      for (let fl = effStart; fl <= effEnd; fl++) {
        if (slots.exceptionalFloor?.floorNumber === fl) continue;
        typicalFloors.push(fl);
      }

      const updatedTemplates: AiFloorTemplateSpec[] = [
        {
          id: 'tpl_typical_main',
          label: `Typical Residential Floors (${effStart}–${effEnd})`,
          floorCategory: 'TYPICAL',
          applicableFloors: typicalFloors,
          unitsPerFloor: effUpf,
          numberingPattern: pattern,
          positionConfigs: positions,
        },
      ];

      // Preserve any previously added exceptional floor templates OR add newly specified exceptional floor
      const prevExceptionals = activeDraft.floorTemplates.filter(
        (t) => t.id !== 'tpl_typical_main' && !t.id.startsWith('tpl_doc_')
      );
      if (slots.exceptionalFloor) {
        const ef = slots.exceptionalFloor;
        const exPos: AiUnitPositionTemplate[] = Array.from(
          { length: ef.unitsCount },
          (_, i) => ({
            positionIndex: i + 1,
            unitSuffix: String(i + 1).padStart(2, '0'),
            unitType: ef.unitType,
            bhk: ef.bhk,
            saleableAreaSqft: ef.saleableAreaSqft ?? 3600,
            carpetAreaSqft: Math.round((ef.saleableAreaSqft ?? 3600) * 0.72),
            facing: 'EAST',
            parkingEntitlementCount: 2,
          })
        );
        updatedTemplates.push({
          id: `tpl_exc_${ef.floorNumber}`,
          label: `Exceptional Floor ${ef.floorNumber} (${ef.unitType})`,
          floorCategory: ef.unitType === 'PENTHOUSE' ? 'PENTHOUSE' : 'LOWER_RESIDENTIAL',
          applicableFloors: [ef.floorNumber],
          unitsPerFloor: ef.unitsCount,
          numberingPattern: pattern,
          positionConfigs: exPos,
        });
      } else if (prevExceptionals.length > 0) {
        // Remove overridden floor from typicalFloors
        for (const pe of prevExceptionals) {
          updatedTemplates[0]!.applicableFloors = updatedTemplates[0]!.applicableFloors.filter(
            (f) => !pe.applicableFloors.includes(f)
          );
          updatedTemplates.push(pe);
        }
      }

      activeDraft.floorTemplates = updatedTemplates;
    }

    // Recompute preview, conflicts & missing questions
    activeDraft = await recomputeDraftPreviewAndConflicts(db, activeDraft, true);
    await db.collection('ai_inventory_drafts').doc(activeDraft.id).set(activeDraft);

    // Determine conversational next step (ask ONE logical question at a time, never re-asking known facts!)
    if (unknownProjectMention) {
      assistantText = `I couldn't find an authorized project matching "${unknownProjectMention}". Which project should I add ${activeDraft.towerSpec.name || 'this inventory'} to? Available projects: ${authorizedProjects.map((p) => p.name).join(', ')}.`;
      structuredQuestions = [
        {
          fieldKey: 'projectId',
          question: 'Choose an authorized project:',
          inputType: 'PROJECT_SELECT',
          suggestedOptions: authorizedProjects.map((p) => p.name),
          required: true,
        },
      ];
    } else if (!activeDraft.projectId) {
      assistantText = `Which project should I add ${activeDraft.towerSpec.name || 'this tower'} to?`;
      structuredQuestions = [
        {
          fieldKey: 'projectId',
          question: 'Which project should I add it to?',
          inputType: 'PROJECT_SELECT',
          suggestedOptions: authorizedProjects.map((p) => p.name),
          required: true,
        },
      ];
    } else if (!activeDraft.towerSpec.name && !activeDraft.towerSpec.existingTowerId) {
      assistantText = `What should we name this tower or block in ${activeProject?.name}? (e.g., Tower 1, Tower A)`;
      structuredQuestions = activeDraft.missingQuestions;
    } else if (typeof activeDraft.towerSpec.totalFloors !== 'number') {
      assistantText = `How many floors will ${activeDraft.towerSpec.name} have in ${activeProject?.name}?`;
      structuredQuestions = activeDraft.missingQuestions;
    } else if (typeof nextCollected.unitsPerFloor !== 'number') {
      assistantText = `Are all ${activeDraft.towerSpec.totalFloors} floors residential, or are there any ground-floor lobby, podium, stilt, refuge, or skipped floors? And how many apartments are on each residential floor?`;
      structuredQuestions = activeDraft.missingQuestions;
    } else if (!nextCollected.numberingConfirmed && !nextCollected.bhkMix) {
      const upf = nextCollected.unitsPerFloor as number;
      assistantText = `How should I number the units across ${activeDraft.towerSpec.name}? I can use 101–1${String(upf).padStart(2, '0')} on the first floor, 201–2${String(upf).padStart(2, '0')} on the second floor, and so on (or prefix with ${activeDraft.towerSpec.code}-101). Also, what BHK configurations apply to the ${upf} units per floor?`;
      structuredQuestions = [
        {
          fieldKey: 'numberingPattern',
          question: 'Confirm unit numbering & BHK configuration:',
          inputType: 'NUMBERING_PATTERN',
          suggestedOptions: [
            `Yes, use 101–1${String(upf).padStart(2, '0')} numbering`,
            `Use ${activeDraft.towerSpec.code}-101 tower-prefixed numbering`,
          ],
          required: false,
        },
      ];
    } else if (nextCollected.bhkMix && !nextCollected.positionConfirmed && session.uploadedDocumentIds.length === 0) {
      assistantText = `Preview updated (${activeDraft.changeSummary.unitsToCreate} units across ${activeDraft.changeSummary.floorsToCreate} floors). Which unit positions use each configuration (currently assigned sequentially across positions 1–${nextCollected.unitsPerFloor}), and do you have a floor-plan PDF/image to upload before approving?`;
      structuredQuestions = [
        {
          fieldKey: 'floorPlanUpload',
          question: 'Upload a floor plan PDF/image (optional) or confirm unit positions to review & commit:',
          inputType: 'FILE_UPLOAD',
          suggestedOptions: ['Positions look good — ready to review & approve'],
          required: false,
        },
      ];
      nextConfirmationState = activeDraft.changeSummary.readyToCommit
        ? 'AWAITING_USER_CONFIRMATION'
        : 'IDLE';
    } else {
      const conflictNote =
        activeDraft.conflicts.length > 0
          ? ` ⚠️ Detected ${activeDraft.conflicts.length} conflict(s): ${activeDraft.conflicts[0]!.message}`
          : '';
      assistantText = `Prepared proposed structure for ${activeDraft.towerSpec.name} in ${activeProject?.name}: ${activeDraft.changeSummary.towersToCreate} tower, ${activeDraft.changeSummary.floorsToCreate} floor(s), and ${activeDraft.changeSummary.unitsToCreate} unit(s).${conflictNote} Review the preview and click "Approve & Create Inventory" when ready.`;
      structuredQuestions = activeDraft.missingQuestions;
      nextConfirmationState = activeDraft.changeSummary.readyToCommit
        ? 'AWAITING_USER_CONFIRMATION'
        : 'IDLE';
    }
  } else {
    // GENERAL HELP / CAPABILITY OVERVIEW
    assistantText = activeProject
      ? `I'm connected to **${activeProject.name}** (${activeProject.code}). You can ask me to:\n• "Add Tower 1" (guided multi-floor inventory wizard)\n• Upload a floor-plan PDF or image for structured extraction\n• "Show all available 3 BHK flats" or "How many flats are booked on floors 10 to 20?"\n• "Prepare a cost sheet for Unit ..."\n• "Show all leads interested in this project"`
      : `Welcome to the Bharat Makaan AI Assistant. Tell me what you'd like to do—for example: "Add Tower 1", "Search available 3 BHK apartments", or upload a floor-plan PDF to extract a reviewable inventory draft.`;
  }

  const replyMessage: AiSessionMessage = {
    id: `msg_${Date.now()}_a`,
    role: 'ASSISTANT',
    content: assistantText,
    structuredQuestions:
      structuredQuestions && structuredQuestions.length > 0 ? structuredQuestions : undefined,
    queryResults,
    draftPreviewId: activeDraft?.id ?? session.draftId ?? null,
    deepLinks,
    modelUsed: customClient || process.env.OPENAI_API_KEY ? models.orchestrator : 'DETERMINISTIC_DOMAIN_ENGINE',
    createdAt: new Date().toISOString(),
  };

  const updatedSession: AiAssistantSession = {
    ...session,
    projectId: resolvedProjectId,
    contextSnapshot: {
      ...session.contextSnapshot,
      ...(input.contextSnapshot ?? {}),
      activeProjectId: resolvedProjectId,
    },
    activeWizard: nextWizard,
    draftId: activeDraft?.id ?? session.draftId ?? null,
    collectedAnswers: nextCollected,
    missingFields: (structuredQuestions ?? []).map((q) => q.fieldKey),
    confirmationState: nextConfirmationState,
    messages: [...session.messages, userMsg, replyMessage].slice(-80),
    updatedAt: new Date().toISOString(),
  };

  await sessRef.set(updatedSession);

  return {
    session: updatedSession,
    replyMessage,
    draft: activeDraft,
  };
}

/**
 * Interactive Review & Correction Service (`updateAiInventoryDraftService`).
 * Supports manual edits to tower specs, Typical Floor range confirmation,
 * unit renaming, BHK/area/facing overrides, skipping units, and marks provenance as `USER_CORRECTED`.
 */
export async function updateAiInventoryDraftService(
  db: Firestore,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<AiInventoryDraft> {
  const input = updateAiInventoryDraftSchema.parse(rawInput);

  const draftRef = db.collection('ai_inventory_drafts').doc(input.draftId);
  const snap = await draftRef.get();
  if (!snap.exists || snap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'AI inventory draft not found in organization.');
  }

  const existing = snap.data() as AiInventoryDraft;
  const targetProjectId = input.projectId ?? existing.projectId;

  const subject = await verifyAiSubjectPermission({
    db,
    actor,
    orgId: input.orgId,
    requiredPermission: 'inventory:manage',
    targetProjectId,
    disallowChannelPartner: true,
  });

  if (existing.status === 'COMMITTED') {
    throw new HttpsError('failed-precondition', 'Committed drafts cannot be modified.');
  }

  let nextTowerSpec = {
    ...existing.towerSpec,
    ...(input.towerSpecPatch ?? {}),
  };

  let nextTemplates = existing.floorTemplates;
  let shouldRebuildUnits = false;

  if (input.floorTemplatesPatch) {
    nextTemplates = input.floorTemplatesPatch;
    shouldRebuildUnits = true;
  } else if (input.towerSpecPatch) {
    shouldRebuildUnits = existing.floorTemplates.length > 0;
  }

  let nextProposedUnits = existing.proposedUnits;
  const nextEvidence = [...existing.extractedEvidence];

  if (input.unitEdits && input.unitEdits.length > 0) {
    const editMap = new Map(input.unitEdits.map((e) => [e.tempId, e]));
    nextProposedUnits = existing.proposedUnits.map((u) => {
      const patch = editMap.get(u.tempId);
      if (!patch) return u;
      nextEvidence.push({
        id: `ev_corr_${Date.now()}_${u.tempId}`,
        fieldPath: `proposedUnits[${u.tempId}]`,
        label: `Manual Review Edit (${patch.unitNumber ?? u.unitNumber})`,
        value: patch,
        sourceDocumentId: u.floorPlanDocumentId ?? 'USER_REVIEW_UI',
        sourceFileName: 'Interactive Review Correction',
        sourcePage: u.sourcePage ?? 1,
        extractionStatus: 'USER_CORRECTED',
        confidence: 1,
        reviewStatus: patch.operation === 'SKIP' ? 'SKIPPED' : 'CORRECTED',
      });
      return {
        ...u,
        operation: patch.operation ?? u.operation,
        unitNumber: patch.unitNumber ? patch.unitNumber.trim().toUpperCase() : u.unitNumber,
        bhk: patch.bhk ?? u.bhk,
        unitType: patch.unitType ?? u.unitType,
        saleableAreaSqft: patch.saleableAreaSqft ?? u.saleableAreaSqft,
        carpetAreaSqft: patch.carpetAreaSqft ?? u.carpetAreaSqft,
        facing: patch.facing ?? u.facing,
        floorNumber: patch.floorNumber ?? u.floorNumber,
        parkingEntitlementCount: patch.parkingEntitlementCount ?? u.parkingEntitlementCount,
        floorPlanDocumentId:
          patch.floorPlanDocumentId !== undefined
            ? patch.floorPlanDocumentId
            : u.floorPlanDocumentId,
        reviewStatus: patch.operation === 'SKIP' ? 'SKIPPED' : 'CORRECTED',
        confidence: 1,
        warnings: [],
      };
    });
  }

  const updated = await recomputeDraftPreviewAndConflicts(
    db,
    {
      ...existing,
      projectId: targetProjectId,
      towerSpec: nextTowerSpec,
      floorTemplates: nextTemplates,
      proposedUnits: nextProposedUnits,
      extractedEvidence: nextEvidence,
    },
    shouldRebuildUnits
  );

  await draftRef.set(updated);

  await writeAuditEvent(db, {
    orgId: input.orgId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: subject.role,
    action: 'AI_INVENTORY_DRAFT_UPDATED',
    category: 'AI',
    entityType: 'ai_inventory_draft',
    entityId: updated.id,
    summary: `Updated staged AI inventory draft (${updated.id}): ${updated.changeSummary.unitsToCreate} units to create, ${updated.changeSummary.conflictsCount} conflicts.`,
  });

  return updated;
}
