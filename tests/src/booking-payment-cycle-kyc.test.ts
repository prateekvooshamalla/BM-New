import { describe, expect, it } from 'vitest';
import {
  generateBookingPaymentSchedule,
  STANDARD_CLP_MILESTONES,
  type Booking,
  type BookingMilestoneSchedule,
} from '@bharat-makaan/shared';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService } from '../../functions/src/projects';
import { createUnitService } from '../../functions/src/inventory';
import {
  savePriceBookDraftService,
  submitPriceBookForApprovalService,
  activatePriceBookService,
  DEFAULT_LINE_ITEMS_TEMPLATE,
} from '../../functions/src/pricing';
import { decideApprovalService } from '../../functions/src/approvals';
import {
  createPaymentPlanService,
  createQuotationService,
} from '../../functions/src/quotations';
import { ingestLeadService } from '../../functions/src/leads';
import { createBookingService, transitionBookingStatusService } from '../../functions/src/bookings';
import {
  recordCollectionEntryService,
  sendPaymentReminderService,
} from '../../functions/src/collections';

const FINANCE_USER = {
  uid: 'uid-sales-finance',
  email: 'finance@bharatmakaan.test',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Booking System, Payment Cycle, Advance Tracking, Customer KYC & Due Date Reminders', () => {
  it('generates a standard 7-stage construction-linked payment schedule with exact percentages and demand amounts', () => {
    const contractValueInr = 10000000; // 1 Crore INR
    const advancePaidInr = 1000000; // 10 Lakhs INR (10% token)
    const advancePaymentRef = 'NEFT-HDFC-998877';
    const startDateIso = '2026-11-01T00:00:00.000Z';

    const schedule = generateBookingPaymentSchedule({
      contractValueInr,
      advancePaidInr,
      advancePaymentRef,
      startDateIso,
    });

    expect(schedule).toHaveLength(7);

    // Sum of percentages must equal 100%
    const totalPercentage = schedule.reduce((sum, ms) => sum + ms.percentage, 0);
    expect(totalPercentage).toBe(100);

    // Sum of demand amounts must equal contract value
    const totalDemand = schedule.reduce((sum, ms) => sum + ms.demandAmountInr, 0);
    expect(totalDemand).toBe(contractValueInr);

    // Milestone 1: Booking Token (10% = 10 Lakhs) -> should be fully PAID by advance
    const ms1 = schedule[0];
    expect(ms1.name).toContain('Booking Advance');
    expect(ms1.percentage).toBe(10);
    expect(ms1.demandAmountInr).toBe(1000000);
    expect(ms1.paidAmountInr).toBe(1000000);
    expect(ms1.outstandingAmountInr).toBe(0);
    expect(ms1.status).toBe('PAID');
    expect(ms1.receiptNumber).toBeDefined();

    // Milestone 2: Agreement Execution (10% = 10 Lakhs)
    const ms2 = schedule[1];
    expect(ms2.name).toContain('Agreement');
    expect(ms2.percentage).toBe(10);
    expect(ms2.demandAmountInr).toBe(1000000);
    expect(ms2.paidAmountInr).toBe(0);
    expect(ms2.outstandingAmountInr).toBe(1000000);
    // Since startDate is 2026-11-01 and daysFromStart is 15, dueDate was 2026-11-16 (past due) -> OVERDUE
    expect(ms2.status).toBe('OVERDUE');

    // Milestone 7: Possession (10% = 10 Lakhs)
    const ms7 = schedule[6];
    expect(ms7.name).toContain('Possession');
    expect(ms7.percentage).toBe(10);
    expect(ms7.demandAmountInr).toBe(1000000);
    // Future date -> DUE
    expect(ms7.status).toBe('DUE');
  });

  it('credits advance payment across multiple milestones when excess token advance is paid', () => {
    const contractValueInr = 10000000; // 1 Crore INR
    const advancePaidInr = 1500000; // 15 Lakhs advance (10% token + 5% towards agreement)
    const advancePaymentRef = 'RTGS-ICICI-445566';

    const schedule = generateBookingPaymentSchedule({
      contractValueInr,
      advancePaidInr,
      advancePaymentRef,
      startDateIso: new Date().toISOString(),
    });

    // Milestone 1 (10 Lakhs) should be 100% PAID
    expect(schedule[0].paidAmountInr).toBe(1000000);
    expect(schedule[0].outstandingAmountInr).toBe(0);
    expect(schedule[0].status).toBe('PAID');

    // Milestone 2 (10 Lakhs demand) should have remaining 5 Lakhs credited -> PARTIALLY_PAID
    expect(schedule[1].demandAmountInr).toBe(1000000);
    expect(schedule[1].paidAmountInr).toBe(500000);
    expect(schedule[1].outstandingAmountInr).toBe(500000);
    expect(schedule[1].status).toBe('PARTIALLY_PAID');

    // Milestone 3 (Foundation 20 Lakhs) should have 0 paid
    expect(schedule[2].paidAmountInr).toBe(0);
    expect(schedule[2].outstandingAmountInr).toBe(2000000);
  });

  it('executes full transactional booking with customer KYC, advance collection demand, and payment reminder dispatch', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, FINANCE_USER, {
      name: 'Skyline Developers',
      legalName: 'Skyline Developers Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Skyline Developers',
      name: 'Skyline Grandeur',
      code: 'SKG',
      city: 'Bengaluru',
      locality: 'Indiranagar',
      address: '100ft Road, Indiranagar',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/SKG/2026',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const unit = await createUnitService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 5,
      unitNumber: 'Flat 501',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 1800,
      carpetAreaSqft: 1350,
      facing: 'EAST',
      parkingEntitlementCount: 1,
      baseRatePerSqft: 9000,
    });

    const pbDraft = await savePriceBookDraftService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'SKG Standard 2026',
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      basePricePerSqft: 9000,
      floorRise: { enabled: false, startFloor: 1, ratePerFloorPerSqft: 0 },
      facingPremiumPerSqft: {},
      viewPremiumPerSqft: {},
      cornerPremiumPerSqft: 0,
      locationPremiumPerSqft: 0,
      unitSpecificPremiumInr: {},
      parkingPricesByType: {
        STANDARD: 300000,
        TANDEM: 500000,
        MECHANICAL: 250000,
        EV: 400000,
        ACCESSIBLE: 300000,
      },
      lineItems: DEFAULT_LINE_ITEMS_TEMPLATE,
      taxConfig: {
        agreementGstPct: 5,
        otherServiceGstPct: 18,
        roundingMode: 'NEAREST_RUPEE',
        registrationDisclaimer: 'Govt registration extra.',
      },
    });

    const pbApproval = await submitPriceBookForApprovalService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: pbDraft.id,
    });
    const appSnap = await db.collection('approvals').where('entityId', '==', pbDraft.id).get();
    await decideApprovalService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      approvalId: appSnap.docs[0]!.id,
      decision: 'APPROVED',
      decisionNotes: 'Approved for launch',
    });
    await activatePriceBookService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: pbDraft.id,
      reason: 'Active for bookings',
    });

    const plan = await createPaymentPlanService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'CLP Plan',
      planType: 'CUSTOM',
      milestones: [
        { sequence: 1, name: 'Booking Advance', percentage: 10, dueTrigger: 'On Booking', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 2, name: 'Agreement', percentage: 15, dueTrigger: 'Within 15 days', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 3, name: 'Possession', percentage: 75, dueTrigger: 'On Possession', taxTreatment: 'INCLUDE_POSSESSION_CHARGES' },
      ],
    });

    const { lead } = await ingestLeadService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      source: 'WEBSITE',
      customerName: 'Aditya Roy',
      phone: '+919876543210',
      email: 'aditya.roy@gmail.com',
      notesSummary: 'Looking for 3 BHK in Skyline Grandeur',
    });

    const { quotation } = await createQuotationService(
      db,
      FINANCE_USER,
      'Finance Head',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unit.id,
        priceBookId: pbDraft.id,
        paymentPlanId: plan.id,
        leadId: lead.id,
        customer: {
          name: 'Aditya Roy',
          phone: '+919876543210',
          email: 'aditya.roy@gmail.com',
        },
        parkingSlotsCount: 1,
        parkingTypeUsed: 'STANDARD',
        discount: { type: 'NONE', value: 0 },
        validDays: 15,
        termsAndConditions: 'Standard terms.',
      }
    );

    // Create Booking with full Customer KYC dossier and advance token
    const tokenAdvanceInr = 600000;
    const booking = await createBookingService(
      db,
      FINANCE_USER,
      'Finance Head',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unit.id,
        quotationId: quotation.id,
        leadId: lead.id,
        customer: {
          fullName: 'Aditya Roy',
          coApplicantName: 'Sunita Roy (Spouse)',
          phone: '+919876543210',
          email: 'aditya.roy@gmail.com',
          panNumber: 'ABCDE1234F',
          aadhaarLast4: '7788',
          permanentAddress: 'Villa 12, Palm Meadows, Bengaluru, Karnataka 560066',
        },
        allocatedParkingSlotIds: [],
        tokenAmountExpectedInr: tokenAdvanceInr,
      },
      true // auto-approve to BOOKED
    );

    expect(booking.status).toBe('BOOKED');
    expect(booking.customer.fullName).toBe('Aditya Roy');
    expect(booking.customer.panNumber).toBe('ABCDE1234F');
    expect(booking.customer.aadhaarLast4).toBe('7788');
    expect(booking.customer.coApplicantName).toBe('Sunita Roy (Spouse)');
    expect(booking.tokenAmountExpectedInr).toBe(tokenAdvanceInr);

    // Record Advance Token Receipt via NEFT
    const tokenReceipt = await recordCollectionEntryService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      bookingId: booking.id,
      recordType: 'RECEIPT',
      milestoneName: 'Booking Token Advance',
      demandAmountInr: tokenAdvanceInr,
      paidAmountInr: tokenAdvanceInr,
      paymentMode: 'NEFT',
      instrumentRef: 'NEFT-HDFC-UTR-554433',
    });

    expect(tokenReceipt.status).toBe('VERIFIED');
    expect(tokenReceipt.paidAmountInr).toBe(tokenAdvanceInr);
    expect(tokenReceipt.receiptNumber).toBeDefined();

    // Verify booking collected balance updated
    const updatedBkSnap = await db.collection('bookings').doc(booking.id).get();
    const updatedBk = updatedBkSnap.data() as Booking;
    expect(updatedBk.totalCollectedVerifiedInr).toBe(tokenAdvanceInr);
    expect(updatedBk.outstandingBalanceInr).toBe(booking.totalPayableInr - tokenAdvanceInr);

    // Record Next Milestone Demand (Milestone 2: Agreement Execution)
    const ms2DemandAmt = 1500000;
    const futureDueDate = new Date(Date.now() + 10 * 86400000).toISOString();
    const ms2Demand = await recordCollectionEntryService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      bookingId: booking.id,
      recordType: 'MILESTONE_DEMAND',
      milestoneName: 'Execution of Sale Agreement',
      demandAmountInr: ms2DemandAmt,
      paidAmountInr: 0,
      paymentMode: 'NEFT',
      dueDate: futureDueDate,
    });

    expect(ms2Demand.status).toBe('DUE');
    expect(ms2Demand.demandAmountInr).toBe(ms2DemandAmt);

    // Dispatch Milestone Payment Reminder via WhatsApp
    const reminder = await sendPaymentReminderService(db, FINANCE_USER, {
      orgId: organization.id,
      bookingId: booking.id,
      collectionRecordId: ms2Demand.id,
      channel: 'WHATSAPP',
      customMessage: 'Dear Aditya Roy, please find your Agreement Milestone demand notice attached.',
    });

    expect(reminder.status).toBe('SENT');
    expect(reminder.channel).toBe('WHATSAPP');
    expect(reminder.customerName).toBe('Aditya Roy');
    expect(reminder.customerPhone).toBe('+919876543210');
    expect(reminder.amountDueInr).toBe(ms2DemandAmt);

    // Transition to AGREEMENT_EXECUTED
    const agreementBk = await transitionBookingStatusService(db, FINANCE_USER, 'BUILDER_ADMIN', {
      orgId: organization.id,
      bookingId: booking.id,
      targetStatus: 'AGREEMENT_EXECUTED',
    });
    expect(agreementBk.status).toBe('AGREEMENT_EXECUTED');
  });
});
