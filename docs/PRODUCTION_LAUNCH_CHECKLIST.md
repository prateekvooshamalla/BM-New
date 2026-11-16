# Bharat Makaan — Production Launch Checklist

## 1. Firebase & Identity Platform Configuration
- [ ] **Firebase Authentication Providers**:
  - Enable **Email/Password** (with Email Verification templates enabled).
  - Enable **Google Sign-In** (configure authorized domains for production web domain).
- [ ] **Identity Platform Multi-Factor Authentication (MFA)**:
  - Upgrade Firebase Auth to Identity Platform and enable **TOTP (Time-based One-Time Password)** second factor.
  - Provision initial Platform Super Admin (`prateek.parts@gmail.com`) via server-side script `scripts/provision-super-admin.ts` using a strong non-hardcoded secret from environment (`SUPER_ADMIN_INITIAL_PASSWORD`) and immediately enroll TOTP MFA at `/builder/settings?tab=security` before accessing `/admin/*`.
- [ ] **Firebase App Check**:
  - Register Web app with reCAPTCHA Enterprise and set `VITE_FIREBASE_APP_CHECK_SITE_KEY` in production build environment.
  - Enforce App Check on Cloud Firestore, Cloud Storage, and Cloud Functions v2 callables.
- [ ] **Deploy Security Rules & Composite Indexes**:
  - Deploy `firebase/firestore.rules`, `firebase/firestore.indexes.json`, and `firebase/storage.rules` (`firebase deploy --only firestore,storage`).

## 2. Server-Side Secrets (Firebase Secret Manager / Cloud Functions Env)
Never place any of the following secrets in `apps/web` or `apps/mobile`:
- [ ] **`RAZORPAY_KEY_ID`** — Live Razorpay API Key ID (`rzp_live_...`).
- [ ] **`RAZORPAY_KEY_SECRET`** — Live Razorpay API Key Secret (used server-side for `plans.create`, `subscriptions.create`, `orders.create`, and post-checkout HMAC signature verification).
- [ ] **`RAZORPAY_SAAS_WEBHOOK_SECRET`** — Dedicated webhook signing secret for `razorpayBillingWebhook` (`x-razorpay-signature` raw-body SHA-256 HMAC verification).
- [ ] **`RAZORPAY_WEBHOOK_SECRET`** — Dedicated webhook signing secret for builder customer collection webhooks (`razorpayPaymentWebhook`).
- [ ] **`SAAS_GST_RATE_PCT`** — Configurable SaaS GST percentage (defaults to `18`).
- [ ] **`OPENAI_API_KEY`** — Official OpenAI API key for server-side Responses & Chat Completions (`gpt-4.1`, `o4-mini`, `gpt-4.1-mini`).
- [ ] **`WHATSAPP_ACCESS_TOKEN`** & **`WHATSAPP_PHONE_NUMBER_ID`** — Official Meta WhatsApp Cloud API credentials.
- [ ] **`WHATSAPP_APP_SECRET`** & **`WHATSAPP_VERIFY_TOKEN`** — Official Meta webhook HMAC verification (`x-hub-signature-256`) and challenge token.

## 3. Razorpay Live Billing & Webhook Setup
- [ ] **Sync Canonical Builder Packages**:
  - Sign in to `/admin/subscriptions` as MFA-verified Platform Super Admin and click **Sync Razorpay Plans** (creates/verifies `SINGLE_PROJECT` @ INR 5,999/mo and `MULTI_PROJECT` unit plan @ INR 4,999/project/mo).
- [ ] **Configure Razorpay Webhook Endpoint**:
  - Point Razorpay Dashboard Webhook URL to `https://<region>-<project-id>.cloudfunctions.net/razorpayBillingWebhook`.
  - Enable events:
    - `subscription.authenticated`
    - `subscription.activated`
    - `subscription.charged`
    - `subscription.pending`
    - `subscription.halted`
    - `subscription.cancelled`
    - `payment.captured`
    - `payment.failed`
    - `order.paid`
- [ ] **Live Credential Smoke Test**:
  - Perform 1 real `SINGLE_PROJECT` subscription checkout, 1 `MULTI_PROJECT` (2+ slots) checkout, and 1 `INR 500` AI/WhatsApp wallet top-up in Razorpay Test/Live mode to confirm end-to-end webhook delivery before public onboarding.

## 4. Meta WhatsApp & OpenAI Production Readiness
- [ ] **OpenAI Model Access**:
  - Verify organization OpenAI account has active access to `gpt-4.1`, `o4-mini`, and `gpt-4.1-mini`.
- [ ] **Meta WhatsApp Webhook**:
  - Point Meta App Webhook URL to `https://<region>-<project-id>.cloudfunctions.net/whatsappCloudWebhook` and subscribe to `messages` and message status/pricing updates (`sent`, `delivered`, `read`, `failed`).
  - Verify failed message deliveries automatically trigger `FAILED_DELIVERY_REFUND` in `usage_ledger`.

## 5. Pre-Deploy Build, Lint & Security Verification Gates
- [ ] `pnpm build:packages` exits `0`
- [ ] `pnpm typecheck` exits `0`
- [ ] `pnpm lint` exits `0`
- [ ] `pnpm test` passes all unit & integration suites (including all 22 production auth, billing, and wallet scenarios)
- [ ] `firebase emulators:exec --only firestore "pnpm test:emulator"` passes all Firestore security rules tests
- [ ] `pnpm build` produces clean production bundles with zero hardcoded secrets or dummy records
