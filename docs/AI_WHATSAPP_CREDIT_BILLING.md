# Bharat Makaan — Prepaid AI Wallet & WhatsApp Wallet Credit Billing

AI usage and chargeable WhatsApp messaging are **not** bundled as unlimited services inside subscription plans. Each builder organization has two isolated prepaid wallets maintained in `entitlements/{orgId}` and backed by an append-only `usage_ledger`.

---

## 1. Wallet Structure & Monetary Precision

All balances and ledger charges are stored in integer **Paise** (`1 INR = 100 Paise`) to eliminate floating-point rounding drift:
- **AI Wallet**:
  - `aiBalancePaise` (Total settled balance)
  - `aiReservedPaise` (Locked for in-flight high-cost AI jobs)
  - `Available AI Balance = aiBalancePaise - aiReservedPaise`
- **WhatsApp Wallet**:
  - `whatsappBalancePaise`
  - `whatsappReservedPaise`
- **Enterprise Credit Floor**:
  - `allowNegativeUntilPaise` (Default `0`; negative balances are **strictly forbidden** unless explicitly authorized by a Platform Super Admin with an audited credit limit).

### Configurable Top-Up Denominations (`credit_topups`)
- Standard presets: **INR 500**, **INR 2,000**, **INR 5,000**, plus validated custom amounts (`INR 100` – `INR 5,00,000`).
- Top-up orders create a Razorpay Order (`orders.create`) and credit the target wallet (`AI` or `WHATSAPP`) **only** after cryptographic Razorpay payment verification inside an idempotent Firestore transaction. Failed payments leave wallet balances unchanged.

---

## 2. AI Metered Billing (`RESERVE` → `SETTLE` / `RELEASE`)

1. **Supported OpenAI Models & Configurable Rate Schedule (`AI_RATE_CARD_V1`)**:
   - Orchestration: `gpt-4.1` (env `OPENAI_MODEL_ORCHESTRATOR`)
   - Vision Floor-Plan Extraction: `gpt-4.1` (env `OPENAI_MODEL_VISION_FLOORPLAN`)
   - Complex Multi-Page Escalation: `o4-mini` (env `OPENAI_MODEL_ESCALATION`)
   - Fast Intent Classification: `gpt-4.1-mini` (env `OPENAI_MODEL_CLASSIFIER`)
   - Rates per 1M input/output tokens and USD→INR conversion factor are configurable in platform billing settings and versioned via `rateVersion`.
2. **Idempotency & Reservation Lifecycle**:
   - Every chargeable AI request carries a deterministic `requestId`.
   - Before invoking OpenAI, `reserveAiWalletBalance` runs a Firestore transaction:
     - If a settled `usage_ledger` entry already exists for `(orgId, requestId)`, returns `alreadyCharged: true` so retries **never double-charge**.
     - Checks `aiBalancePaise - aiReservedPaise >= estimatedPaise`; if insufficient, throws `HttpsError('resource-exhausted', 'INSUFFICIENT_AI_CREDITS: ...')` without affecting CRM/inventory read/write access.
     - Increments `aiReservedPaise` and appends a `RESERVATION` ledger record.
   - After OpenAI responds, `settleAiWalletCharge` computes exact Paise from `usage.input_tokens` and `usage.output_tokens`, releases `aiReservedPaise`, deducts actual `chargePaise` from `aiBalancePaise`, and appends an immutable `AI_DEBIT` ledger entry containing `orgId`, `uid`, `feature`, `model`, `inputTokens`, `outputTokens`, `rateVersion`, `chargePaise`, `requestId`, and `createdAt`.
   - If the OpenAI call fails, `releaseAiWalletReservation` releases `100%` of `estimatedPaise` so failed provider calls cost `₹0`.

---

## 3. WhatsApp Metered Billing & Webhook Idempotency

1. **Category & Market Rate Card (`WHATSAPP_RATE_CARD_V1`)**:
   - Rates are keyed by `recipientMarket` (e.g., `IN`, `AE`, `US`, `GB`, `ROW`) and Meta `messageCategory` (`MARKETING`, `UTILITY`, `AUTHENTICATION`, `SERVICE`).
   - Free-form replies inside an active 24-hour `SERVICE` customer-care window have `chargePaise = 0` when non-chargeable under the configured provider schedule; outbound `MARKETING`, `UTILITY`, and `AUTHENTICATION` templates apply the market's Paise rate.
2. **Single-Charge Idempotency & Failure Credit**:
   - Outbound chargeable messages deduct/record against deterministic key `wa_charge_${orgId}_${waMessageId || messageId}`.
   - Duplicate Meta webhook redeliveries (`sent` / `delivered` / `pricing` events with the same `waMessageId`) detect the existing `usage_ledger` entry and **never double-charge**.
   - If Meta reports `failed` delivery (`statuses[].status === 'failed'`), `refundFailedWhatsappChargeService` appends an idempotent `WHATSAPP_REFUND_CREDIT` ledger entry restoring the exact Paise to `whatsappBalancePaise`.
   - When `whatsappBalancePaise <= 0`, new chargeable template dispatches are blocked with a clear `INSUFFICIENT_WHATSAPP_CREDITS` notice while reading conversations, CRM leads, and historical messages remains uninterrupted.
