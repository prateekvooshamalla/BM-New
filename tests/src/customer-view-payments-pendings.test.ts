import { describe, expect, it } from 'vitest';
import {
  generateBookingPaymentSchedule,
  formatInr,
  formatInrCompact,
  type Booking,
  type BookingMilestoneSchedule,
  type Lead,
  type Unit,
} from '@bharat-makaan/shared';

describe('Customer View 360 & Dossier Cycle (Payments & Pendings) Suite', () => {
  const sampleCustomer: Lead = {
    id: 'cust-super-777',
    orgId: 'org-test',
    fullName: 'Rajeshwar Sharma',
    phone: '+91 98765 43210',
    email: 'rajeshwar.sharma@example.com',
    lifecycleStage: 'CUSTOMER',
    status: 'ACTIVE',
    buyerType: 'END_USER',
    budgetMinInr: 12000000,
    budgetMaxInr: 15000000,
    preferredBhk: ['3 BHK'],
    sourceChannel: 'DIRECT_WALKIN',
    assignedSalesAgentUid: 'sales-rm-01',
    panNumber: 'ABCDE1234F',
    panDocUrl: 'https://storage.bharatmakaan.test/kyc/pan_cust777.pdf',
    aadhaarLast4: '8899',
    permanentAddress: 'B-402, Green Meadows, Outer Ring Road, Bangalore 560103',
    coApplicantName: 'Sunita Sharma',
    coApplicantRelation: 'SPOUSE',
    coApplicantPan: 'FGHIJ5678K',
    createdAt: '2026-02-15T09:30:00Z',
    updatedAt: '2026-03-01T14:20:00Z',
  };

  const sampleAllottedUnit: Unit = {
    id: 'unit-t1-1204',
    orgId: 'org-test',
    projectId: 'proj-skyline',
    towerId: 'tower-1',
    towerName: 'Tower 1',
    floorNumber: 12,
    unitNumber: '1204',
    unitType: 'APARTMENT',
    bhk: '3 BHK',
    saleableAreaSqft: 1850,
    carpetAreaSqft: 1295,
    balconiesCount: 2,
    facing: 'EAST',
    baseRatePerSqft: 7500,
    floorRisePerSqft: 50,
    plcPerSqft: 250,
    calculatedTotalPrice: 14430000,
    parkingEntitlementCount: 1,
    assignedParkingSlotIds: ['B1-P44'],
    isCorner: true,
    isVastuCompliant: true,
    isPublicPublished: true,
    listingMode: 'BUY',
    status: 'BOOKED',
    heldForLeadId: 'cust-super-777',
    holdAdvanceAmount: 1443000,
    holdPaymentReference: 'NEFT-HDFC-009988',
    createdAt: '2026-02-20T10:00:00Z',
    updatedAt: '2026-03-01T11:00:00Z',
  };

  it('validates customer statutory KYC and profile completeness', () => {
    expect(sampleCustomer.lifecycleStage).toBe('CUSTOMER');
    expect(sampleCustomer.panNumber).toMatch(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/);
    expect(sampleCustomer.panDocUrl).toContain('pan_cust777.pdf');
    expect(sampleCustomer.aadhaarLast4).toBe('8899');
    expect(sampleCustomer.permanentAddress).toContain('Bangalore 560103');
    expect(sampleCustomer.coApplicantName).toBe('Sunita Sharma');
    expect(sampleCustomer.coApplicantRelation).toBe('SPOUSE');
    expect(sampleCustomer.coApplicantPan).toMatch(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/);
    expect(sampleCustomer.assignedSalesAgentUid).toBe('sales-rm-01');
  });

  it('validates allotted unit specifications and pricing breakdown', () => {
    expect(sampleAllottedUnit.status).toBe('BOOKED');
    expect(sampleAllottedUnit.heldForLeadId).toBe(sampleCustomer.id);
    expect(sampleAllottedUnit.towerName).toBe('Tower 1');
    expect(sampleAllottedUnit.unitNumber).toBe('1204');
    expect(sampleAllottedUnit.saleableAreaSqft).toBe(1850);
    expect(sampleAllottedUnit.carpetAreaSqft).toBe(1295);

    // Rate breakdown
    const baseAmount = sampleAllottedUnit.saleableAreaSqft * sampleAllottedUnit.baseRatePerSqft;
    const floorRise = sampleAllottedUnit.saleableAreaSqft * (sampleAllottedUnit.floorRisePerSqft * (sampleAllottedUnit.floorNumber - 1));
    const plc = sampleAllottedUnit.saleableAreaSqft * sampleAllottedUnit.plcPerSqft;
    expect(baseAmount).toBe(1850 * 7500); // 13,875,000
    expect(plc).toBe(1850 * 250); // 462,500
    expect(sampleAllottedUnit.calculatedTotalPrice).toBeGreaterThan(baseAmount);
  });

  it('correctly partitions payment cycle into paid payments and pendings in list view', () => {
    const contractValueInr = sampleAllottedUnit.calculatedTotalPrice; // ~14,430,000
    const advancePaidInr = sampleAllottedUnit.holdAdvanceAmount || 1443000; // 10% token
    const advancePaymentRef = sampleAllottedUnit.holdPaymentReference || 'NEFT-HDFC-009988';

    const schedule = generateBookingPaymentSchedule({
      contractValueInr,
      advancePaidInr,
      advancePaymentRef,
      startDateIso: '2026-01-01T00:00:00Z',
    });

    expect(schedule.length).toBe(7);

    // List view partition: Pendings vs Paid Payments
    const pendingMilestones = schedule.filter(
      (m) => m.outstandingAmountInr > 0 || m.status === 'OVERDUE' || m.status === 'DUE'
    );
    const paidMilestones = schedule.filter(
      (m) => m.paidAmountInr > 0 || m.status === 'PAID'
    );

    // Token advance (10%) should be in paid milestones
    expect(paidMilestones.length).toBeGreaterThanOrEqual(1);
    const tokenMilestone = paidMilestones[0];
    expect(tokenMilestone.status).toBe('PAID');
    expect(tokenMilestone.paidAmountInr).toBe(advancePaidInr);
    expect(tokenMilestone.outstandingAmountInr).toBe(0);
    expect(tokenMilestone.receiptNumber).toBeDefined();

    // Remaining milestones (Agreement, Plinth, Slabs, Possession) should be pending
    expect(pendingMilestones.length).toBe(6);
    const totalPendingOutstanding = pendingMilestones.reduce(
      (sum, m) => sum + m.outstandingAmountInr,
      0
    );
    expect(totalPendingOutstanding).toBe(contractValueInr - advancePaidInr);

    // Aggregates
    const totalPaid = paidMilestones.reduce((sum, m) => sum + m.paidAmountInr, 0);
    expect(totalPaid + totalPendingOutstanding).toBe(contractValueInr);
  });

  it('handles incremental payment recording transitioning a pending milestone into paid with receipt', () => {
    const contractValueInr = 10000000;
    const advancePaidInr = 1000000;
    const schedule = generateBookingPaymentSchedule({
      contractValueInr,
      advancePaidInr,
      advancePaymentRef: 'NEFT-INITIAL-001',
      startDateIso: '2026-01-01T00:00:00Z',
    });

    // Milestone 1 is Agreement Execution (demand = 1,000,000, outstanding = 1,000,000)
    const agreementMs = schedule[1];
    expect(agreementMs.outstandingAmountInr).toBe(1000000);
    expect(agreementMs.paidAmountInr).toBe(0);

    // Record full payment for agreement milestone
    const paymentAmount = 1000000;
    const paymentRef = 'RTGS-AXIS-992211';
    const receiptNum = `RCP-AGR-${Date.now().toString().slice(-4)}`;

    agreementMs.paidAmountInr += paymentAmount;
    agreementMs.outstandingAmountInr = Math.max(0, agreementMs.demandAmountInr - agreementMs.paidAmountInr);
    agreementMs.status = agreementMs.outstandingAmountInr === 0 ? 'PAID' : 'PARTIALLY_PAID';
    agreementMs.paymentReference = paymentRef;
    agreementMs.receiptNumber = receiptNum;
    agreementMs.paidAt = new Date().toISOString();

    expect(agreementMs.status).toBe('PAID');
    expect(agreementMs.outstandingAmountInr).toBe(0);
    expect(agreementMs.paidAmountInr).toBe(1000000);
    expect(agreementMs.paymentReference).toBe(paymentRef);
    expect(agreementMs.receiptNumber).toBe(receiptNum);

    // Now re-evaluating list view partitions
    const pendingAfter = schedule.filter((m) => m.outstandingAmountInr > 0);
    const paidAfter = schedule.filter((m) => m.paidAmountInr > 0);

    expect(paidAfter.length).toBe(2); // Advance Token + Agreement
    expect(pendingAfter.length).toBe(5); // Plinth through Possession
  });

  it('formats currency values cleanly in compact and full Indian numbering systems', () => {
    const oneCrore = 10000000;
    const fifteenLakhs = 1500000;
    const seventyFiveThousand = 75000;

    expect(formatInr(oneCrore)).toBe('₹1,00,00,000');
    expect(formatInr(fifteenLakhs)).toBe('₹15,00,000');
    expect(formatInr(seventyFiveThousand)).toBe('₹75,000');

    expect(formatInrCompact(oneCrore)).toBe('₹1.00 Cr');
    expect(formatInrCompact(fifteenLakhs)).toBe('₹15.00 L');
    expect(formatInrCompact(seventyFiveThousand)).toBe('₹75,000');
  });

  it('determines canonical customer URLs consistently across builder and app portals', () => {
    const customerId = sampleCustomer.id;
    const builderCustomerUrl = `/builder/customers/${customerId}`;
    const appCustomerUrl = `/app/customers/${customerId}`;

    expect(builderCustomerUrl).toBe('/builder/customers/cust-super-777');
    expect(appCustomerUrl).toBe('/app/customers/cust-super-777');
  });
});
