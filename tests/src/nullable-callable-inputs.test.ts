import { describe, expect, it } from 'vitest';
import {
  createQuotationSchema,
  createLeadSchema,
  sendAiMessageSchema,
  upsertPriceBookSchema,
} from '@bharat-makaan/validation';
import { isAiFloorPlanStoragePath } from '../../functions/src/documents/ai-floorplan-path';

describe('callable input validation', () => {
  it('accepts null for optional client fields', () => {
    expect(upsertPriceBookSchema.shape.priceBookId.parse(null)).toBeNull();
    expect(createLeadSchema.shape.campaign.parse(null)).toBeNull();
    expect(sendAiMessageSchema.shape.structuredAnswerPatch.parse(null)).toBeNull();
    expect(createQuotationSchema.shape.discount.shape.reason.parse(null)).toBeNull();
  });

  it('allows AI upload authorization only for a project floor-plan path', () => {
    const allowed = {
      orgId: 'org-1',
      projectId: 'project-1',
      category: 'FLOOR_PLAN',
      storagePath:
        'organizations/org-1/projects/project-1/ai-floorplans/plan.pdf',
    };
    expect(isAiFloorPlanStoragePath(allowed)).toBe(true);
    expect(
      isAiFloorPlanStoragePath({
        ...allowed,
        storagePath: 'organizations/org-2/projects/project-1/ai-floorplans/plan.pdf',
      })
    ).toBe(false);
    expect(
      isAiFloorPlanStoragePath({
        ...allowed,
        category: 'BROCHURE',
      })
    ).toBe(false);
    expect(
      isAiFloorPlanStoragePath({
        ...allowed,
        storagePath:
          'organizations/org-1/projects/project-1/ai-floorplans/nested/plan.pdf',
      })
    ).toBe(false);
  });
});
