import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  createUnitService,
  updateUnitService,
  bulkGenerateTowerUnitsService,
  transitionUnitStatusService,
} from '../../functions/src/inventory';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService, createTowerService } from '../../functions/src/projects';
import { ingestLeadService, convertLeadToCustomerService } from '../../functions/src/leads';
import { savePriceBookDraftService, activatePriceBookService } from '../../functions/src/pricing';
import { createQuotationService, createPaymentPlanService } from '../../functions/src/quotations';
import { scheduleSiteVisitService } from '../../functions/src/notifications';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';
import type { AuthenticatedActor } from '../../functions/src/shared/auth-guard';

const ADMIN: AuthenticatedActor = {
  uid: 'builder_admin_1',
  email: 'admin@builder.com',
  isSuperAdmin: false,
  mfaVerified: true,
};

async function setupProjectFixture() {
  const db = createTransactionalTestFirestore();
  const { organization } = await createOrganizationService(db, ADMIN, {
    name: 'Bharat Sky Villas',
    legalName: 'Bharat Sky Villas Pvt Ltd',
    headquartersCity: 'Bengaluru',
  });
  const project = await createProjectService(db, ADMIN, 'BUILDER_ADMIN', {
    orgId: organization.id,
    builderName: 'Bharat Sky Villas',
    name: 'Skyline Heights',
    code: 'SH',
    city: 'Bengaluru',
    locality: 'Whitefield',
    address: 'Hope Farm Junction, Whitefield',
    reraNumber: 'PRM/KA/RERA/1251/446/PR/220101/004500',
    projectType: 'APARTMENT',
    configurations: ['2 BHK', '3 BHK', '4 BHK'],
    constructionStatus: 'UNDER_CONSTRUCTION',
  });
  const tower = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
    orgId: organization.id,
    projectId: project.id,
    name: 'Tower Alpha',
    code: 'TA',
    towerType: 'TOWER',
    totalFloors: 20,
  });

  return { db, org: organization, project, tower };
}

describe('Flat Series Number, Edit Options & Customer Conversion Workflow', () => {
  it('assigns series number on flat creation and prevents duplicate series on the same floor', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    // 1. Create Flat 101 with series "01" on Floor 1
    const flat101 = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 1,
      series: '01',
      unitNumber: 'TA-101',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 9000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(flat101.unitNumber).toBe('TA-101');
    expect(flat101.series).toBe('01');
    expect(flat101.floorNumber).toBe(1);

    // 2. Attempt to create another flat on Floor 1 with the SAME series "01" -> Must throw already-exists
    await expect(
      createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        projectId: project.id,
        towerId: tower.id,
        towerName: tower.name,
        floorNumber: 1,
        series: '01',
        unitNumber: 'TA-101B',
        unitType: 'APARTMENT',
        bhk: '3 BHK',
        saleableAreaSqft: 1800,
        carpetAreaSqft: 1260,
        facing: 'WEST',
        baseRatePerSqft: 9000,
        isCorner: false,
        parkingEntitlementCount: 1,
        listingMode: 'BUY',
      })
    ).rejects.toThrow(/already exists on floor 1/);

    // 3. Create flat with series "01" on a DIFFERENT floor (Floor 2) -> Allowed!
    const flat201 = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 2,
      series: '01',
      unitNumber: 'TA-201',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 9000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(flat201.unitNumber).toBe('TA-201');
    expect(flat201.series).toBe('01');
    expect(flat201.floorNumber).toBe(2);

    // 4. Create flat with different series "02" on Floor 1 -> Allowed!
    const flat102 = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 1,
      series: '02',
      unitNumber: 'TA-102',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'WEST',
      baseRatePerSqft: 9000,
      isCorner: true,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(flat102.series).toBe('02');
  });

  it('bulk generation automatically populates standardized series numbers per floor', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    const result = await bulkGenerateTowerUnitsService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerCode: tower.code,
      towerName: tower.name,
      startFloor: 3,
      endFloor: 4,
      unitsPerFloor: 3,
      startUnitNumber: 1,
      bhk: '3 BHK',
      saleableAreaSqft: 1650,
      carpetAreaSqft: 1155,
      facing: 'NORTH',
      baseRatePerSqft: 8500,
    });

    expect(result.createdCount).toBe(6);
    const snap = await db.collection('units').where('floorNumber', '==', 3).get();
    const floor3Units = snap.docs.map((d) => d.data());
    expect(floor3Units.length).toBe(3);
    const seriesList = floor3Units.map((u) => u.series).sort();
    expect(seriesList).toEqual(['01', '02', '03']);
  });

  it('updates flat specifications and recalculates pricing correctly', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    const created = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 5,
      series: '01',
      unitNumber: 'TA-501',
      unitType: 'APARTMENT',
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      facing: 'NORTH',
      baseRatePerSqft: 8000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(created.calculatedTotalPrice).toBe(1200 * 8000); // 9,600,000

    // Edit flat: upgrade to 3 BHK, 1600 sq.ft., base rate 8500
    const updated = await updateUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      unitId: created.id,
      unitNumber: 'TA-501-A',
      series: '01-A',
      bhk: '3 BHK',
      saleableAreaSqft: 1600,
      carpetAreaSqft: 1120,
      baseRatePerSqft: 8500,
      facing: 'EAST',
      isCorner: true,
      parkingEntitlementCount: 2,
    });

    expect(updated.unitNumber).toBe('TA-501-A');
    expect(updated.series).toBe('01-A');
    expect(updated.bhk).toBe('3 BHK');
    expect(updated.saleableAreaSqft).toBe(1600);
    expect(updated.carpetAreaSqft).toBe(1120);
    expect(updated.facing).toBe('EAST');
    expect(updated.isCorner).toBe(true);
    expect(updated.parkingEntitlementCount).toBe(2);
    expect(updated.calculatedTotalPrice).toBe(1600 * 8500); // 13,600,000
    expect(updated.calculatedTotalMinor).toBe(1360000000);
  });

  it('holds and reserves flat with customer, automatically converting prospect to verified customer', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    // 1. Create an available flat
    const flat = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 6,
      series: '01',
      unitNumber: 'TA-601',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 9000,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    // 2. Ingest a new prospect lead
    const { lead: prospect } = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      customerName: 'Suresh Patel',
      phone: '+919988776655',
      source: 'MANUAL',
      whatsappOptIn: true,
    });

    expect(prospect.isCustomer).toBeFalsy();
    expect(prospect.customerConvertedAt).toBeFalsy();

    // 3. Place 48h hold on TA-601 for Suresh Patel
    const heldFlat = await transitionUnitStatusService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      unitId: flat.id,
      targetStatus: 'ON_HOLD',
      action: 'HOLD',
      leadId: prospect.id,
      holdDurationHours: 48,
    });

    expect(heldFlat.status).toBe('ON_HOLD');
    expect(heldFlat.heldForLeadId).toBe(prospect.id);
    expect(heldFlat.holdExpiresAt).toBeDefined();

    // Check that Suresh Patel was automatically promoted to Customer
    const leadAfterHoldSnap = await db.collection('leads').doc(prospect.id).get();
    const leadAfterHold = leadAfterHoldSnap.data();
    expect(leadAfterHold?.isCustomer).toBe(true);
    expect(leadAfterHold?.customerConvertedAt).toBeDefined();

    // 4. Reserve unit TA-601 for Suresh Patel with advance receipt
    const reservedFlat = await transitionUnitStatusService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      unitId: flat.id,
      targetStatus: 'RESERVED',
      action: 'RESERVE',
      leadId: prospect.id,
      holdAdvanceAmount: 100000,
      holdPaymentReference: 'UTR-HDFC-998877',
      reason: 'Token advance received via RTGS',
    });

    expect(reservedFlat.status).toBe('RESERVED');
    expect(reservedFlat.holdAdvanceAmount).toBe(100000);
    expect(reservedFlat.holdPaymentReference).toBe('UTR-HDFC-998877');

    const leadAfterReserveSnap = await db.collection('leads').doc(prospect.id).get();
    const leadAfterReserve = leadAfterReserveSnap.data();
    expect(leadAfterReserve?.isCustomer).toBe(true);
    expect(leadAfterReserve?.stage).toBe('NEGOTIATION');
  });

  it('allows converting a prospect lead directly to customer via convertLeadToCustomerService', async () => {
    const { db, org, project } = await setupProjectFixture();

    const { lead: prospect } = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      customerName: 'Ananya Sharma',
      phone: '+919123456780',
      source: 'WEBSITE',
      whatsappOptIn: true,
    });

    expect(prospect.isCustomer).toBeFalsy();

    const converted = await convertLeadToCustomerService(db, ADMIN, {
      orgId: org.id,
      leadId: prospect.id,
      notes: 'Customer visited site office and confirmed budget.',
    });

    expect(converted.isCustomer).toBe(true);
    expect(converted.customerConvertedAt).toBeDefined();
    expect(converted.convertedByUid).toBe(ADMIN.uid);

    // Verify lead activity was logged
    const activitiesSnap = await db
      .collection('lead_activities')
      .where('leadId', '==', prospect.id)
      .get();
    const activities = activitiesSnap.docs.map((d) => d.data());
    const conversionAct = activities.find((a) => a.title.includes('Converted from Prospect to Customer'));
    expect(conversionAct).toBeDefined();
  });

  it('enforces tower floor limits on bulk generation, unit creation, and unit update', async () => {
    const { db, org, project } = await setupProjectFixture();

    // Create a tower with only 5 floors
    const tower5 = await createTowerService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      name: 'Tower Beta 5 Floors',
      code: 'TB5',
      towerType: 'TOWER',
      totalFloors: 5,
    });

    // 1. Bulk generation: attempt to generate up to floor 10 on a 5-floor tower -> must throw
    await expect(
      bulkGenerateTowerUnitsService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        projectId: project.id,
        towerId: tower5.id,
        towerCode: tower5.code,
        towerName: tower5.name,
        startFloor: 1,
        endFloor: 10,
        unitsPerFloor: 4,
        startUnitNumber: 1,
        bhk: '2 BHK',
        saleableAreaSqft: 1200,
        carpetAreaSqft: 840,
        facing: 'EAST',
        baseRatePerSqft: 7500,
      })
    ).rejects.toThrow(/cannot exceed tower "Tower Beta 5 Floors" total floors \(5\)/);

    // 2. Bulk generation: generating up to floor 5 is allowed!
    const bulkValid = await bulkGenerateTowerUnitsService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower5.id,
      towerCode: tower5.code,
      towerName: tower5.name,
      startFloor: 1,
      endFloor: 5,
      unitsPerFloor: 2,
      startUnitNumber: 1,
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      facing: 'EAST',
      baseRatePerSqft: 7500,
    });
    expect(bulkValid.createdCount).toBe(10); // 5 floors * 2 units

    // 3. Single unit creation: attempt to create unit on floor 6 -> must throw
    await expect(
      createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        projectId: project.id,
        towerId: tower5.id,
        towerName: tower5.name,
        floorNumber: 6,
        series: '01',
        unitNumber: 'TB5-601',
        unitType: 'APARTMENT',
        bhk: '2 BHK',
        saleableAreaSqft: 1200,
        carpetAreaSqft: 840,
        facing: 'EAST',
        baseRatePerSqft: 7500,
        isCorner: false,
        parkingEntitlementCount: 1,
        listingMode: 'BUY',
      })
    ).rejects.toThrow(/exceeds tower "Tower Beta 5 Floors" total floors \(5\)/);

    // 4. Update unit: create valid unit on floor 4, then attempt to update to floor 8 -> must throw
    const validUnit = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower5.id,
      towerName: tower5.name,
      floorNumber: 4,
      series: '03',
      unitNumber: 'TB5-403',
      unitType: 'APARTMENT',
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      facing: 'WEST',
      baseRatePerSqft: 7500,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    await expect(
      updateUnitService(db, ADMIN, 'BUILDER_ADMIN', {
        orgId: org.id,
        unitId: validUnit.id,
        floorNumber: 8,
      })
    ).rejects.toThrow(/exceeds tower "Tower Beta 5 Floors" total floors \(5\)/);
  });

  it('updates inventory pricing when price is updated in pricing section, logs price history revisions, and generates elegant cost sheet PDF', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    // 1. Create a unit in inventory
    const unit101 = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 3,
      series: '01',
      unitNumber: 'TA-301',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      facing: 'EAST',
      baseRatePerSqft: 8500,
      isCorner: false,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    expect(unit101.baseRatePerSqft).toBe(8500);
    expect(unit101.calculatedTotalPrice).toBe(1800 * 8500); // 15,300,000

    // 2. Create and activate a Price Book v1 with base rate 9000 and apply to inventory
    const savedPriceBook = await savePriceBookDraftService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      name: 'Festive Launch Price Book',
      effectiveFrom: '2026-11-18T00:00:00.000Z',
      basePricePerSqft: 9000,
      floorRise: { enabled: true, startFloor: 2, ratePerFloorPerSqft: 50 },
      parkingPricesByType: {
        STANDARD: 300000,
        TANDEM: 500000,
        MECHANICAL: 250000,
        EV: 400000,
        ACCESSIBLE: 300000,
      },
      lineItems: [
        {
          id: 'li-amenities',
          internalKey: 'amenities_charges',
          displayLabel: 'Amenities Charges',
          basis: 'FIXED_AMOUNT',
          amount: 500000,
          taxCategory: 'AGREEMENT_GST',
          isOptional: false,
          isVisible: true,
          isRemovable: true,
          displayOrder: 1,
        },
      ],
      taxConfig: {
        agreementGstPct: 5,
        otherServiceGstPct: 18,
        roundingMode: 'NEAREST_RUPEE',
        registrationDisclaimer: 'Registration extra at actuals.',
      },
      applyToInventory: true,
    });

    expect(savedPriceBook.status).toBe('ACTIVE');
    expect(savedPriceBook.basePricePerSqft).toBe(9000);

    // 3. Verify unit in inventory was updated automatically
    const updatedUnitDoc = await db.collection('units').doc(unit101.id).get();
    const updatedUnit = updatedUnitDoc.data()!;
    expect(updatedUnit.baseRatePerSqft).toBe(9000);
    expect(updatedUnit.activePriceBookId).toBe(savedPriceBook.id);
    expect(updatedUnit.calculatedTotalPrice).toBeGreaterThan(15300000);

    // 4. Verify price revision history log was recorded
    const revsSnap = await db
      .collection('price_revisions')
      .where('unitId', '==', unit101.id)
      .get();
    expect(revsSnap.size).toBe(1);
    const rev = revsSnap.docs[0].data();
    expect(rev.unitId).toBe(unit101.id);
    expect(rev.unitNumber).toBe('TA-301');
    expect(rev.oldBaseRate).toBe(8500);
    expect(rev.newBaseRate).toBe(9000);
    expect(rev.changeAmount).toBeGreaterThan(0);

    // 5. Ingest customer and create CLP payment plan
    const { lead: cust } = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      customerName: 'Vikramaditya Roy',
      phone: '+919876500001',
      source: 'MANUAL',
      isCustomer: true,
    });

    const plan = await createPaymentPlanService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      name: 'Standard CLP 10-Step',
      planType: 'CONSTRUCTION_LINKED',
      milestones: [
        { sequence: 1, name: 'Booking Advance', percentage: 20, dueTrigger: 'On Booking', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 2, name: 'Foundation', percentage: 40, dueTrigger: 'Foundation', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 3, name: 'Possession', percentage: 40, dueTrigger: 'Handover', taxTreatment: 'INCLUDE_POSSESSION_CHARGES' },
      ],
    });

    // 6. Generate Cost Sheet & Quotation
    const quoteRes = await createQuotationService(db, ADMIN, 'Sales Director', 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      unitId: unit101.id,
      priceBookId: savedPriceBook.id,
      paymentPlanId: plan.id,
      customer: {
        name: cust.customerName,
        phone: cust.phone,
      },
      leadId: cust.id,
      discount: { type: 'NONE', value: 0 },
      validDays: 15,
      termsAndConditions: '1. Quotation valid for 15 days. 2. Stamp duty extra.',
      selectedParkingSlotIds: [],
      parkingSlotsCount: 1,
      parkingTypeUsed: 'STANDARD',
    });

    expect(quoteRes.quotation.status).toBe('ISSUED');
    expect(quoteRes.quotation.customer.name).toBe('Vikramaditya Roy');
    expect(quoteRes.pdfBytes).toBeDefined();

    // Verify PDF is valid PDF Document
    const pdfDoc = await PDFDocument.load(quoteRes.pdfBytes);
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('differentiates leads vs customers, converts prospect to customer with flat purchase, and schedules site visits from existing contacts', async () => {
    const { db, org, project, tower } = await setupProjectFixture();

    // 1. Create a flat
    const flat = await createUnitService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      towerId: tower.id,
      towerName: tower.name,
      floorNumber: 7,
      series: '02',
      unitNumber: 'TA-702',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1850,
      carpetAreaSqft: 1295,
      facing: 'EAST',
      baseRatePerSqft: 9200,
      isCorner: true,
      parkingEntitlementCount: 1,
      listingMode: 'BUY',
    });

    // 2. Ingest an exploring prospect (not a customer yet)
    const { lead: prospect } = await ingestLeadService(db, ADMIN, 'BUILDER_ADMIN', {
      orgId: org.id,
      projectId: project.id,
      customerName: 'Pooja Reddy',
      phone: '+919876543299',
      source: 'PUBLIC_PORTAL',
      whatsappOptIn: true,
    });

    expect(prospect.isCustomer).toBeFalsy();
    expect(prospect.customerConvertedAt).toBeFalsy();

    // 3. Schedule a site visit for this existing prospect (linked via leadId)
    const visit1 = await scheduleSiteVisitService(db, ADMIN, {
      orgId: org.id,
      projectId: project.id,
      leadId: prospect.id,
      customerName: prospect.customerName,
      customerPhone: prospect.phone,
      scheduledStartAt: '2026-11-25T10:00:00.000Z',
      scheduledEndAt: '2026-11-25T11:00:00.000Z',
      timezone: 'Asia/Kolkata',
      notes: 'Interested in 3 BHK corner units above 5th floor',
    });

    expect(visit1.leadId).toBe(prospect.id);
    expect(visit1.customerName).toBe('Pooja Reddy');

    // 4. Convert prospect to customer with purchased flat
    const converted = await convertLeadToCustomerService(db, ADMIN, {
      orgId: org.id,
      leadId: prospect.id,
      unitId: flat.id,
      notes: 'Customer finalized Tower Alpha flat 702 and paid token',
    });

    expect(converted.isCustomer).toBe(true);
    expect(converted.customerConvertedAt).toBeDefined();
    expect(converted.convertedByUid).toBe(ADMIN.uid);

    // Verify activity includes flat purchase details
    const activitiesSnap = await db
      .collection('lead_activities')
      .where('leadId', '==', prospect.id)
      .get();
    const activities = activitiesSnap.docs.map((d) => d.data());
    const conversionAct = activities.find((a) => a.title.includes('Converted from Prospect to Customer'));
    expect(conversionAct).toBeDefined();
    expect(conversionAct?.title).toContain('TA-702');

    // 5. Schedule a follow-up site visit for the now-verified customer
    const visit2 = await scheduleSiteVisitService(db, ADMIN, {
      orgId: org.id,
      projectId: project.id,
      leadId: converted.id,
      customerName: converted.customerName,
      customerPhone: converted.phone,
      scheduledStartAt: '2026-11-28T14:00:00.000Z',
      scheduledEndAt: '2026-11-28T15:00:00.000Z',
      timezone: 'Asia/Kolkata',
      notes: 'Interior measurements and walkthrough with family',
    });

    expect(visit2.leadId).toBe(converted.id);
    expect(visit2.customerName).toBe('Pooja Reddy');

    // 6. Verify database records
    const leadDoc = await db.collection('leads').doc(prospect.id).get();
    expect(leadDoc.data()?.isCustomer).toBe(true);

    const visitsSnap = await db
      .collection('site_visits')
      .where('leadId', '==', prospect.id)
      .get();
    expect(visitsSnap.size).toBe(2);
  });
});
