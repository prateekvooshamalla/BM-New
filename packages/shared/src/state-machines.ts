/**
 * @bharat-makaan/shared — Domain Workflow State Machines
 * Deterministic transition rules & authorization requirements for Units,
 * Price Books, Leads, Bookings, and Approvals.
 */

import type { PermissionKey } from './permissions';
import type {
  BookingStatus,
  LeadStage,
  PriceBookStatus,
  UnitStatus,
} from './entities';

export interface UnitTransitionRule {
  from: UnitStatus;
  to: UnitStatus;
  action:
    | 'HOLD'
    | 'RESERVE'
    | 'BOOK'
    | 'EXECUTE_AGREEMENT'
    | 'REGISTER'
    | 'RELEASE'
    | 'CANCEL'
    | 'EXPIRE';
  requiredPermission: PermissionKey;
  requiresReason: boolean;
}

export const UNIT_TRANSITION_RULES: UnitTransitionRule[] = [
  // Forward lifecycle: Available -> On Hold -> Reserved -> Booked -> Agreement -> Registered
  {
    from: 'AVAILABLE',
    to: 'ON_HOLD',
    action: 'HOLD',
    requiredPermission: 'inventory:hold',
    requiresReason: false,
  },
  {
    from: 'AVAILABLE',
    to: 'RESERVED',
    action: 'RESERVE',
    requiredPermission: 'inventory:reserve',
    requiresReason: false,
  },
  {
    from: 'ON_HOLD',
    to: 'RESERVED',
    action: 'RESERVE',
    requiredPermission: 'inventory:reserve',
    requiresReason: false,
  },
  {
    from: 'ON_HOLD',
    to: 'BOOKED',
    action: 'BOOK',
    requiredPermission: 'bookings:approve',
    requiresReason: false,
  },
  {
    from: 'RESERVED',
    to: 'BOOKED',
    action: 'BOOK',
    requiredPermission: 'bookings:approve',
    requiresReason: false,
  },
  {
    from: 'BOOKED',
    to: 'AGREEMENT',
    action: 'EXECUTE_AGREEMENT',
    requiredPermission: 'bookings:approve',
    requiresReason: false,
  },
  {
    from: 'AGREEMENT',
    to: 'REGISTERED',
    action: 'REGISTER',
    requiredPermission: 'bookings:approve',
    requiresReason: false,
  },
  // Authorized reverse transitions: release, expiry, cancellation
  {
    from: 'ON_HOLD',
    to: 'AVAILABLE',
    action: 'RELEASE',
    requiredPermission: 'inventory:release',
    requiresReason: true,
  },
  {
    from: 'ON_HOLD',
    to: 'AVAILABLE',
    action: 'EXPIRE',
    requiredPermission: 'inventory:release',
    requiresReason: false,
  },
  {
    from: 'RESERVED',
    to: 'AVAILABLE',
    action: 'RELEASE',
    requiredPermission: 'inventory:release',
    requiresReason: true,
  },
  {
    from: 'BOOKED',
    to: 'AVAILABLE',
    action: 'CANCEL',
    requiredPermission: 'bookings:cancel',
    requiresReason: true,
  },
  {
    from: 'AGREEMENT',
    to: 'AVAILABLE',
    action: 'CANCEL',
    requiredPermission: 'bookings:cancel',
    requiresReason: true,
  },
];

export function validateUnitTransition(
  from: UnitStatus,
  to: UnitStatus,
  action?: UnitTransitionRule['action']
): UnitTransitionRule | null {
  return (
    UNIT_TRANSITION_RULES.find(
      (r) => r.from === from && r.to === to && (!action || r.action === action)
    ) ?? null
  );
}

export const ALLOWED_PRICE_BOOK_TRANSITIONS: Record<PriceBookStatus, PriceBookStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'ARCHIVED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  APPROVED: ['SCHEDULED', 'ACTIVE', 'ARCHIVED'],
  SCHEDULED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionPriceBook(
  from: PriceBookStatus,
  to: PriceBookStatus
): boolean {
  return ALLOWED_PRICE_BOOK_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isPriceBookImmutable(status: PriceBookStatus): boolean {
  return (
    status === 'APPROVED' ||
    status === 'SCHEDULED' ||
    status === 'ACTIVE' ||
    status === 'ARCHIVED'
  );
}

export const LEAD_PIPELINE_ORDER: LeadStage[] = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'INTERESTED',
  'VISIT_SCHEDULED',
  'VISITED',
  'NEGOTIATION',
  'BOOKED',
  'CLOSED',
];

export const ALLOWED_BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  HOLD_REQUESTED: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'BOOKED', 'CANCELLED'],
  APPROVED: ['BOOKED', 'CANCELLED'],
  BOOKED: ['AGREEMENT_EXECUTED', 'CANCELLED'],
  AGREEMENT_EXECUTED: ['REGISTERED', 'CANCELLED'],
  REGISTERED: [],
  CANCELLED: [],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}
