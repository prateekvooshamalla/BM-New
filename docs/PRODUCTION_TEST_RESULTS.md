# Bharat Makaan — Production Test & Security Verification Results

## 1. Automated Verification Summary

| Gate | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| Shared Package Build | `pnpm build:packages` | **PASSED** (`exit 0`) | `@bharat-makaan/config`, `@bharat-makaan/shared`, `@bharat-makaan/validation` compiled cleanly (`CJS` + `ESM` + `DTS`). |
| Workspace Typecheck | `pnpm typecheck` | **PASSED** (`exit 0`) | Zero TypeScript errors across `packages/*`, `functions`, `apps/web`, `apps/mobile`, and `tests`. |
| ESLint Static Analysis | `pnpm lint` | **PASSED** (`exit 0`) | `0` errors across all packages, backend functions, web app, mobile app, scripts, and tests. |
| Unit & Integration Suite | `pnpm test` | **PASSED** (`12/12` files, `35/35` tests) | Covers Phases 1–10, 20 AI Assistant/Floor-Plan scenarios, and all **22 Production Auth, Role Access, Razorpay Billing & Prepaid Wallet scenarios**. |
| Live Firestore Security Rules | `firebase emulators:exec --only firestore "pnpm test:emulator"` | **PASSED** (`4/4` tests) | Verified live CEL evaluation of `firebase/firestore.rules` on Firebase Firestore Emulator (`SEC-01` partner isolation fix, safe `request.auth.token.get('platformRole', '')` claim lookup, billing/wallet read isolation, customer bookmark isolation, and zero client write elevation). |
| Production Bundle Build | `pnpm build` | **PASSED** (`exit 0`) | Built Cloud Functions (`functions/lib/index.js`) and Vite production Web bundle (`apps/web/dist`) with zero exposed secrets or dummy records. |

---

## 2. All 22 Required Production Scenarios (`tests/src/production-auth-billing-security.test.ts`)

1. **Customer cannot open builder or admin functionality**: Verified `evaluatePersonaRouteAccess` blocks Customer accounts from `BUILDER`, `PARTNER`, and `SUPER_ADMIN` routes, `resolveDefaultPostLoginRoute` routes customers to `/saved`, and `toggleCustomerSavedPropertyService` rejects unpublished internal builder units.
2. **Builder A cannot access Builder B's private data**: Verified `requireOrgPermission` and `setProjectLifecycleStatusService` reject cross-organization access/mutation attempts (`orgA` vs `orgB`).
3. **Unapproved channel partner cannot access builder projects**: Verified `onboardPartnerOrganizationService` with `initialScopeStatus: 'PENDING'` leaves `authorizedOrgIds: []` and blocks `listPartnerAuthorizedWorkspacesService` and `listPartnerAuthorizedInventoryService`.
4. **Approved partner only accesses authorized projects**: Verified `authorizePartnerForBuilderScopeService` grants access strictly to `projAuthorized` while continuing to deny `projSecret` in the same builder organization.
5. **Builder employee permissions & project scopes are enforced**: Verified `SALES_EXECUTIVE` project scoping (`proj-1` allowed, `proj-2` denied, `billing:manage` denied), blocked self-role escalation (`SELF_MODIFICATION_FORBIDDEN`), and blocked sole-admin suspension (`SOLE_ADMIN_PROTECTED`).
6. **Super-admin routes & services reject ordinary users**: Verified `requireSuperAdmin` throws `permission-denied` for non-super-admin authenticated users.
7. **MFA is enforced for privileged accounts**: Verified `assertPrivilegedMfaSatisfied` rejects `PLATFORM_SUPER_ADMIN` and `requireMfaClaim` accounts when `mfaVerified === false`.
8. **Session revocation, disabled accounts & unverified email invites**: Verified `verifySessionNotRevokedOrDisabled` rejects `disabled: true` (`ACCOUNT_DISABLED`) and revoked tokens (`tokensValidAfterTime > authTimeSeconds` -> `SESSION_REVOKED`), and `syncMySessionMembershipsService` withholds `INVITED` memberships until `emailVerified === true`.
9. **Single Project package (`INR 5,999/month`) allows 1 active project**: Verified 1st active project succeeds atomically on `SINGLE_PROJECT`.
10. **Single Project package rejects creating a 2nd active project**: Verified 2nd active project creation throws `Project limit reached (1 active project slot(s) on SINGLE_PROJECT)`.
11. **Multi-Project package charges for at least 2 project slots (`INR 9,998/month`)**: Verified `calculateBuilderSubscriptionMonthlyInr` & `previewSubscriptionPricingService` enforce minimum 2 slots (`1 -> ₹9,998`, `2 -> ₹9,998`, `3 -> ₹14,997`, `5 -> ₹24,995`, `10 -> ₹49,990`) and `SELF_SERVICE` onboarding costs `₹0` while optional assisted tiers cost `₹9,999` / `₹19,999`.
12. **Multi-Project slot increases require verified Razorpay billing**: Verified `initiateSubscriptionCheckoutService` stores `pendingPlanChange` without prematurely unlocking `entitlements.subscribedProjectCapacity`.
13. **Payment failure does not grant paid access**: Verified `processRazorpayWebhookService` on `payment.failed` records failed payment state without granting extra project slots, and forged client checkout signatures fail `verifyRazorpayCheckoutSignatureService` (`INVALID_RAZORPAY_SIGNATURE`).
14. **Duplicate Razorpay webhooks are idempotent**: Verified redelivered `subscription.activated` webhooks with identical `x-razorpay-event-id` return `{ deduplicated: true }` via `subscription_events/{eventId}`.
15. **Failed credit top-ups do not increase wallet balance**: Verified `payment.failed` webhook on `WALLET_TOPUP` marks `credit_topups` `FAILED` while keeping `aiBalancePaise === 0`.
16. **Duplicate AI requests are not charged twice**: Verified `settleAiWalletUsageService` keyed by `requestId` debits `usage_ledger` once and returns `{ deduplicated: true }` on retry without double-debiting `aiBalancePaise`.
17. **WhatsApp billing records are idempotent by `waMessageId` & auto-refund failed deliveries**: Verified `chargeWhatsappMessageWalletService` charges `88` Paise once for India `MARKETING`, deduplicates redeliveries on the same `waMessageId`, and `refundFailedWhatsappChargeService` restores `88` Paise via `FAILED_DELIVERY_REFUND`.
18. **Insufficient AI or WhatsApp credits block only chargeable actions**: Verified `0` Paise wallets reject chargeable OpenAI (`INSUFFICIENT_AI_CREDITS`) and WhatsApp (`INSUFFICIENT_WHATSAPP_CREDITS`) calls while non-AI CRM lead creation (`ingestLeadService`) continues normally.
19. **Subscription downgrade & cancellation preserve customer data**: Verified downgrading from 2 active projects to `SINGLE_PROJECT` requires `retainedActiveProjectIds`, archives excess projects to `ARCHIVED_READ_ONLY` without deleting units, blocks unauthorized reactivation, and cancellation transitions workspace to `READ_ONLY_SUSPENDED` while preserving reads and billing recovery.
20. **Web and mobile use the same authenticated backend permissions & entitlements**: Verified `PRIMARY_WEB_NAVIGATION` (12 `/builder/*` items), `MOBILE_BOTTOM_TABS` (5 tabs), and `filterAuthorizedMobileMoreFeatures` evaluate against shared `@bharat-makaan/shared` RBAC.
21. **Public visitors search published listings without builder access**: Verified only `isPublicPublished === true` projects/units appear publicly and in `getCustomerPortalDataService`.
22. **All persona flows & empty states operate on real persisted data**: Verified newly authenticated customer portals return empty arrays (`0` saved properties, `0` enquiries, `0` visits) until real actions are performed — zero dummy data or fake payment states.

---

## 3. External Live Provider Credential Status (Transparent Disclosure)

Per Rule 10 ("Do not claim external integrations are active until they have been tested with actual credentials"):
- **Firebase Security Rules & Transactional Services**: Verified against local Firebase Firestore Emulator & full Vitest integration harness.
- **Razorpay Subscriptions, Orders & Webhooks**: Server-side SDK integration, raw-body SHA-256 HMAC verification (`razorpayBillingWebhook` / `razorpaySaasWebhook`), checkout signature verification, and idempotency ledgers are implemented and verified with cryptographic HMAC test vectors. Live charges require populating `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_SAAS_WEBHOOK_SECRET` in Firebase Secret Manager per `docs/PRODUCTION_LAUNCH_CHECKLIST.md`.
- **OpenAI API & Meta WhatsApp Cloud API**: Server-side SDK clients and prepaid wallet reservation/settlement/refund hooks are wired and verified with deterministic mocks and HMAC vectors; live calls activate automatically once `OPENAI_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, and `WHATSAPP_APP_SECRET` are configured in production environment secrets.
