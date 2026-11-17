import { describe, expect, it } from 'vitest';
import { bulkGenerateTowerUnitsService, transitionUnitStatusService } from '../../functions/src/inventory';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService } from '../../functions/src/projects';
import { ingestLeadService } from '../../functions/src/leads';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const actor = { uid: 'builder', email: 'builder@example.com', isSuperAdmin: false, mfaVerified: true };
async function fixture() {
  const db = createTransactionalTestFirestore();
  const { organization } = await createOrganizationService(db, actor, {
    name: 'Test Builders', legalName: 'Test Builders Ltd', headquartersCity: 'Hyderabad',
  });
  const project = await createProjectService(db, actor, 'BUILDER_ADMIN', {
    orgId: organization.id, builderName: 'Test Builders', name: 'Test Towers', code: 'TT',
    city: 'Hyderabad', locality: 'Kondapur', address: 'Test street Kondapur', reraNumber: 'TEST-RERA-001',
    projectType: 'APARTMENT', configurations: ['2 BHK', '3 BHK'], constructionStatus: 'UNDER_CONSTRUCTION',
  });
  const input = { orgId: organization.id, projectId: project.id, towerCode: 'A', startFloor: 1, endFloor: 2,
    unitsPerFloor: 2, startUnitNumber: 1, bhk: '2 BHK', saleableAreaSqft: 1200, carpetAreaSqft: 900,
    facing: 'EAST', baseRatePerSqft: 7000 };
  return { db, input };
}

describe('Inventory and customer workflow', () => {
  it('adds a second flat size, attaches its floorplan, and reports duplicates on retry', async () => {
    const { db, input } = await fixture();
    expect(await bulkGenerateTowerUnitsService(db, actor, 'BUILDER_ADMIN', input)).toEqual({ createdCount: 4, skippedCount: 0 });
    const second = { ...input, startUnitNumber: 3, saleableAreaSqft: 1800, bhk: '3 BHK',
      floorPlanStoragePath: `organizations/${input.orgId}/projects/${input.projectId}/floorplans/test-image` };
    expect(await bulkGenerateTowerUnitsService(db, actor, 'BUILDER_ADMIN', second)).toEqual({ createdCount: 4, skippedCount: 0 });
    expect(await bulkGenerateTowerUnitsService(db, actor, 'BUILDER_ADMIN', second)).toEqual({ createdCount: 0, skippedCount: 4 });
    const units = await db.collection('units').get();
    expect(units.size).toBe(8);
    const added = units.docs.find((doc) => doc.data()?.unitNumber === 'A-103')!.data();
    expect(added?.saleableAreaSqft).toBe(1800);
    expect(added?.floorPlanStoragePath).toBe(second.floorPlanStoragePath);
    await expect(bulkGenerateTowerUnitsService(db, actor, 'BUILDER_ADMIN', { ...second, startUnitNumber: 5, floorPlanStoragePath: 'organizations/other/floorplans/image' })).rejects.toThrow(/this project/);
    await expect(bulkGenerateTowerUnitsService(db, actor, 'BUILDER_ADMIN', { ...input, projectId: 'missing' })).rejects.toThrow(/Project not found/);
  });

  it('keeps a lead separate from inventory until held and validates advance ownership and reference', async () => {
    const { db, input } = await fixture();
    await bulkGenerateTowerUnitsService(db, actor, 'BUILDER_ADMIN', input);
    const { lead } = await ingestLeadService(db, actor, 'BUILDER_ADMIN', {
      orgId: input.orgId, projectId: input.projectId, customerName: 'Test Customer', phone: '+919876543210', source: 'MANUAL', whatsappOptIn: false,
    });
    const unit = (await db.collection('units').get()).docs[0]!;
    expect(unit.data()?.status).toBe('AVAILABLE');
    const hold = { orgId: input.orgId, unitId: unit.id, targetStatus: 'ON_HOLD', action: 'HOLD', leadId: lead.id, holdAdvanceAmount: 50000 };
    await expect(transitionUnitStatusService(db, actor, 'BUILDER_ADMIN', hold)).rejects.toThrow(/reference/);
    await db.collection('leads').doc('foreign').set({ orgId: 'other' });
    await expect(transitionUnitStatusService(db, actor, 'BUILDER_ADMIN', { ...hold, leadId: 'foreign', holdPaymentReference: 'R1' })).rejects.toThrow(/this organization/);
    await transitionUnitStatusService(db, actor, 'BUILDER_ADMIN', { ...hold, holdPaymentReference: 'R1' });
    const held = (await unit.ref.get()).data();
    expect(held?.status).toBe('ON_HOLD');
    expect(held?.heldForLeadId).toBe(lead.id);
    expect(held?.holdAdvanceAmount).toBe(50000);
    expect(held?.holdPaymentReference).toBe('R1');
  });
});
