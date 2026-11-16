# Bharat Makaan — Server-Enforced Project Entitlements, Upgrades, Downgrades & Grace Policy

## 1. Active Project Lifecycle States

Every `Project` document carries an authoritative `lifecycleStatus`:
- `ACTIVE` — Counts toward `entitlements/{orgId}.subscribedProjectCapacity`. Full inventory, pricing, quotation, CRM, partner, and booking operations enabled.
- `ARCHIVED_READ_ONLY` — Preserved historical or paused project. Does **not** consume an active project slot; all historical units, quotations, leads, bookings, and documents remain viewable and exportable, while new inventory/booking mutations are blocked until reactivated within paid capacity.

---

## 2. Strict Server-Side Capacity Enforcement

1. **New Organization Onboarding**:
   - Creating a Builder Organization initializes `entitlements/{orgId}` in `PENDING_SUBSCRIPTION` (`subscribedProjectCapacity = 0`) until a verified `SINGLE_PROJECT` (`capacity = 1`) or `MULTI_PROJECT` (`capacity >= 2`) subscription is activated (or provisioned by Super Admin).
2. **Project Creation & Activation (`createProjectService` / `setProjectLifecycleStatusService`)**:
   - Executed inside an atomic Firestore `runTransaction`:
     - Counts all existing `projects` for `orgId` where `lifecycleStatus !== 'ARCHIVED_READ_ONLY'`.
     - Verifies `entitlements.workspaceAccessMode !== 'READ_ONLY_SUSPENDED'` and `activeProjectsCount < entitlements.subscribedProjectCapacity`.
     - Under `SINGLE_PROJECT` (`subscribedProjectCapacity === 1`), creating or activating a 2nd active project throws `HttpsError('resource-exhausted', ...)` — direct API calls cannot bypass UI checks.
     - Under `MULTI_PROJECT`, capacity equals exact paid `subscribedProjectCapacity` (`>= 2`). Increasing slots creates a verified Razorpay billing update; capacity increases **only** after payment verification.

---

## 3. Upgrade, Downgrade & Cancellation Rules

### Upgrading (`SINGLE_PROJECT` → `MULTI_PROJECT` or Adding Project Slots)
- Preserves 100% of existing projects, towers, units, quotations, leads, bookings, and documents.
- Displays exact monthly billing impact (`₹4,999 × MAX(2, slots)` + applicable GST) prior to checkout.
- Unlocks additional project slots immediately upon verified Razorpay confirmation.

### Downgrading (`MULTI_PROJECT` → `SINGLE_PROJECT` or Reducing Slots)
- If `activeProjectsCount > targetProjectCapacity`, the backend **requires** `retainedActiveProjectIds` matching `<= targetProjectCapacity`.
- Excess projects are transitioned atomically to `lifecycleStatus: 'ARCHIVED_READ_ONLY'` — **never deleted**.
- All quotations, customer bookings, payment ledgers, and audit trails in archived projects remain intact and exportable.

### Payment Failure, Grace Period & Cancellation
- **Payment Failure (`PAST_DUE`)**: Starts a configurable grace window (default **7 days**, `gracePeriodEndsAt`). During the grace window, builders see a prominent billing recovery banner while operations continue uninterrupted (`GRACE_WARNING`).
- **Grace Expiry / Subscription Cancellation (`READ_ONLY_SUSPENDED`)**: Once `now > gracePeriodEndsAt` or a cancelled period ends:
  - New project creation, inventory imports, new quotations, and chargeable operations are blocked.
  - Read access to existing CRM records, bookings, collections, invoices, and lawful data exports remains available to authorized builder admins.
