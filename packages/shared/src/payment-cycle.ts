import type { BookingMilestoneSchedule, ISODateString, PaymentPlan } from './entities';

export interface MilestoneTemplate {
  name: string;
  percentage: number;
  dueTrigger: string;
  daysFromStart: number;
}

export const STANDARD_CLP_MILESTONES: MilestoneTemplate[] = [
  {
    name: 'Booking Advance / Token',
    percentage: 10,
    dueTrigger: 'On Booking & Unit Reservation',
    daysFromStart: 0,
  },
  {
    name: 'Execution of Sale Agreement',
    percentage: 10,
    dueTrigger: 'Within 15 days of Booking',
    daysFromStart: 15,
  },
  {
    name: 'Completion of Foundation & Plinth',
    percentage: 20,
    dueTrigger: 'On Completion of Plinth Casting',
    daysFromStart: 45,
  },
  {
    name: 'Casting of Mid-Floor Slab',
    percentage: 20,
    dueTrigger: 'On Casting of Structure Slab',
    daysFromStart: 90,
  },
  {
    name: 'Completion of Superstructure & Brickwork',
    percentage: 15,
    dueTrigger: 'On Completion of Top Slab & Walls',
    daysFromStart: 135,
  },
  {
    name: 'Flooring, Sanitary & Plumbing',
    percentage: 15,
    dueTrigger: 'On Completion of Internal Finishes',
    daysFromStart: 180,
  },
  {
    name: 'Possession & Handover of Keys',
    percentage: 10,
    dueTrigger: 'On Notice of Possession & Occupancy',
    daysFromStart: 240,
  },
];

/**
 * Builds a deterministic payment cycle schedule for a booking.
 * Calculates installment amounts, schedules due dates, and marks paid / due / overdue statuses.
 */
export function generateBookingPaymentSchedule(params: {
  contractValueInr: number;
  advancePaidInr?: number;
  advancePaymentRef?: string | null;
  startDateIso?: ISODateString;
  paymentPlan?: PaymentPlan | null;
}): BookingMilestoneSchedule[] {
  const {
    contractValueInr,
    advancePaidInr = 0,
    advancePaymentRef,
    startDateIso,
    paymentPlan,
  } = params;

  const startMs = startDateIso ? new Date(startDateIso).getTime() : Date.now();
  const nowMs = Date.now();

  let templates: MilestoneTemplate[];

  if (paymentPlan && Array.isArray(paymentPlan.milestones) && paymentPlan.milestones.length > 0) {
    templates = paymentPlan.milestones.map((ms, idx) => ({
      name: ms.name,
      percentage: ms.percentage,
      dueTrigger: ms.dueTrigger || `Milestone ${idx + 1}`,
      daysFromStart: idx === 0 ? 0 : idx * 35,
    }));
  } else {
    templates = STANDARD_CLP_MILESTONES;
  }

  let remainingAdvanceToCredit = advancePaidInr;

  return templates.map((tmpl, index) => {
    const sequence = index + 1;
    const demandAmountInr = Math.round(contractValueInr * (tmpl.percentage / 100));
    const dueDateMs = startMs + tmpl.daysFromStart * 86400000;
    const dueDate = new Date(dueDateMs).toISOString();

    let paidAmountInr = 0;
    if (remainingAdvanceToCredit > 0) {
      const credited = Math.min(demandAmountInr, remainingAdvanceToCredit);
      paidAmountInr = credited;
      remainingAdvanceToCredit -= credited;
    }

    const outstandingAmountInr = Math.max(0, demandAmountInr - paidAmountInr);
    const isPastDue = dueDateMs < nowMs;

    let status: BookingMilestoneSchedule['status'];
    if (outstandingAmountInr === 0) {
      status = 'PAID';
    } else if (paidAmountInr > 0) {
      status = isPastDue ? 'OVERDUE' : 'PARTIALLY_PAID';
    } else if (isPastDue) {
      status = 'OVERDUE';
    } else {
      status = 'DUE';
    }

    return {
      id: `ms-${sequence}-${tmpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      sequence,
      name: tmpl.name,
      percentage: tmpl.percentage,
      demandAmountInr,
      paidAmountInr,
      outstandingAmountInr,
      dueDate,
      dueTrigger: tmpl.dueTrigger,
      status,
      receiptNumber: paidAmountInr > 0 && advancePaymentRef ? `RCP-ADV-${sequence}` : undefined,
      paidAt: paidAmountInr > 0 ? (startDateIso || new Date().toISOString()) : null,
      lastReminderSentAt: null,
      reminderCount: 0,
    };
  });
}
