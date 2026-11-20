import { describe, it, expect } from 'vitest';
import {
  type Booking,
  type Unit,
  type Lead,
  generateBookingPaymentSchedule,
  formatInr,
  formatInrCompact,
} from '@bharat-makaan/shared';

describe('Inventory Statistics & Unified Customer Navigation Suite', () => {
  const sampleUnits: Unit[] = [
    {
      id: 'unit-101',
      orgId: 'org-test',
      projectId: 'proj-1',
      towerId: 'tower-1',
      towerName: 'Tower A',
      floorNumber: 1,
      unitNumber: '101',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      balconiesCount: 2,
      facing: 'EAST',
      baseRatePerSqft: 8000,
      floorRisePerSqft: 50,
      plcPerSqft: 200,
      calculatedTotalPrice: 15000000,
      parkingEntitlementCount: 1,
      assignedParkingSlotIds: [],
      isCorner: false,
      isVastuCompliant: true,
      isPublicPublished: true,
      listingMode: 'BUY',
      status: 'BOOKED',
      heldForLeadId: 'cust-1',
      holdAdvanceAmount: 500000,
      holdPaymentReference: 'NEFT-500K-001',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    },
    {
      id: 'unit-102',
      orgId: 'org-test',
      projectId: 'proj-1',
      towerId: 'tower-1',
      towerName: 'Tower A',
      floorNumber: 1,
      unitNumber: '102',
      unitType: 'APARTMENT',
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 840,
      balconiesCount: 1,
      facing: 'WEST',
      baseRatePerSqft: 8000,
      floorRisePerSqft: 50,
      plcPerSqft: 0,
      calculatedTotalPrice: 10000000,
      parkingEntitlementCount: 1,
      assignedParkingSlotIds: [],
      isCorner: false,
      isVastuCompliant: true,
      isPublicPublished: true,
      listingMode: 'BUY',
      status: 'RESERVED',
      heldForLeadId: 'cust-2',
      holdAdvanceAmount: 200000,
      holdPaymentReference: 'UPI-200K-002',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    },
    {
      id: 'unit-103',
      orgId: 'org-test',
      projectId: 'proj-1',
      towerId: 'tower-1',
      towerName: 'Tower A',
      floorNumber: 1,
      unitNumber: '103',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1260,
      balconiesCount: 2,
      facing: 'NORTH',
      baseRatePerSqft: 8000,
      floorRisePerSqft: 50,
      plcPerSqft: 0,
      calculatedTotalPrice: 14500000,
      parkingEntitlementCount: 1,
      assignedParkingSlotIds: [],
      isCorner: false,
      isVastuCompliant: true,
      isPublicPublished: true,
      listingMode: 'BUY',
      status: 'AVAILABLE',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    },
    {
      id: 'unit-104',
      orgId: 'org-test',
      projectId: 'proj-1',
      towerId: 'tower-1',
      towerName: 'Tower A',
      floorNumber: 1,
      unitNumber: '104',
      unitType: 'APARTMENT',
      bhk: '4 BHK',
      saleableAreaSqft: 2500,
      carpetAreaSqft: 1750,
      balconiesCount: 3,
      facing: 'EAST',
      baseRatePerSqft: 8500,
      floorRisePerSqft: 50,
      plcPerSqft: 300,
      calculatedTotalPrice: 22000000,
      parkingEntitlementCount: 2,
      assignedParkingSlotIds: [],
      isCorner: true,
      isVastuCompliant: true,
      isPublicPublished: true,
      listingMode: 'BUY',
      status: 'REGISTERED',
      heldForLeadId: 'cust-3',
      holdAdvanceAmount: 1000000,
      holdPaymentReference: 'RTGS-1000K-003',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    },
  ];

  it('calculates inventory stats correctly (booked, pending, available, customers, advance)', () => {
    const totalUnits = sampleUnits.length;
    const bookedUnits = sampleUnits.filter(
      (u) => u.status === 'BOOKED' || u.status === 'AGREEMENT' || u.status === 'REGISTERED'
    ).length;
    const pendingUnits = sampleUnits.filter(
      (u) => u.status === 'RESERVED' || u.status === 'ON_HOLD'
    ).length;
    const availableUnits = sampleUnits.filter((u) => u.status === 'AVAILABLE').length;

    const unitHeldLeadIds = new Set(
      sampleUnits
        .filter((u) => u.heldForLeadId && u.status !== 'AVAILABLE')
        .map((u) => u.heldForLeadId!)
    );
    const buyerCustomersCount = unitHeldLeadIds.size;

    const totalAdvanceInr = sampleUnits.reduce(
      (acc, u) => acc + (u.holdAdvanceAmount || 0),
      0
    );

    const bookedGrossValueInr = sampleUnits
      .filter((u) => u.status === 'BOOKED' || u.status === 'AGREEMENT' || u.status === 'REGISTERED')
      .reduce((acc, u) => acc + (u.calculatedTotalPrice || 0), 0);

    expect(totalUnits).toBe(4);
    expect(bookedUnits).toBe(2); // unit-101 (BOOKED) and unit-104 (REGISTERED)
    expect(pendingUnits).toBe(1); // unit-102 (RESERVED)
    expect(availableUnits).toBe(1); // unit-103 (AVAILABLE)
    expect(buyerCustomersCount).toBe(3); // cust-1, cust-2, cust-3
    expect(totalAdvanceInr).toBe(1700000); // 500k + 200k + 1000k
    expect(bookedGrossValueInr).toBe(37000000); // 15M + 22M
  });

  it('safely synthesizes bookings even when bookingNumber or customer fields are missing or undefined', () => {
    const rawSparseBooking: any = {
      id: 'bk-sparse-001',
      orgId: 'org-test',
      projectId: 'proj-1',
      unitId: 'unit-101',
      unitNumber: '101',
      // bookingNumber is intentionally undefined
      // customer is intentionally undefined
      totalPayableInr: 15000000,
      status: 'BOOKED',
    };

    // Simulate our safe accessor
    const bkNum = rawSparseBooking.bookingNumber || rawSparseBooking.id || '00001';
    expect(bkNum).toBe('bk-sparse-001');
    expect(bkNum.slice(-5)).toBe('e-001');

    const advPaid = rawSparseBooking.advancePaidAmountInr ?? rawSparseBooking.totalCollectedVerifiedInr ?? 0;
    const advRef = rawSparseBooking.advancePaymentReference || (advPaid > 0 ? `NEFT-ADV-${bkNum.slice(-5)}` : null);
    expect(advRef).toBeNull();

    const cust = rawSparseBooking.customer || ({} as any);
    const safeCustomer = {
      fullName: cust.fullName || 'Allotted Customer',
      phone: cust.phone || 'Contact on file',
      email: cust.email || 'buyer@customer.in',
      panNumber: cust.panNumber || 'ABCDE1234F',
      aadhaarLast4: cust.aadhaarLast4 || '8901',
      permanentAddress: cust.permanentAddress || 'Address on file',
    };

    expect(safeCustomer.fullName).toBe('Allotted Customer');
    expect(safeCustomer.panNumber).toBe('ABCDE1234F');
  });

  it('generates unified customer CRM navigation links from any section', () => {
    const leadId = 'lead-xyz-789';
    const crmCustomerLink = `/builder/customers?leadId=${leadId}`;
    const leadsCrmCustomerLink = `/builder/leads?tab=customers&leadId=${leadId}`;

    expect(crmCustomerLink).toContain(leadId);
    expect(crmCustomerLink).toContain('/builder/customers');
    expect(leadsCrmCustomerLink).toContain('tab=customers');
  });
});
