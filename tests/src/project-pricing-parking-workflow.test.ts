import { describe, expect, it, vi } from 'vitest';
import type { PriceBook, Unit } from '@bharat-makaan/shared';
import { calculateCostSheet, getQuotationPriceBooks } from '@bharat-makaan/shared';
import { createOrganizationService } from '../../functions/src/organizations';
import { registerDocumentService } from '../../functions/src/documents';
import { createProjectService, createTowerService, updateProjectDetailsService } from '../../functions/src/projects';
import { createUnitService, updateUnitService } from '../../functions/src/inventory';
import { allocateParkingSlotService, createParkingSlotService, releaseParkingSlotService, swapParkingSlotsService } from '../../functions/src/parking';
import type { PricingScopeOverride } from '@bharat-makaan/shared';
import { applyPriceBookToInventory, ensureBaselinePriceBookForProject, savePriceBookDraftService } from '../../functions/src/pricing';
import { createQuotationService, ensureBaselinePaymentPlanForProject } from '../../functions/src/quotations';
import { filterWorkspaceSnapshotRecords, getWorkspaceCollectionAccess } from '../../functions/src/organizations/collection-snapshot-access';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const actor = { uid: 'workflow-admin', email: 'admin@example.com', isSuperAdmin: false, mfaVerified: true };
const role = 'BUILDER_ADMIN';

async function fixture() {
  const db = createTransactionalTestFirestore({ enforceReadBeforeWrite: true });
  const { organization } = await createOrganizationService(db, actor, {
    name: 'Workflow Builders', legalName: 'Workflow Builders Ltd', headquartersCity: 'Hyderabad',
  });
  const project = await createProjectService(db, actor, role, {
    orgId: organization.id, builderName: organization.name, name: 'Workflow Heights', code: 'WH',
    city: 'Hyderabad', locality: 'Kondapur', address: 'Kondapur Main Road', reraNumber: 'TEST-RERA-100',
    projectType: 'APARTMENT', configurations: ['2 BHK'], constructionStatus: 'UNDER_CONSTRUCTION',
  });
  const unitInput = { orgId: organization.id, projectId: project.id, unitNumber: 'A-101', floorNumber: 1,
    unitType: 'APARTMENT', bhk: '2 BHK', saleableAreaSqft: 1200, carpetAreaSqft: 900,
    facing: 'EAST', baseRatePerSqft: 7000, parkingEntitlementCount: 1 };
  const unit = await createUnitService(db, actor, role, unitInput);
  const priceBook = (await db.collection('price_books').get()).docs[0]!.data() as PriceBook;
  const slot = (number: string, extra = {}) => createParkingSlotService(db, actor, role, {
    orgId: organization.id, projectId: project.id, levelType: 'BASEMENT', levelName: 'B1',
    zone: 'A', slotNumber: number, parkingType: 'STANDARD', priceInr: 320000, ...extra,
  });
  const quoteInput = {
    orgId: organization.id, projectId: project.id, unitId: unit.id, priceBookId: priceBook.id,
    paymentPlanId: 'default', customer: { name: 'Real Buyer', phone: '+919876543210' },
    discount: { type: 'NONE', value: 0 }, validDays: 15, parkingSlotsCount: 0,
    termsAndConditions: 'Valid for fifteen days, subject to availability.',
  };
  return { db, organization, project, unit, unitInput, priceBook, slot, quoteInput };
}

describe('Project, inventory, parking and cost-sheet consistency', () => {
  it('updates project location and amenities later and links a retried master-plan upload once', async () => {
    const { db, project } = await fixture();
    const details = { orgId: project.orgId, projectId: project.id, postalCode: '500084',
      landmark: 'Botanical Garden', coordinates: { lat: 17.46, lng: 78.37 }, amenities: ['Gym'] };
    await expect(updateProjectDetailsService(db, actor, role, { ...details, orgId: 'another-org' })).rejects.toThrow(/organization/);
    const updated = await updateProjectDetailsService(db, actor, role, details);
    expect(updated).toMatchObject({ postalCode: '500084', coordinates: details.coordinates, amenities: ['Gym'], totalUnits: 1 });
    const planInput = { orgId: project.orgId, projectId: project.id,
      requestId: '07ee1bef-f1c9-43a2-882b-26fd685df72f', category: 'MASTER_PLAN',
      title: 'Site plan', fileName: 'site.pdf', mimeType: 'application/pdf', sizeBytes: 100,
      storagePath: 'organizations/' + project.orgId + '/projects/' + project.id + '/plans/site' };
    await expect(registerDocumentService(db, actor, role, { ...planInput, storagePath: 'organizations/other/projects/x/plans/site' })).rejects.toThrow(/uploaded to this project/);
    const plan = await registerDocumentService(db, actor, role, planInput);
    expect((await registerDocumentService(db, actor, role, planInput)).id).toBe(plan.id);
    expect((await db.collection('documents').get()).size).toBe(1);
    expect((await db.collection('projects').doc(project.id).get()).data()?.masterPlanDocumentId).toBe(plan.id);
  });

  it('preserves room dimensions and features across creation, retry, and later editing', async () => {
    const { db, unitInput } = await fixture();
    const towerInput = { orgId: unitInput.orgId, projectId: unitInput.projectId,
      requestId: '183f1cc0-a658-4560-a262-0347342a1c5f', name: 'East Tower', code: 'ET', towerType: 'TOWER', totalFloors: 10 };
    const tower = await createTowerService(db, actor, role, towerInput);
    expect((await createTowerService(db, actor, role, towerInput)).id).toBe(tower.id);
    const input = { ...unitInput, towerId: tower.id, unitNumber: 'ET-102',
      requestId: '3dd73fe5-fbd7-4068-ba30-17d713d47044', bedroomsCount: 2,
      bathroomsCount: 2, roomDetails: [{ name: 'Bedroom 1', type: 'BEDROOM', lengthFt: 12, widthFt: 10 }],
      unitAmenities: ['Modular Kitchen'] };
    const unit = await createUnitService(db, actor, role, input);
    expect((await createUnitService(db, actor, role, input)).id).toBe(unit.id);
    const updated = await updateUnitService(db, actor, role, { orgId: unit.orgId, unitId: unit.id, bathroomsCount: 3 });
    expect(updated).toMatchObject({ bathroomsCount: 3, roomDetails: input.roomDetails, unitAmenities: input.unitAmenities });
    expect((await db.collection('units').get()).size).toBe(2);
  });

  it('rejects missing and cross-project unit hierarchy references even on the ground floor', async () => {
    const { db, project, unitInput } = await fixture();
    await db.collection('towers').doc('foreign-tower').set({ orgId: unitInput.orgId, projectId: 'other-project', totalFloors: 10 });
    await expect(createUnitService(db, actor, role, { ...unitInput, unitNumber: 'A-002', floorNumber: 0, towerId: 'foreign-tower' })).rejects.toThrow(/this project/);
    await expect(createUnitService(db, actor, role, { ...unitInput, unitNumber: 'A-003', phaseId: 'missing-phase' })).rejects.toThrow(/this project/);
    await db.collection('floors').doc('wrong-floor').set({ orgId: unitInput.orgId, projectId: project.id, floorNumber: 9, towerId: null });
    await expect(createUnitService(db, actor, role, { ...unitInput, unitNumber: 'A-004', floorId: 'wrong-floor' })).rejects.toThrow(/match/);
    expect((await db.collection('units').get()).size).toBe(1);
  });

  it('validates parking project ownership before creating a slot', async () => {
    const { db, slot } = await fixture();
    await expect(slot('01', { projectId: 'missing-project' })).rejects.toThrow(/Project not found/);
    await expect(slot('02', { orgId: 'other-org' })).rejects.toThrow(/Project not found/);
    expect((await db.collection('parking_slots').get()).size).toBe(0);
  });

  it('serializes concurrent allocations against the last entitlement and rejects a false project context', async () => {
    const { db, unit, project, slot } = await fixture();
    const [one, two] = await Promise.all([slot('01'), slot('02')]);
    const input = { orgId: unit.orgId, projectId: project.id, unitId: unit.id, reason: 'Buyer allocation' };
    await expect(allocateParkingSlotService(db, actor, role, { ...input, slotId: one.id, projectId: 'wrong-project' })).rejects.toThrow(/same project/);
    const attempts = await Promise.allSettled([one, two].map((s) => allocateParkingSlotService(db, actor, role, { ...input, slotId: s.id })));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const saved = (await db.collection('units').doc(unit.id).get()).data() as Unit;
    expect(saved.assignedParkingSlotIds).toHaveLength(1);
    expect((await db.collection('parking_allocations').get()).size).toBe(1);
    await expect(updateUnitService(db, actor, role, { orgId: unit.orgId, unitId: unit.id, parkingEntitlementCount: 0 })).rejects.toThrow(/Release assigned/);
  });

  it('keeps slots unchanged after rejected cross-project releases and swaps, then releases cleanly', async () => {
    const { db, unit, project, slot } = await fixture();
    const one = await slot('01');
    await allocateParkingSlotService(db, actor, role, { orgId: unit.orgId, projectId: project.id, unitId: unit.id, slotId: one.id, reason: 'Assign slot' });
    await db.collection('parking_slots').doc('foreign-slot').set({ ...one, id: 'foreign-slot', projectId: 'other-project' });
    await expect(releaseParkingSlotService(db, actor, role, { orgId: unit.orgId, projectId: 'other-project', slotId: one.id, reason: 'Release slot' })).rejects.toThrow(/this project/);
    await expect(swapParkingSlotsService(db, actor, role, { orgId: unit.orgId, projectId: project.id, unitId: unit.id, currentSlotId: one.id, targetSlotId: 'foreign-slot', reason: 'Change slot' })).rejects.toThrow(/organization and project/);
    expect((await db.collection('parking_slots').doc(one.id).get()).data()?.status).toBe('ALLOCATED');
    await releaseParkingSlotService(db, actor, role, { orgId: unit.orgId, projectId: project.id, slotId: one.id, reason: 'Buyer release' });
    expect((await db.collection('units').doc(unit.id).get()).data()?.assignedParkingSlotIds).toEqual([]);
  });

  it('rejects foreign price books and inactive payment plans instead of silently substituting defaults', async () => {
    const { db, quoteInput, priceBook, project } = await fixture();
    await db.collection('price_books').doc('foreign-book').set({ ...priceBook, id: 'foreign-book', projectId: 'other-project' });
    await expect(createQuotationService(db, actor, 'Admin', role, { ...quoteInput, priceBookId: 'foreign-book' })).rejects.toThrow(/this project/);
    const plan = await ensureBaselinePaymentPlanForProject(db, { orgId: project.orgId, projectId: project.id, actorUid: actor.uid });
    await db.collection('payment_plans').doc(plan.id).update({ isActive: false });
    await expect(createQuotationService(db, actor, 'Admin', role, { ...quoteInput, paymentPlanId: plan.id })).rejects.toThrow(/inactive/);
    expect((await db.collection('quotations').get()).size).toBe(0);
  });

  it('rejects duplicate, foreign-project and other-buyer parking selections', async () => {
    const { db, quoteInput, slot, unit } = await fixture();
    const one = await slot('01');
    for (const extra of [
      { selectedParkingSlotIds: [one.id, one.id] },
      { selectedParkingSlotIds: ['missing-slot'] },
    ]) await expect(createQuotationService(db, actor, 'Admin', role, { ...quoteInput, ...extra })).rejects.toThrow();
    await db.collection('parking_slots').doc(one.id).update({ projectId: 'other-project' });
    await expect(createQuotationService(db, actor, 'Admin', role, { ...quoteInput, selectedParkingSlotIds: [one.id] })).rejects.toThrow();
    await db.collection('parking_slots').doc(one.id).update({ projectId: unit.projectId, status: 'ALLOCATED', allocatedUnitId: 'other-buyer-unit' });
    await expect(createQuotationService(db, actor, 'Admin', role, { ...quoteInput, selectedParkingSlotIds: [one.id] })).rejects.toThrow(/another unit/);
  });

  it('generates the exact preview total using physical parking and inherited pricing rules', async () => {
    const { db, quoteInput, slot, unit, priceBook, project } = await fixture();
    const physical = await slot('01', { parkingType: 'EV', priceInr: 765432 });
    await allocateParkingSlotService(db, actor, role, { orgId: unit.orgId, projectId: project.id, unitId: unit.id, slotId: physical.id, reason: 'EV parking' });
    const override = { id: 'project-rate', orgId: unit.orgId, projectId: project.id, scopeLevel: 'PROJECT' as const, targetId: project.id,
      isActive: true, versionNumber: 1, locationPremiumPerSqft: 123, effectiveFrom: '2026-01-01', createdByUid: actor.uid, createdAt: '2026-01-01', updatedAt: '2026-01-01' } satisfies PricingScopeOverride;
    await db.collection('pricing_overrides').doc(override.id).set(override);
    const plan = await ensureBaselinePaymentPlanForProject(db, { orgId: unit.orgId, projectId: project.id, actorUid: actor.uid });
    const preview = calculateCostSheet({ unit, priceBook, overrides: [override], allocatedParkingSlots: [physical], paymentPlan: plan });
    const result = await createQuotationService(db, actor, 'Admin', role, quoteInput);
    expect(result.quotation.breakdown).toEqual(preview);
    expect(result.quotation.selectedParkingSlotIds).toEqual([physical.id]);
    expect(result.quotation.breakdown.parkingChargesInr).toBe(765432);
    expect(result.quotation.breakdown.schedule.reduce((sum, installment) => sum + installment.totalInstallmentPayableInr, 0)).toBe(result.quotation.totalPayableInr);
    expect(result.pdfBytes.length).toBeGreaterThan(1000);
  });

  it('preserves zero parking for a unit with no entitlement', async () => {
    const { db, quoteInput, unit } = await fixture();
    await db.collection('units').doc(unit.id).update({ parkingEntitlementCount: 0 });
    const result = await createQuotationService(db, actor, 'Admin', role, quoteInput);
    expect(result.quotation.parkingSlotsCount).toBe(0);
    expect(result.quotation.breakdown.parkingChargesInr).toBe(0);
  });

  it('preserves configured draft pricing when more inventory is imported', async () => {
    const { db, unitInput, priceBook } = await fixture();
    await db.collection('price_books').doc(priceBook.id).update({ basePricePerSqft: 9999 });
    await createUnitService(db, actor, role, { ...unitInput, unitNumber: 'A-102', baseRatePerSqft: 8000 });
    const book = await ensureBaselinePriceBookForProject(db, { orgId: unitInput.orgId, projectId: unitInput.projectId, baseRatePerSqft: 8000, actorUid: actor.uid });
    expect(book?.basePricePerSqft).toBe(9999);
  });

  it('rejects editing a price book through another project context', async () => {
    const { db, priceBook } = await fixture();
    await expect(savePriceBookDraftService(db, actor, role, { ...priceBook, priceBookId: priceBook.id, projectId: 'wrong-project' })).rejects.toThrow();
    expect((await db.collection('price_books').doc(priceBook.id).get()).data()?.projectId).toBe(priceBook.projectId);
  });

  it('reprices large inventory in bounded batches while retaining booked prices and physical parking', async () => {
    const { db, unit, priceBook, project, slot } = await fixture();
    const physical = await slot('01', { priceInr: 765432 });
    await allocateParkingSlotService(db, actor, role, { orgId: unit.orgId, projectId: project.id, unitId: unit.id, slotId: physical.id, reason: 'Assigned parking' });
    for (let i = 0; i < 260; i++) {
      await db.collection('units').doc('bulk-' + i).set({ ...unit, id: 'bulk-' + i, unitNumber: 'B-' + i });
    }
    await db.collection('units').doc('booked-unit').set({ ...unit, id: 'booked-unit', status: 'BOOKED', calculatedTotalPrice: 12345 });
    const originalTransaction = db.runTransaction.bind(db);
    const batchSizes: number[] = [];
    vi.spyOn(db, 'runTransaction').mockImplementation((operation) => originalTransaction(async (tx) => {
      let writes = 0;
      const set = tx.set.bind(tx), update = tx.update.bind(tx);
      tx.set = ((...args: Parameters<typeof tx.set>) => { writes++; return set(...args); }) as typeof tx.set;
      tx.update = ((...args: Parameters<typeof tx.update>) => { writes++; return update(...args); }) as typeof tx.update;
      const result = await operation(tx);
      expect(writes).toBeLessThanOrEqual(500);
      batchSizes.push(writes);
      return result;
    }));
    const result = await applyPriceBookToInventory(db, unit.orgId, project.id, priceBook, actor, 'Bulk activation');
    expect(result.updatedUnitsCount).toBe(261);
    expect(batchSizes.length).toBeGreaterThan(1);
    expect((await db.collection('units').doc('booked-unit').get()).data()?.calculatedTotalPrice).toBe(12345);
    const expected = calculateCostSheet({ unit: { ...unit, baseRatePerSqft: undefined }, priceBook, allocatedParkingSlots: [physical] });
    expect((await db.collection('units').doc(unit.id).get()).data()?.calculatedTotalPrice).toBe(expected.totalPayableInr);
  });

  it('rechecks booking status inside the repricing transaction', async () => {
    const { db, unit, priceBook, project } = await fixture();
    const originalTransaction = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (operation) => {
      await db.collection('units').doc(unit.id).update({ status: 'BOOKED', calculatedTotalPrice: 12345 });
      return originalTransaction(operation);
    });
    const result = await applyPriceBookToInventory(db, unit.orgId, project.id, priceBook, actor, 'Concurrent activation');
    expect(result.updatedUnitsCount).toBe(0);
    expect((await db.collection('units').doc(unit.id).get()).data()?.calculatedTotalPrice).toBe(12345);
  });

  it('selects the latest active price book deterministically and keeps inherited snapshot rules within scope', () => {
    const book = (id: string, status: PriceBook['status'], versionNumber: number) => ({ id, status, versionNumber } as PriceBook);
    expect(getQuotationPriceBooks([book('draft', 'DRAFT', 9), book('archive', 'ARCHIVED', 8), book('active1', 'ACTIVE', 1), book('active2', 'ACTIVE', 2)]).map((pb) => pb.id)).toEqual(['active2', 'active1', 'draft']);
    expect(getWorkspaceCollectionAccess('pricing_overrides')?.permissions).toEqual(['pricing:view']);
    const records = [
      { id: 'global', data: { projectId: null, scopeLevel: 'ORGANIZATION' } },
      { id: 'project', data: { projectId: 'allowed' } },
      { id: 'foreign', data: { projectId: 'other' } },
    ];
    expect(filterWorkspaceSnapshotRecords('pricing_overrides', records, { actorUid: actor.uid, authorizedPermission: 'pricing:view', allowedProjectIds: ['allowed'] }).map((row) => row.id)).toEqual(['global', 'project']);
  });
});
