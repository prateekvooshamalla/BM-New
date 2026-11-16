# Bharat Makaan — Razorpay SaaS Subscription & Onboarding Billing Architecture

## 1. Commercial Package Model (Strictly Two Paid Builder Packages)

Bharat Makaan implements **only** two recurring builder subscription packages:

| Package Code | Name | Monthly Price (Excl. Tax) | Project Capacity Rule | Included Modules | Excluded (Prepaid Wallets) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `SINGLE_PROJECT` | Single Project Builder | **INR 5,999 / month** | Hard limit: **1 active project** | Projects, Towers/Floors/Units, Parking, Inventory, Dynamic Pricing, Cost Sheets, Lead CRM, Channel Partners, Site Visits, Bookings/Collections, Documents, Reports, AI Assistant UI, WhatsApp UI | AI token consumption & chargeable WhatsApp messages |
| `MULTI_PROJECT` | Multi-Project Builder | **INR 4,999 / project / month** | Minimum **2 projects** (`INR 9,998/mo`). Formula: `4999 × MAX(2, subscribedProjectCapacity)` | Everything in `SINGLE_PROJECT` + multi-project capacity & consolidated portfolio analytics | AI token consumption & chargeable WhatsApp messages |

### Optional One-Time Assisted Onboarding (`onboarding_orders`)
Assisted onboarding is **never** a third subscription plan and is **never** charged unless explicitly selected by the builder:
- `SELF_SERVICE`: **INR 0** (Free)
- `ASSISTED_SINGLE_PROJECT`: **INR 9,999** one-time (before configurable GST)
- `ASSISTED_TWO_PROJECTS`: **INR 19,999** one-time (before configurable GST)
- `CUSTOM_ENTERPRISE_IMPORT`: Custom quoted (`REQUIRES_QUOTE`)

---

## 2. Server-Side Razorpay Integration Architecture

1. **Zero Trust Toward Client Inputs**:
   - The frontend sends only `orgId`, `packageCode` (`SINGLE_PROJECT` | `MULTI_PROJECT`), `requestedProjectSlots` (for `MULTI_PROJECT`), optional `onboardingServiceCode`, and `idempotencyKey`.
   - The backend computes exact INR/Paise amounts from authoritative server configuration, applies configurable tax (`gstRatePct`, default `18%`), and calls Razorpay's server APIs using `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (never exposed to frontend code).

2. **Plan Mapping & Quantity Handling**:
   - `syncRazorpayPlansService` provisions or maps two canonical Razorpay monthly plans:
     - `SINGLE_PROJECT` plan (`item.amount` = `5999 * (1 + taxRate)` in Paise, `quantity = 1`).
     - `MULTI_PROJECT` per-project unit plan (`item.amount` = `4999 * (1 + taxRate)` in Paise, `quantity = Math.max(2, subscribedProjectCapacity)`).
   - **Quantity & Plan Change Workflow**:
     - When upgrading `SINGLE_PROJECT -> MULTI_PROJECT` or changing `subscribedProjectCapacity` on `MULTI_PROJECT`, the backend displays the exact recurring delta first.
     - If the existing Razorpay subscription is `ACTIVE` and supports `subscriptions.update({ plan_id, quantity, schedule_change_at: 'now' })`, the backend updates it; when Razorpay restricts mid-cycle plan/quantity changes (e.g., UPI Autopay / e-mandate constraints), the backend creates a linked replacement subscription (`migrationFromSubscriptionId`), waits for authoritative payment/authentication webhook confirmation before activating new capacity, and cancels the superseded subscription cleanly to prevent double-billing.

3. **Webhook Verification, Idempotency & Reconciliation**:
   - Endpoint: `razorpaySaasWebhook` (`onRequest`).
   - Verifies `x-razorpay-signature` using `crypto.timingSafeEqual` over **`req.rawBody`** and `RAZORPAY_SAAS_WEBHOOK_SECRET`.
   - Extracts Razorpay `x-razorpay-event-id` (or deterministic hash over event payload ID + event type) and executes inside a Firestore transaction against `subscription_events/{eventId}`:
     - If `subscription_events/{eventId}` already exists with `processed: true`, returns HTTP `200 { deduplicated: true }` immediately — **guaranteeing duplicate webhooks never double-activate entitlements or double-credit wallets**.
   - Supported lifecycle events:
     - `subscription.authenticated` / `subscription.activated` / `subscription.charged`: Marks `subscriptions/{orgId}` `ACTIVE`, updates `entitlements/{orgId}.subscribedProjectCapacity`, records `invoices` + `payments`, and writes `BILLING` audit event.
     - `subscription.pending` / `subscription.halted` / `payment.failed`: Records failed `payments` entry, sets `subscriptions/{orgId}` to `PAST_DUE` with `gracePeriodEndsAt` (`+7 days` configurable), and **never** grants new paid project capacity.
     - `subscription.cancelled`: Marks `CANCELLED_AT_PERIOD_END` or transitions to read-only post-period while preserving all tenant records.
     - `payment.captured`: Settles matching `onboarding_orders` or `credit_topups` idempotently.

---

## 3. Firestore Billing Collections Maintained

1. `subscriptions/{orgId}` — Current package, Razorpay subscription ID, status, period dates, grace period, and pending plan-change state.
2. `entitlements/{orgId}` — Authoritative server-enforced active project capacity (`subscribedProjectCapacity`), workspace mode (`FULL_ACCESS` | `GRACE_WARNING` | `READ_ONLY_SUSPENDED`), and prepaid wallet balances (`aiBalancePaise`, `aiReservedPaise`, `whatsappBalancePaise`).
3. `subscription_events/{eventId}` — Idempotent webhook & lifecycle event log preventing replay/duplicate mutations.
4. `invoices/{invoiceId}` — Tax-compliant SaaS invoices (`SUBSCRIPTION`, `CAPACITY_UPGRADE`, `ONBOARDING`, `WALLET_TOPUP`).
5. `payments/{paymentId}` — Verified Razorpay payment attempts (`CAPTURED`, `FAILED`, `REFUNDED`).
6. `onboarding_orders/{orderId}` — Optional one-time assisted onboarding orders (`SELF_SERVICE`, `ASSISTED_SINGLE_PROJECT`, `ASSISTED_TWO_PROJECTS`, `CUSTOM_ENTERPRISE_IMPORT`).
7. `credit_topups/{topupId}` — Prepaid AI Wallet & WhatsApp Wallet top-up orders (`PENDING`, `PAID`, `FAILED`).
8. `usage_ledger/{entryId}` — Append-only double-checked ledger of every wallet top-up, reservation, settlement, release, and refund.
