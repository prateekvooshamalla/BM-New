import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOrganizationService } from '../../functions/src/organizations';
import { createProjectService } from '../../functions/src/projects';
import { createUnitService } from '../../functions/src/inventory';
import { decideApprovalService } from '../../functions/src/approvals';
import {
  activatePriceBookService,
  DEFAULT_LINE_ITEMS_TEMPLATE,
  savePriceBookDraftService,
  submitPriceBookForApprovalService,
} from '../../functions/src/pricing';
import {
  createPaymentPlanService,
  createQuotationService,
} from '../../functions/src/quotations';
import { ingestLeadService } from '../../functions/src/leads';
import {
  createBookingService,
  transitionBookingStatusService,
} from '../../functions/src/bookings';
import {
  confirmVerifiedRazorpayCollectionService,
  reconcileCollectionSettlementService,
  recordCollectionEntryService,
  sendBatchPaymentRemindersService,
  sendPaymentReminderService,
} from '../../functions/src/collections';
import { createTransactionalTestFirestore } from './helpers/in-memory-firestore';

const FINANCE_ADMIN = {
  uid: 'uid-finance-head',
  email: 'finance@bharatmakaan.test',
  isSuperAdmin: false,
  mfaVerified: true,
};

describe('Phase 6 — Controlled Bookings, Collections, Razorpay HMAC Verification & Reconciliation', () => {
  it('prevents double bookings, enforces server-side Razorpay HMAC verification, reconciles settlements, and releases inventory on cancellation', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, FINANCE_ADMIN, {
      name: 'Crown Realty',
      legalName: 'Crown Realty Pvt Ltd',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Crown Realty',
      name: 'Crown Towers',
      code: 'CRT',
      city: 'Bengaluru',
      locality: 'Koramangala',
      address: 'Koramangala 4th Block, Bengaluru',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/CRT/2026',
      configurations: ['3 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const unit = await createUnitService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 9,
      unitNumber: 'D-902',
      unitType: 'APARTMENT',
      bhk: '3 BHK',
      saleableAreaSqft: 2000,
      carpetAreaSqft: 1400,
      facing: 'EAST',
      parkingEntitlementCount: 1,
      baseRatePerSqft: 10000,
    });

    const pb = await savePriceBookDraftService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Standard Price Book',
      effectiveFrom: '2026-11-16T00:00:00.000Z',
      basePricePerSqft: 10000,
      floorRise: { enabled: false, startFloor: 1, ratePerFloorPerSqft: 0 },
      facingPremiumPerSqft: {},
      viewPremiumPerSqft: {},
      cornerPremiumPerSqft: 0,
      locationPremiumPerSqft: 0,
      unitSpecificPremiumInr: {},
      parkingPricesByType: {
        STANDARD: 400000,
        TANDEM: 700000,
        MECHANICAL: 300000,
        EV: 500000,
        ACCESSIBLE: 400000,
      },
      lineItems: DEFAULT_LINE_ITEMS_TEMPLATE,
      taxConfig: {
        agreementGstPct: 5,
        otherServiceGstPct: 18,
        roundingMode: 'NEAREST_RUPEE',
        registrationDisclaimer: 'Registration extra.',
      },
      maxDiscountPctWithoutApproval: 2,
    });

    await submitPriceBookForApprovalService(db, FINANCE_ADMIN, 'Finance Head', {
      orgId: organization.id,
      priceBookId: pb.id,
    });
    const appSnap = await db.collection('approvals').where('entityId', '==', pb.id).get();
    await decideApprovalService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      approvalId: appSnap.docs[0]!.id,
      decision: 'APPROVED',
      decisionNotes: 'Approved',
    });
    await activatePriceBookService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: pb.id,
      reason: 'Active',
    });

    const plan = await createPaymentPlanService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: '50-50 Plan',
      planType: 'CUSTOM',
      milestones: [
        { sequence: 1, name: 'Booking & Agreement', percentage: 50, dueTrigger: 'On Booking', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 2, name: 'Possession', percentage: 50, dueTrigger: 'On Possession', taxTreatment: 'INCLUDE_POSSESSION_CHARGES' },
      ],
    });

    const { lead } = await ingestLeadService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      customerName: 'Nikhil Shetty',
      phone: '+919845099887',
      email: 'nikhil@buyer.in',
      source: 'MANUAL',
      preferredProjectIds: [project.id],
    });

    const { quotation } = await createQuotationService(
      db,
      FINANCE_ADMIN,
      'Finance Head',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unit.id,
        priceBookId: pb.id,
        paymentPlanId: plan.id,
        leadId: lead.id,
        customer: { name: 'Nikhil Shetty', phone: '+919845099887', email: 'nikhil@buyer.in' },
        parkingSlotsCount: 1,
        parkingTypeUsed: 'STANDARD',
        discount: { type: 'NONE', value: 0 },
        validDays: 15,
        termsAndConditions: 'Standard terms.',
      }
    );

    const booking = await createBookingService(
      db,
      FINANCE_ADMIN,
      'Finance Head',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unit.id,
        quotationId: quotation.id,
        leadId: lead.id,
        customer: {
          fullName: 'Nikhil Shetty',
          phone: '+919845099887',
          email: 'nikhil@buyer.in',
          panNumber: 'ABCDE1234F',
          permanentAddress: 'Indiranagar, Bengaluru',
        },
        allocatedParkingSlotIds: [],
        tokenAmountExpectedInr: 1000000,
      },
      true
    );

    expect(booking.status).toBe('BOOKED');

    // Second booking attempt on the same unit MUST be rejected
    await expect(
      createBookingService(
        db,
        FINANCE_ADMIN,
        'Finance Head',
        'BUILDER_ADMIN',
        {
          orgId: organization.id,
          projectId: project.id,
          unitId: unit.id,
          quotationId: quotation.id,
          leadId: lead.id,
          customer: {
            fullName: 'Competing Buyer',
            phone: '+919845000000',
            email: 'comp@buyer.in',
            permanentAddress: 'Bengaluru',
          },
          allocatedParkingSlotIds: [],
          tokenAmountExpectedInr: 1000000,
        },
        true
      )
    ).rejects.toThrow(/Conflict/);

    // Razorpay online collection MUST start in PENDING_VERIFICATION (not paid!)
    const rzpEntry = await recordCollectionEntryService(db, FINANCE_ADMIN, 'FINANCE_MANAGER', {
      orgId: organization.id,
      bookingId: booking.id,
      recordType: 'RECEIPT',
      milestoneName: 'Token via Razorpay',
      demandAmountInr: 1000000,
      paidAmountInr: 1000000,
      paymentMode: 'RAZORPAY',
    });
    expect(rzpEntry.status).toBe('PENDING_VERIFICATION');

    const bkBeforeWebhook = await db.collection('bookings').doc(booking.id).get();
    expect(bkBeforeWebhook.data()?.totalCollectedVerifiedInr).toBe(0);

    // Invalid signature MUST be rejected
    const secret = 'rzp_test_webhook_secret_key';
    await expect(
      confirmVerifiedRazorpayCollectionService(db, {
        collectionRecordId: rzpEntry.id,
        razorpayOrderId: 'order_123',
        razorpayPaymentId: 'pay_456',
        providedSignature: 'forged_sig',
        secret,
      })
    ).rejects.toThrow(/Invalid Razorpay HMAC/);

    // Valid HMAC signature transitions to VERIFIED and credits customer ledger
    const validSig = crypto
      .createHmac('sha256', secret)
      .update('order_123|pay_456')
      .digest('hex');

    const verifiedCol = await confirmVerifiedRazorpayCollectionService(db, {
      collectionRecordId: rzpEntry.id,
      razorpayOrderId: 'order_123',
      razorpayPaymentId: 'pay_456',
      providedSignature: validSig,
      secret,
    });
    expect(verifiedCol.status).toBe('VERIFIED');
    expect(verifiedCol.razorpaySignatureVerified).toBe(true);

    const bkAfterWebhook = await db.collection('bookings').doc(booking.id).get();
    expect(bkAfterWebhook.data()?.totalCollectedVerifiedInr).toBe(1000000);

    // Bank Settlement Reconciliation
    const recon = await reconcileCollectionSettlementService(db, FINANCE_ADMIN, {
      orgId: organization.id,
      collectionRecordId: rzpEntry.id,
      bankStatementRef: 'UTR-AXIS-998877',
      settledAmountInr: 998000,
      gatewayFeeInr: 2000,
    });
    expect(recon.status).toBe('MATCHED');
    expect(recon.discrepancyAmountInr).toBe(0);

    // Authorized Cancellation releases unit back to AVAILABLE
    const cancelled = await transitionBookingStatusService(db, FINANCE_ADMIN, 'FINANCE_MANAGER', {
      orgId: organization.id,
      bookingId: booking.id,
      targetStatus: 'CANCELLED',
      reason: 'Mutual cancellation deed signed',
    });
    expect(cancelled.status).toBe('CANCELLED');
    const unitAfterCancel = await db.collection('units').doc(unit.id).get();
    expect(unitAfterCancel.data()?.status).toBe('AVAILABLE');
    expect(unitAfterCancel.data()?.activeBookingId).toBeNull();
  });

  it('automates payment reminders for overdue milestones and upcoming due activities', async () => {
    const db = createTransactionalTestFirestore();
    const { organization } = await createOrganizationService(db, FINANCE_ADMIN, {
      name: 'Skyline Ventures',
      legalName: 'Skyline Ventures LLP',
      headquartersCity: 'Bengaluru',
    });

    const project = await createProjectService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      builderName: 'Skyline Ventures',
      name: 'Skyline Heights',
      code: 'SKH',
      city: 'Bengaluru',
      locality: 'Whitefield',
      address: 'Whitefield Main Road',
      projectType: 'APARTMENT',
      reraNumber: 'PRM/KA/RERA/SKH/2026',
      configurations: ['2 BHK'],
      constructionStatus: 'UNDER_CONSTRUCTION',
    });

    const unit = await createUnitService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      floorNumber: 5,
      unitNumber: 'A-501',
      unitType: 'APARTMENT',
      bhk: '2 BHK',
      saleableAreaSqft: 1200,
      carpetAreaSqft: 850,
      facing: 'NORTH',
      parkingEntitlementCount: 1,
      baseRatePerSqft: 8000,
    });

    const pb = await savePriceBookDraftService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Base Price Book',
      effectiveFrom: '2026-11-16T00:00:00.000Z',
      basePricePerSqft: 8000,
      floorRise: { enabled: false, startFloor: 1, ratePerFloorPerSqft: 0 },
      facingPremiumPerSqft: {},
      viewPremiumPerSqft: {},
      cornerPremiumPerSqft: 0,
      locationPremiumPerSqft: 0,
      unitSpecificPremiumInr: {},
      parkingPricesByType: {
        STANDARD: 300000,
        TANDEM: 500000,
        MECHANICAL: 200000,
        EV: 400000,
        ACCESSIBLE: 300000,
      },
      lineItems: DEFAULT_LINE_ITEMS_TEMPLATE,
      taxConfig: {
        agreementGstPct: 5,
        otherServiceGstPct: 18,
        roundingMode: 'NEAREST_RUPEE',
        registrationDisclaimer: 'Registration extra.',
      },
      maxDiscountPctWithoutApproval: 2,
    });

    await submitPriceBookForApprovalService(db, FINANCE_ADMIN, 'Finance Head', {
      orgId: organization.id,
      priceBookId: pb.id,
    });
    const appSnap = await db.collection('approvals').where('entityId', '==', pb.id).get();
    await decideApprovalService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      approvalId: appSnap.docs[0]!.id,
      decision: 'APPROVED',
      decisionNotes: 'Approved',
    });
    await activatePriceBookService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      priceBookId: pb.id,
      reason: 'Active',
    });

    const plan = await createPaymentPlanService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      projectId: project.id,
      name: 'Standard CLP',
      planType: 'CONSTRUCTION_LINKED',
      milestones: [
        { sequence: 1, name: 'Booking Token', percentage: 20, dueTrigger: 'On Booking', taxTreatment: 'PROPORTIONAL_GST' },
        { sequence: 2, name: 'Foundation Slab', percentage: 80, dueTrigger: 'On Foundation', taxTreatment: 'PROPORTIONAL_GST' },
      ],
    });

    const { lead } = await ingestLeadService(db, FINANCE_ADMIN, 'BUILDER_ADMIN', {
      orgId: organization.id,
      customerName: 'Ananya Sharma',
      phone: '+919876543210',
      email: 'ananya@example.com',
      source: 'MANUAL',
      preferredProjectIds: [project.id],
    });

    const { quotation } = await createQuotationService(
      db,
      FINANCE_ADMIN,
      'Finance Head',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unit.id,
        priceBookId: pb.id,
        paymentPlanId: plan.id,
        leadId: lead.id,
        customer: { name: 'Ananya Sharma', phone: '+919876543210', email: 'ananya@example.com' },
        parkingSlotsCount: 1,
        parkingTypeUsed: 'STANDARD',
        discount: { type: 'NONE', value: 0 },
        validDays: 15,
        termsAndConditions: 'Standard terms.',
      }
    );

    const booking = await createBookingService(
      db,
      FINANCE_ADMIN,
      'Finance Head',
      'BUILDER_ADMIN',
      {
        orgId: organization.id,
        projectId: project.id,
        unitId: unit.id,
        quotationId: quotation.id,
        leadId: lead.id,
        customer: {
          fullName: 'Ananya Sharma',
          phone: '+919876543210',
          email: 'ananya@example.com',
          panNumber: 'ABCDE5678G',
          permanentAddress: 'Koramangala, Bengaluru',
        },
        allocatedParkingSlotIds: [],
        tokenAmountExpectedInr: 500000,
      },
      true
    );

    // Create an overdue milestone demand (due 10 days ago)
    const tenDaysAgo = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
    const overdueCol = await recordCollectionEntryService(db, FINANCE_ADMIN, 'FINANCE_MANAGER', {
      orgId: organization.id,
      bookingId: booking.id,
      recordType: 'MILESTONE_DEMAND',
      milestoneName: 'Foundation Slab',
      demandAmountInr: 1500000,
      paidAmountInr: 0,
      paymentMode: 'NEFT',
      dueDate: tenDaysAgo,
    });

    // 1. Send single reminder via WhatsApp
    const singleReminder = await sendPaymentReminderService(db, FINANCE_ADMIN, {
      orgId: organization.id,
      bookingId: booking.id,
      collectionRecordId: overdueCol.id,
      channel: 'WHATSAPP',
    });

    expect(singleReminder.customerName).toBe('Ananya Sharma');
    expect(singleReminder.amountDueInr).toBe(1500000);
    expect(singleReminder.isOverdue).toBe(true);
    expect(singleReminder.channel).toBe('WHATSAPP');
    expect(singleReminder.status).toBe('SENT');

    // Verify collection record updated with reminder count
    const updatedColSnap = await db.collection('collection_records').doc(overdueCol.id).get();
    expect(updatedColSnap.data()?.reminderCount).toBe(1);
    expect(updatedColSnap.data()?.lastReminderSentAt).toBeDefined();

    // Verify reminder was stored in payment_reminders
    const remSnap = await db.collection('payment_reminders').doc(singleReminder.id).get();
    expect(remSnap.exists).toBe(true);

    // 2. Batch dispatch for overdue demands
    const batchResult = await sendBatchPaymentRemindersService(db, FINANCE_ADMIN, {
      orgId: organization.id,
      filterType: 'OVERDUE',
    });

    expect(batchResult.sentCount).toBeGreaterThanOrEqual(1);
    expect(batchResult.reminders[0]?.isOverdue).toBe(true);
  });
});
