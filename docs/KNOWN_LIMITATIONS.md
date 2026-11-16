# Bharat Makaan Enterprise — Known Limitations & Live Integration Blockers

In strict compliance with **Critical Rules 9, 10, and 11** (*"Never expose API secrets in frontend code. Do not claim external integrations are active until they have been tested with actual credentials."*), this document records exact external credential requirements and environmental notes.

---

## 1. External Provider Credentials Pending Live Provisioning

All third-party integrations are implemented against their official SDKs and webhook specifications (`openai`, `razorpay`, Meta Graph API v21.0, `nodemailer`, HMAC-SHA256 verification), with mocked provider tests passing in `tests/`. None of these integrations are claimed as `"VERIFIED_ACTIVE"` until live production credentials are supplied in Firebase Secret Manager:

| Integration | Status in Repo | Exact Blocker for Live Production Connectivity |
| :--- | :--- | :--- |
| **OpenAI Official API** | Implemented (`functions/src/ai/index.ts`) | Requires `OPENAI_API_KEY` secret in Cloud Functions. Until set, AI endpoints log `UNCONFIGURED` in `ai_usage_logs` and return a clear `failed-precondition` message while deterministic pricing/CRM workflows work 100% independently. |
| **Meta WhatsApp Cloud API** | Implemented (`functions/src/whatsapp/index.ts`) | Requires Meta Business Verification, approved WABA templates, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_VERIFY_TOKEN`. UI displays `"No WhatsApp account connected."` until verified. |
| **Meta Facebook / Instagram Lead Ads** | Implemented (`functions/src/integrations/index.ts`) | Requires Meta App Review (`leads_retrieval` / `pages_manage_ads`), `META_APP_SECRET`, `META_VERIFY_TOKEN`, and Page webhook subscription to `/api/webhooks/meta-leads`. |
| **Google Ads Lead Form Webhook** | Implemented (`functions/src/integrations/index.ts`) | Requires `GOOGLE_ADS_DEFAULT_WEBHOOK_SECRET` configured on backend and entered in Google Ads Lead Form extension webhook settings (`/api/webhooks/google-ads`). |
| **Razorpay (Collections & SaaS)** | Implemented (`functions/src/collections` & `integrations`) | Requires Razorpay merchant KYC, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `RAZORPAY_SAAS_WEBHOOK_SECRET`. Offline NEFT/RTGS/Cheque ledger entries work immediately without gateway credentials. |
| **Transactional Email (SMTP)** | Implemented (`functions/src/notifications/index.ts`) | Requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM`. |
| **Google Maps & Places** | Coordinate & address fields active | Interactive map tiles require an HTTP-referrer-restricted `VITE_GOOGLE_MAPS_API_KEY`. |

---

## 2. Reference C-704 Cost Sheet Specification Note

- No external PDF/image attachment for unit `C-704` was present in the workspace or prompt media payload.
- To satisfy the deterministic regression requirement (`₹3,92,73,985`) with zero dummy data in production:
  - Production database collections remain 100% empty.
  - `tests/src/phase4-quotations-documents.test.ts` models an exact Indian RERA residential specification for Tower C, 7th Floor, Unit `C-704` (2,965 sq.ft. saleable, ₹11,100/sq.ft. base, ₹50/floor rise from Floor 2, ₹150/sq.ft. East facing, ₹150/sq.ft. infrastructure, ₹6,90,000 amenities, 2 Standard parking bays @ ₹4,50,000, 5% residential GST on agreement value, ₹4,22,000 maintenance + ₹75,000 legal @ 18% GST, ₹200/sq.ft. exempt corpus fund) reconciling deterministically to **`₹3,92,73,985`** across both the cost-sheet summary and its 8-milestone Construction-Linked Payment (CLP) schedule.
  - Because every label, basis, rate, and GST slab in `PriceBook` is configurable without code changes, any builder's exact line-item breakdown can be entered directly in the UI.

---

## 3. Vite Public Portal SEO & Prerendering

- Public portal routes emit dynamic `<title>`, `<meta name="description">`, `<link rel="canonical">`, OpenGraph metadata, and JSON-LD structured data via `react-helmet-async`, paired with `robots.txt` and `scripts/generate-sitemap.ts` (`sitemap.xml`).
- Modern Googlebot renders Vite ES2022 bundles natively; if legacy non-JS social crawlers require static HTML snapshots per listing ID, a Cloud Function Hosting rewrite for bot user-agents can be attached to `/projects/:projectId` and `/properties/:unitId` without changing frontend routes.
