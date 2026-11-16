/**
 * @bharat-makaan/validation — Strict Schemas for Internal AI Assistant,
 * Floor-Plan Document Extraction & Staged Inventory Commits
 */

import { z } from 'zod';

const unitTypeSchema = z.enum([
  'APARTMENT',
  'PENTHOUSE',
  'VILLA',
  'INDEPENDENT_HOUSE',
  'PLOT',
  'SHOP',
  'RETAIL_SPACE',
  'OFFICE',
  'COMMERCIAL_UNIT',
]);

const towerTypeSchema = z.enum([
  'TOWER',
  'BLOCK',
  'BUILDING',
  'SECTOR',
  'VILLA_CLUSTER',
  'COMMUNITY',
  'RETAIL_WING',
]);

export const aiContextSnapshotSchema = z.object({
  currentRoute: z.string().max(160).optional(),
  activeProjectId: z.string().nullable().optional(),
  selectedTowerId: z.string().nullable().optional(),
  selectedUnitId: z.string().nullable().optional(),
});

export const createAiSessionSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  partnerOrgId: z.string().nullable().optional(),
  title: z.string().max(140).optional(),
  contextSnapshot: aiContextSnapshotSchema.optional(),
});

export const sendAiMessageSchema = z.object({
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
  partnerOrgId: z.string().nullable().optional(),
  message: z.string().min(1, 'Message cannot be empty').max(4000),
  contextSnapshot: aiContextSnapshotSchema.optional(),
  structuredAnswerPatch: z.record(z.string(), z.unknown()).optional(),
});

export const analyzeAiFloorPlanDocumentsSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1, 'Target project is required for document analysis'),
  sessionId: z.string().min(1),
  documents: z
    .array(
      z.object({
        documentId: z.string().optional(),
        title: z.string().min(1).max(160),
        fileName: z.string().min(1).max(200),
        mimeType: z.enum([
          'application/pdf',
          'image/png',
          'image/jpeg',
          'image/webp',
        ]),
        sizeBytes: z.coerce
          .number()
          .int()
          .positive()
          .max(25 * 1024 * 1024, 'Maximum file size is 25 MB'),
        storagePath: z.string().min(5).max(500),
        base64Content: z.string().max(35 * 1024 * 1024).optional(),
      })
    )
    .min(1)
    .max(10),
});

export const aiUnitPositionPatchSchema = z.object({
  positionIndex: z.coerce.number().int().min(1).max(100),
  unitSuffix: z.string().max(12).optional(),
  unitType: unitTypeSchema,
  bhk: z.string().min(1).max(40),
  saleableAreaSqft: z.coerce.number().positive().optional(),
  carpetAreaSqft: z.coerce.number().positive().optional(),
  facing: z
    .enum([
      'EAST',
      'WEST',
      'NORTH',
      'SOUTH',
      'NORTH_EAST',
      'NORTH_WEST',
      'SOUTH_EAST',
      'SOUTH_WEST',
    ])
    .optional(),
  isCorner: z.boolean().optional(),
  balconiesCount: z.coerce.number().int().min(0).max(20).optional(),
  parkingEntitlementCount: z.coerce.number().int().min(0).max(50).optional(),
  floorPlanDocumentId: z.string().nullable().optional(),
});

export const updateAiInventoryDraftSchema = z.object({
  orgId: z.string().min(1),
  draftId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  towerSpecPatch: z
    .object({
      existingTowerId: z.string().nullable().optional(),
      phaseId: z.string().nullable().optional(),
      name: z.string().min(1).max(80).optional(),
      code: z.string().min(1).max(20).optional(),
      towerType: towerTypeSchema.optional(),
      totalFloors: z.coerce.number().int().min(0).max(200).optional(),
      residentialStartFloor: z.coerce.number().int().min(0).max(200).optional(),
      residentialEndFloor: z.coerce.number().int().min(0).max(200).optional(),
      hasGroundLobby: z.boolean().optional(),
      stiltLevels: z.coerce.number().int().min(0).max(10).optional(),
      podiumLevels: z.coerce.number().int().min(0).max(15).optional(),
      basementLevels: z.coerce.number().int().min(0).max(15).optional(),
      refugeFloors: z.array(z.coerce.number().int().min(0).max(200)).optional(),
      excludedFloors: z.array(z.coerce.number().int().min(0).max(200)).optional(),
    })
    .optional(),
  floorTemplatesPatch: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(120),
        floorCategory: z.enum([
          'PODIUM',
          'LOWER_RESIDENTIAL',
          'TYPICAL',
          'PENTHOUSE',
          'REFUGE',
          'COMMERCIAL',
          'GROUND_PLOT',
        ]),
        applicableFloors: z.array(z.coerce.number().int().min(0).max(200)),
        isTypicalUnbounded: z.boolean().optional(),
        unitsPerFloor: z.coerce.number().int().min(1).max(100),
        numberingPattern: z.enum([
          'FLOOR_INDEX_3DIGIT',
          'TOWER_FLOOR_INDEX',
          'SEQUENTIAL_GROUND',
          'CUSTOM_PREFIX',
        ]),
        customPrefix: z.string().max(20).optional(),
        positionConfigs: z.array(aiUnitPositionPatchSchema),
        sourceDocumentId: z.string().nullable().optional(),
        sourcePage: z.coerce.number().int().nullable().optional(),
      })
    )
    .optional(),
  unitEdits: z
    .array(
      z.object({
        tempId: z.string().min(1),
        operation: z.enum(['CREATE', 'UPDATE', 'SKIP']).optional(),
        unitNumber: z.string().min(1).max(40).optional(),
        bhk: z.string().min(1).max(40).optional(),
        unitType: unitTypeSchema.optional(),
        saleableAreaSqft: z.coerce.number().positive().optional(),
        carpetAreaSqft: z.coerce.number().positive().optional(),
        facing: z
          .enum([
            'EAST',
            'WEST',
            'NORTH',
            'SOUTH',
            'NORTH_EAST',
            'NORTH_WEST',
            'SOUTH_EAST',
            'SOUTH_WEST',
          ])
          .optional(),
        floorNumber: z.coerce.number().int().min(0).max(200).optional(),
        parkingEntitlementCount: z.coerce.number().int().min(0).max(50).optional(),
        floorPlanDocumentId: z.string().nullable().optional(),
      })
    )
    .optional(),
});

export const confirmAndCommitAiDraftSchema = z.object({
  orgId: z.string().min(1),
  sessionId: z.string().optional(),
  draftId: z.string().min(1),
  idempotencyKey: z.string().min(6).max(120),
  confirmationNote: z.string().max(300).optional(),
});

export const cancelAiDraftSchema = z.object({
  orgId: z.string().min(1),
  sessionId: z.string().optional(),
  draftId: z.string().min(1),
  reason: z.string().max(300).optional(),
});
