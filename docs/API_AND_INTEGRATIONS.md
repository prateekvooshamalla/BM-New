# Bharat Makaan Enterprise — Backend API & External Integrations Reference

## 1. Cloud Functions v2 Callable Endpoints

All client-to-server business mutations execute through authenticated Firebase Cloud Functions v2 (`onCall`), validating payloads with `@bharat-makaan/validation` Zod schemas, enforcing RBAC permissions (`requireOrgPermission` / `requireSuperAdmin`), and writing immutable `audit_events`.

| Domain | Callable Function | Required Permission | Transactional |
| :--- | :--- | :--- | :--- |
| **Auth** | `syncMySessionMemberships`, `generateEmployeePasswordReset` | Authenticated / `staff:manage_permissions` | Yes |
| **Organizations** | `createOrganization`, `inviteStaffMember`, `updateMemberAccess`, `transferEmployeeLeads` | `staff:invite`, `staff:manage_permissions`, `staff:suspend`, `staff:transfer_leads` | Yes |
| **Super Admin** | `superAdminGetPlatformOverview`, `superAdminUpdateTenant` | `PLATFORM_SUPER_ADMIN` claim | No / Audit |
| **Projects** | `createProject`, `toggleProjectPublicVisibility`, `createPhase`, `createTower`, `createFloor` | `projects:create`, `projects:edit`, `projects:publish_public` | Yes |
| **Inventory** | `createUnit`, `bulkGenerateTowerUnits`, `transitionUnitStatus` | `inventory:manage`, `inventory:hold`, `inventory:reserve`, `inventory:release` | **Yes (Optimistic Lock)** |
| **Parking** | `createParkingSlot`, `allocateParkingSlot`, `releaseParkingSlot`, `swapParkingSlots` | `parking:manage`, `parking:allocate`, `parking:swap` | **Yes (Conflict Lock)** |
| **Pricing** | `savePriceBookDraft`, `clonePriceBookVersion`, `submitPriceBookForApproval`, `activatePriceBook` | `pricing:edit_draft`, `pricing:submit_approval`, `pricing:activate` | Yes / Batch |
| **Approvals** | `decideApproval` | Entity-specific (`pricing:approve`, `quotations:approve_discount`, `bookings:approve`) | **Yes** |
| **Quotations** | `createPaymentPlan`, `createQuotation`, `shareQuotationAuthorized` | `quotations:create`, `quotations:request_discount`, `quotations:share` | Snapshot + PDF |
| **Documents** | `registerDocument`, `replaceDocumentVersion`, `mapFloorPlanVersion`, `createDocumentShareLink` | `documents:upload`, `documents:manage_versions`, `documents:share_external` | Batch |
| **CRM Leads** | `createLead`, `updateLeadStage`, `addLeadActivity`, `bulkAssignLeads` | `leads:create`, `leads:edit`, `leads:assign` | Dedup Check |
| **Partners** | `onboardPartnerOrganization`, `registerPartnerLead`, `resolvePartnerLeadConflict` | `partners:manage`, `partners:register_lead`, `partners:resolve_conflict` | **Yes (Protection Lock)** |
| **WhatsApp** | `startOrGetWhatsappConversation`, `sendWhatsappMessage`, `approveAiWhatsappDraft` | `whatsapp:send`, `whatsapp:approve_ai_reply` | 24h Window Guard |
| **Site Visits** | `scheduleSiteVisit`, `updateSiteVisitOutcome`, `registerMobilePushToken` | `visits:schedule`, `visits:manage_outcome` | Idempotent Key |
| **Bookings** | `createBooking`, `transitionBookingStatus` | `bookings:create`, `bookings:approve`, `bookings:cancel` | **Yes (Unit Lock)** |
| **Collections** | `recordCollectionEntry`, `createRazorpayCollectionOrder`, `reconcileCollectionSettlement` | `collections:record`, `collections:refund`, `collections:reconcile` | **Yes** |
| **Forms & Billing** | `upsertLeadForm`, `submitPublicLeadForm`, `changeSaasSubscriptionPlan` | `forms:manage` / Public Rate-Limited / `billing:manage` | Rate-Limited |
| **OpenAI** | `runAiAssistant` (14 structured capabilities) | `ai:use` / `ai:admin_reports` | Credit Cap Guard |
| **Audit** | `listAuditEvents` | `audit:view` / `PLATFORM_SUPER_ADMIN` | Read-Only |

---

## 2. Authenticated Webhook Endpoints

Rewritten cleanly via `firebase.json` Hosting rules:

| Public Path | Cloud Function | Verification Mechanism |
| :--- | :--- | :--- |
| `/api/webhooks/whatsapp` | `whatsappWebhook` | `GET` `hub.verify_token` + `POST` `X-Hub-Signature-256` HMAC-SHA256 (`WHATSAPP_APP_SECRET`) |
| `/api/webhooks/meta-leads` | `metaLeadsWebhook` | `GET` `hub.verify_token` + `POST` `X-Hub-Signature-256` HMAC-SHA256 (`META_APP_SECRET`) |
| `/api/webhooks/google-ads` | `googleAdsWebhook` | `POST` `google_key` shared secret verification |
| `/api/webhooks/razorpay-collections` | `razorpayCollectionsWebhook` | `POST` `X-Razorpay-Signature` HMAC-SHA256 (`RAZORPAY_WEBHOOK_SECRET`), `notes.system == "BUILDER_CUSTOMER_COLLECTIONS"` |
| `/api/webhooks/razorpay-saas` | `razorpaySaasWebhook` | `POST` `X-Razorpay-Signature` HMAC-SHA256 (`RAZORPAY_SAAS_WEBHOOK_SECRET`), `notes.system == "BHARAT_MAKAAN_SAAS_BILLING"` |

---

## 3. Scheduled Automation Jobs (`firebase-functions/v2/scheduler`)

- `expireStaleUnitHolds` (`every 15 minutes`): Releases expired `ON_HOLD` units back to `AVAILABLE` transactionally with audit history.
- `dispatchSiteVisitReminders` (`every 30 minutes`): Dispatches upcoming 24-hour site visit reminders idempotently using `reminderJobKey` + `reminderSentAt` transaction locks.
