# Bharat Makaan Enterprise — Firestore & Storage Data Model

## 1. Multi-Tenant & Security Design Principles

1. **Flat Top-Level Collections with Mandatory `orgId` Partitioning**:
   All tenant business collections live as top-level collections carrying an immutable `orgId: string` field (plus deterministic composite document IDs where uniqueness is required, such as `${orgId}_${uid}` on `organization_members` or `${projectId}_${slotCode}` on `parking_slots`).
   - *Why*: Enables efficient organization-wide reporting, partner cross-project queries (`where('orgId', '==', orgId)` + `where('projectId', 'in', permittedProjectIds)`), and clean Firestore Security Rules without deep subcollection path nesting limits.
2. **Deterministic Uniqueness Keys**:
   - `organization_members/{orgId}_{uid}` — Prevents duplicate user memberships in the same organization.
   - `partner_members/{partnerOrgId}_{uid}` — Prevents duplicate partner user memberships.
   - `parking_slots/{projectId}_{levelCode}_{slotNumber}` — Guarantees unique physical slot identifiers per project/level scheme.
   - `lead_registrations/{orgId}_{projectId}_{normalizedPhoneHash}` — Enforces atomic lead-protection lock inside transactions so duplicate channel partner registrations never silently overwrite existing ownership.
3. **Server-Authoritative State Transitions**:
   Critical financial and inventory collections (`units` status changes, `parking_allocations`, `price_books` activation, `quotations` approval/PDF lock, `bookings`, `collection_records`, `reconciliation_records`, `subscriptions`, `invoices`, `audit_events`) permit client reads (scoped by RBAC) while routing privileged state mutations through server-side Cloud Functions (`db.runTransaction`) that atomically write corresponding `audit_events`.
4. **Secret Isolation**:
   Provider credentials or webhook secrets are NEVER stored in client-readable `integrations` documents; `integrations/{integrationId}` holds non-sensitive metadata/status only, while secrets live in Firebase Secret Manager / environment variables or server-only `_integration_secrets/{integrationId}` (`allow read, write: if false;` in `firestore.rules`).

---

## 2. Complete Collection Catalog (36 Core Entities)

### A. Identity, Multi-Tenancy & Partner Network

| Collection | Doc ID Strategy | Key Fields | Isolation & Notes |
| :--- | :--- | :--- | :--- |
| `organizations` | `{orgId}` | `name`, `slug`, `legalName`, `gstin`, `pan`, `reraNumber`, `headquartersCity`, `logoUrl`, `status` (`ACTIVE` \| `SUSPENDED`), `subscriptionPlanId`, `leadProtectionDays`, `whatsappAutoSendAi`, `createdBy`, `createdAt`, `updatedAt` | Builder tenant root. Created via server callable; Super Admin manages suspension & plan overrides. |
| `organization_members` | `{orgId}_{uid}` | `orgId`, `uid`, `email`, `displayName`, `phone`, `role` (`RoleKey`), `permissions` (`PermissionKey[]`), `assignedProjectIds` (`string[]`), `department`, `managerUid`, `status` (`INVITED` \| `ACTIVE` \| `SUSPENDED` \| `REVOKED`), `mfaRequired`, `invitedBy`, `lastActiveAt` | Primary RBAC lookup document read by both `firestore.rules` and Cloud Functions. |
| `partner_organizations` | `{partnerOrgId}` | `companyName`, `contactName`, `email`, `phone`, `registrationNumber`, `reraNumber`, `gstin`, `officeCity`, `officeAddress`, `status` (`PENDING` \| `ACTIVE` \| `SUSPENDED`), `authorizedOrgIds` (`string[]`), `projectScopes` (`Record<orgId, { projectIds: string[], commissionPct: number, terms: string }>`), `metrics` | Supports 1 partner working across multiple builders with explicit per-builder, per-project authorization. |
| `partner_members` | `{partnerOrgId}_{uid}` | `partnerOrgId`, `uid`, `email`, `displayName`, `phone`, `role` (`CHANNEL_PARTNER_ADMIN` \| `CHANNEL_PARTNER_AGENT`), `permissions`, `status`, `createdAt` | Scopes partner team members to their `partnerOrgId`. |

### B. Project Hierarchy, Visual Inventory & Physical Parking

| Collection | Doc ID Strategy | Key Fields | Isolation & Notes |
| :--- | :--- | :--- | :--- |
| `projects` | `{projectId}` | `orgId`, `builderName`, `name`, `code`, `city`, `locality`, `address`, `coordinates` (`{lat, lng}`), `projectType` (`APARTMENT` \| `VILLA` \| `PLOTTED` \| `COMMERCIAL` \| `MIXED`), `reraNumber`, `reraValidUntil`, `landAreaAcres`, `totalPhases`, `totalTowers`, `totalFloors`, `totalUnits`, `configurations` (`string[]`), `amenities` (`string[]`), `constructionStatus`, `possessionDate`, `isPublicPublished`, `listingIntent` (`BUY` \| `RENT` \| `BOTH`), `startingPrice`, `heroImageUrl`, `teamMemberUids`, `stats` (live counters) | Supports optional phase/tower/floor levels for Plotted & Villa developments. Public portal queries `isPublicPublished == true`. |
| `project_phases` | `{phaseId}` | `orgId`, `projectId`, `name`, `code`, `sequence`, `reraNumber`, `constructionStatus`, `possessionDate`, `totalTowers`, `totalUnits` | Optional hierarchy tier under `projects`. |
| `towers` | `{towerId}` | `orgId`, `projectId`, `phaseId` (nullable), `name`, `code`, `towerType` (`TOWER` \| `BLOCK` \| `SECTOR` \| `VILLA_CLUSTER`), `totalFloors`, `basementLevels`, `podiumLevels`, `unitsPerFloorTypical`, `status` | Represents residential tower, commercial wing, or plot sector. |
| `floors` | `{floorId}` | `orgId`, `projectId`, `phaseId`, `towerId`, `floorNumber` (int, supports negative/0/podium), `label`, `floorCategory` (`PODIUM` \| `LOWER_RESIDENTIAL` \| `TYPICAL` \| `PENTHOUSE` \| `REFUGE` \| `COMMERCIAL`), `totalUnits` | Explicit `floorCategory` prevents upper-floor plans from mistakenly applying to podium/refuge floors. |
| `units` | `{unitId}` | `orgId`, `projectId`, `phaseId`, `towerId`, `towerName`, `floorId`, `floorNumber`, `unitNumber` (e.g., `C-704`), `unitType` (`APARTMENT` \| `PENTHOUSE` \| `VILLA` \| `PLOT` \| `SHOP` \| `OFFICE`), `bhk` (`1 BHK`..`5+ BHK` \| `PLOT`), `saleableAreaSqft`, `carpetAreaSqft`, `plotAreaSqft`, `facing`, `viewType`, `isCorner`, `balconiesCount`, `parkingEntitlementCount`, `assignedParkingSlotIds` (`string[]`), `baseRatePerSqft`, `activePriceBookId`, `floorRiseAmount`, `premiumChargesAmount`, `calculatedTotalPrice`, `status` (`AVAILABLE` \| `ON_HOLD` \| `RESERVED` \| `BOOKED` \| `AGREEMENT` \| `REGISTERED`), `holdExpiresAt`, `heldByUid`, `activeBookingId`, `floorPlanVersionId`, `isPublicPublished`, `listingMode` (`BUY` \| `RENT`), `monthlyRent` | Transactional lock prevents concurrent holds/bookings. |
| `parking_slots` | `{projectId}_{levelCode}_{slotNumber}` | `orgId`, `projectId`, `towerId` (nullable), `levelType` (`BASEMENT` \| `PODIUM` \| `SURFACE` \| `STILT`), `levelName` (e.g., `B1`, `P2`), `zone`, `slotNumber`, `parkingType` (`STANDARD` \| `TANDEM` \| `MECHANICAL` \| `EV` \| `ACCESSIBLE`), `price`, `status` (`AVAILABLE` \| `ALLOCATED` \| `BLOCKED`), `allocatedUnitId`, `allocatedBookingId`, `updatedAt` | Independent inventory; separate from `units.parkingEntitlementCount`. |
| `parking_allocations` | `{allocationId}` | `orgId`, `projectId`, `slotId`, `slotNumber`, `unitId`, `unitNumber`, `bookingId` (nullable), `action` (`ALLOCATED` \| `RELEASED` \| `SWAPPED`), `swappedWithSlotId`, `priceSnapshot`, `performedByUid`, `reason`, `createdAt` | Immutable history of physical slot allocations, releases, and swaps. |

### C. Dynamic Pricing Engine & Quotations

| Collection | Doc ID Strategy | Key Fields | Isolation & Notes |
| :--- | :--- | :--- | :--- |
| `price_books` | `{priceBookId}` | `orgId`, `projectId`, `name`, `description`, `versionNumber`, `parentPriceBookId`, `status` (`DRAFT` \| `PENDING_APPROVAL` \| `APPROVED` \| `SCHEDULED` \| `ACTIVE` \| `ARCHIVED` \| `REJECTED`), `effectiveFrom`, `expiresAt`, `basePricePerSqft`, `floorRiseConfig` (`{ startFloor, ratePerFloorPerSqft }`), `facingPremiums`, `viewPremiums`, `cornerPremiumPerSqft`, `locationPremiumPerSqft`, `parkingPricesByType`, `taxConfig` (`{ residentialGstPct, commercialGstPct, maintenanceGstPct, legalGstPct, roundingMode }`), `maxDiscountPctWithoutApproval`, `defaultPaymentPlanId`, `lineItems` (`CostSheetLineItemRule[]` with stable `internalKey` + editable `displayLabel`), `internalNotes`, `approvedByUid`, `approvedAt`, `isImmutable` | Once `APPROVED`/`ACTIVE`, `isImmutable = true`. Any edit clones a new version. |
| `price_rules` | `{priceRuleId}` | `orgId`, `projectId`, `priceBookId`, `internalKey`, `displayLabel`, `description`, `basis` (`PER_SQFT_SALEABLE` \| `PER_SQFT_CARPET` \| `FIXED_AMOUNT` \| `PERCENTAGE_OF_BASE`), `amount`, `taxCategory` (`AGREEMENT_GST` \| `OTHER_SERVICE_GST` \| `EXEMPT_CORPUS`), `applicableUnitTypes`, `applicableBhk`, `unitSpecificOverrides` (`Record<unitId, number>`), `isOptional`, `isVisible`, `displayOrder`, `isRemovable` | Granular custom charge definitions with stable `internalKey`. |
| `price_revisions` | `{revisionId}` | `orgId`, `projectId`, `unitId` (nullable for project-wide), `unitNumber`, `previousPriceBookId`, `newPriceBookId`, `oldBaseRate`, `newBaseRate`, `oldTotalValue`, `newTotalValue`, `changeAmount`, `changePct`, `effectiveDate`, `changedByUid`, `approvedByUid`, `reason`, `createdAt` | Drives historical Recharts price curve & revision comparison table. |
| `payment_plans` | `{paymentPlanId}` | `orgId`, `projectId`, `name`, `planType` (`CONSTRUCTION_LINKED` \| `DATE_LINKED` \| `DOWN_PAYMENT` \| `CUSTOM`), `isActive`, `milestones` (`Array<{ sequence, name, description, percentage, fixedAmount?, dueTrigger, estimatedDate?, taxTreatment, notes }>`), `totalPercentage` (validated `== 100`) | Supports full CLP schedules reconciling to 100.00%. |
| `quotations` | `{quotationId}` | `orgId`, `projectId`, `towerId`, `floorId`, `unitId`, `unitSnapshot`, `quotationNumber` (e.g., `BM-QT-2026-0001`), `currentVersion`, `status` (`DRAFT` \| `PENDING_APPROVAL` \| `ISSUED` \| `SHARED` \| `ACCEPTED` \| `EXPIRED` \| `SUPERSEDED`), `leadId`, `partnerOrgId`, `customer` (`{ name, phone, email, address }`), `priceBookId`, `priceBookVersion`, `paymentPlanId`, `selectedParkingSlotIds`, `parkingCount`, `discount` (`{ type, value, amount, reason, requiresApproval }`), `breakdown` (immutable deterministic calculation output), `totalPayable`, `validUntil`, `latestPdfStoragePath`, `salesRepUid`, `approvedByUid`, `createdAt` | Retains frozen approved pricing snapshot even if project price book later changes. |
| `quotation_versions` | `{quotationId}_v{version}` | `orgId`, `quotationId`, `version`, `priceBookSnapshot`, `breakdown`, `milestoneSchedule`, `aiCustomerSummary`, `pdfStoragePath`, `createdByUid`, `createdAt` | Versioned snapshots & generated PDF references. |

### D. Documents & Floor Plans

| Collection | Doc ID Strategy | Key Fields | Isolation & Notes |
| :--- | :--- | :--- | :--- |
| `documents` | `{documentId}` | `orgId`, `projectId`, `towerId`, `floorId`, `unitId`, `category` (`MASTER_PLAN` \| `TOWER_PLAN` \| `FLOOR_PLAN` \| `UNIT_LAYOUT` \| `BROCHURE` \| `PRICE_SHEET` \| `RERA_DOC` \| `APPROVAL_FILE` \| `COST_SHEET` \| `BOOKING_DOC` \| `PAYMENT_RECEIPT`), `title`, `fileName`, `mimeType`, `sizeBytes`, `storagePath`, `currentVersion`, `visibility` (`INTERNAL` \| `PARTNER` \| `CUSTOMER` \| `PUBLIC`), `watermarkEnabled`, `shareTokens` (`Array<{ tokenHash, expiresAt, createdByUid }>`), `uploadedByUid`, `updatedAt` | Enforces MIME & size limits, expiring share links, and audit tracking. |
| `floor_plan_versions` | `{floorPlanVersionId}` | `orgId`, `documentId`, `projectId`, `towerIds` (`string[]`), `floorCategory` (`TYPICAL` \| `PODIUM` \| `LOWER_RESIDENTIAL` \| `PENTHOUSE`), `minFloor`, `maxFloor`, `applicableUnitTypes` (`string[]`), `applicableBhk` (`string[]`), `carpetAreaSqft`, `saleableAreaSqft`, `versionNumber`, `storagePath`, `aiExtractedSpecs`, `createdAt` | Explicitly maps floor plans to tower + floor range + floor category + unit type. |

### E. CRM, Channel Partners, WhatsApp Inbox, Forms & Site Visits

| Collection | Doc ID Strategy | Key Fields | Isolation & Notes |
| :--- | :--- | :--- | :--- |
| `leads` | `{leadId}` | `orgId`, `customerName`, `phone`, `normalizedPhone`, `email`, `normalizedEmail`, `source` (`WEBSITE` \| `FACEBOOK_ADS` \| `INSTAGRAM_ADS` \| `INSTAGRAM_DM` \| `MESSENGER` \| `WHATSAPP` \| `GOOGLE_ADS` \| `CHANNEL_PARTNER` \| `CSV_IMPORT` \| `MANUAL` \| `WEBHOOK` \| `PUBLIC_PORTAL`), `campaign`, `budgetMin`, `budgetMax`, `preferredLocation`, `preferredProjectIds`, `bhkPreference`, `propertyType`, `buyingTimeline`, `assignedAgentUid`, `partnerOrgId`, `partnerAgentUid`, `protectionExpiresAt`, `stage` (`NEW` \| `CONTACTED` \| `QUALIFIED` \| `INTERESTED` \| `VISIT_SCHEDULED` \| `VISITED` \| `NEGOTIATION` \| `BOOKED` \| `CLOSED` \| `LOST` \| `UNQUALIFIED`), `lostReason`, `qualificationStatus`, `leadScore` (0–100), `duplicateOfLeadId`, `nextFollowUpAt`, `linkedQuotationIds`, `linkedBookingIds`, `whatsappOptIn`, `createdAt`, `updatedAt` | Indexed for Kanban stage views, agent queues, dedup lookup, and conversion reports. |
| `lead_activities` | `{activityId}` | `orgId`, `leadId`, `type` (`NOTE` \| `CALL` \| `TASK` \| `FOLLOW_UP` \| `STAGE_CHANGE` \| `ASSIGNMENT` \| `WHATSAPP` \| `VISIT` \| `QUOTATION` \| `AI_INSIGHT`), `title`, `body`, `dueAt`, `completedAt`, `performedByUid`, `metadata`, `createdAt` | Unified chronological timeline & task engine per lead. |
| `lead_registrations` | `{orgId}_{projectId}_{phoneHash}` | `orgId`, `projectId`, `leadId`, `partnerOrgId`, `partnerMemberUid`, `normalizedPhone`, `customerName`, `status` (`PROTECTED` \| `DISPUTED` \| `EXPIRED` \| `CONVERTED` \| `REJECTED`), `protectedUntil`, `conflictDetails`, `resolvedByUid`, `resolutionNotes`, `registeredAt` | Prevents duplicate registrations from overriding active lead ownership; surfaces disputed claims for manager resolution. |
| `conversations` | `{conversationId}` | `orgId`, `leadId`, `customerPhone`, `customerName`, `channel` (`WHATSAPP` \| `INSTAGRAM_DM` \| `MESSENGER`), `assignedAgentUid`, `status` (`OPEN` \| `PENDING_HANDOVER` \| `RESOLVED`), `lastCustomerMessageAt` (controls 24h Meta customer-service window), `optInStatus` (`OPTED_IN` \| `OPTED_OUT` \| `UNKNOWN`), `unreadCount`, `lastMessagePreview`, `updatedAt` | Enforces Meta 24-hour free-form reply window vs approved template requirement. |
| `messages` | `{messageId}` | `orgId`, `conversationId`, `leadId`, `direction` (`INBOUND` \| `OUTBOUND`), `messageType` (`TEXT` \| `TEMPLATE` \| `DOCUMENT` \| `IMAGE` \| `AI_DRAFT`), `content`, `templateName`, `mediaStoragePath`, `waMessageId`, `deliveryStatus` (`DRAFT_PENDING_APPROVAL` \| `QUEUED` \| `SENT` \| `DELIVERED` \| `READ` \| `FAILED`), `aiGenerated`, `approvedByUid`, `sentByUid`, `createdAt` | AI replies save as `DRAFT_PENDING_APPROVAL` by default unless explicit org auto-send setting & permission exist. |
| `site_visits` | `{visitId}` | `orgId`, `projectId`, `unitId` (nullable), `leadId`, `partnerOrgId` (nullable), `customerName`, `customerPhone`, `customerEmail`, `assignedAgentUid`, `scheduledStartAt` (ISO UTC), `scheduledEndAt`, `timezone` (default `Asia/Kolkata`), `status` (`SCHEDULED` \| `CONFIRMED` \| `RESCHEDULED` \| `COMPLETED` \| `NO_SHOW` \| `CANCELLED`), `outcome`, `notes`, `followUpAt`, `reminderJobKey` (idempotency token), `reminderSentAt`, `createdAt` | Timezone-aware with idempotent reminder tracking. |
| `forms` | `{formId}` | `orgId`, `projectId` (nullable), `name`, `slug`, `status` (`DRAFT` \| `PUBLISHED` \| `ARCHIVED`), `fields` (`FormFieldSchema[]` with conditional visibility rules), `branding` (`{ logoUrl, accentColor, headline, description }`), `consentText`, `successMessage`, `assignToAgentUid`, `rateLimitPerHour`, `honeypotEnabled`, `viewsCount`, `submissionsCount`, `createdAt` | Powers hosted `/f/{slug}`, iframe embed, and QR code lead capture. |
| `form_submissions` | `{submissionId}` | `orgId`, `formId`, `projectId`, `payload`, `consentAccepted`, `resultingLeadId`, `dedupMatched`, `ipHash`, `userAgent`, `submittedAt` | Persisted audit record of every form capture before/after lead normalization. |

### F. Bookings, Collections & Financial Reconciliation

| Collection | Doc ID Strategy | Key Fields | Isolation & Notes |
| :--- | :--- | :--- | :--- |
| `bookings` | `{bookingId}` | `orgId`, `bookingNumber`, `projectId`, `towerId`, `unitId`, `quotationId`, `leadId`, `partnerOrgId` (nullable), `customer` (KYC & co-applicant info), `allocatedParkingSlotIds`, `agreementValue`, `totalPayable`, `tokenAmountExpected`, `totalCollected`, `outstandingBalance`, `status` (`HOLD_REQUESTED` \| `PENDING_APPROVAL` \| `APPROVED` \| `BOOKED` \| `AGREEMENT_EXECUTED` \| `REGISTERED` \| `CANCELLED`), `cancellationReason`, `approvedByUid`, `bookedAt`, `createdAt` | Strictly separated from Bharat Makaan SaaS billing. |
| `collection_records` | `{collectionId}` | `orgId`, `bookingId`, `projectId`, `unitId`, `recordType` (`TOKEN` \| `MILESTONE_DEMAND` \| `RECEIPT` \| `PARTIAL_PAYMENT` \| `REFUND`), `milestoneSequence`, `milestoneName`, `demandAmount`, `paidAmount`, `allocatedAmount`, `paymentMode` (`RAZORPAY` \| `NEFT` \| `RTGS` \| `IMPS` \| `CHEQUE` \| `DD`), `instrumentRef`, `razorpayOrderId`, `razorpayPaymentId`, `razorpaySignatureVerified`, `receiptNumber`, `status` (`DUE` \| `PENDING_VERIFICATION` \| `VERIFIED` \| `BOUNCED` \| `REFUNDED`), `dueDate`, `paidAt`, `recordedByUid` | Never marked `VERIFIED` on Razorpay flows without server-side HMAC verification. |
| `reconciliation_records` | `{reconciliationId}` | `orgId`, `bookingId`, `collectionRecordId`, `bankStatementRef`, `settlementId`, `expectedAmount`, `settledAmount`, `feeAmount`, `discrepancyAmount`, `status` (`MATCHED` \| `DISCREPANCY` \| `RESOLVED`), `reconciledByUid`, `notes`, `reconciledAt` | Tracks finance team bank/gateway settlement verification. |

### G. Governance, Approvals, Integrations, AI, SaaS Billing & Audit

| Collection | Doc ID Strategy | Key Fields | Isolation & Notes |
| :--- | :--- | :--- | :--- |
| `approvals` | `{approvalId}` | `orgId`, `entityType` (`PRICE_BOOK` \| `QUOTATION_DISCOUNT` \| `BOOKING` \| `BOOKING_CANCELLATION` \| `INVENTORY_RELEASE`), `entityId`, `requestedByUid`, `requiredPermission`, `status` (`PENDING` \| `APPROVED` \| `REJECTED`), `requestSummary`, `payloadSnapshot`, `decidedByUid`, `decisionNotes`, `decidedAt`, `createdAt` | Centralized workflow queue for directors & managers. |
| `integrations` | `{integrationId}` | `orgId`, `provider` (`OPENAI` \| `WHATSAPP_CLOUD` \| `META_LEAD_ADS` \| `INSTAGRAM` \| `GOOGLE_ADS` \| `RAZORPAY_COLLECTIONS` \| `GOOGLE_MAPS` \| `EMAIL`), `status` (`NOT_CONFIGURED` \| `CONFIGURED_UNTESTED` \| `VERIFIED_ACTIVE` \| `ERROR`), `publicConfig` (non-secret IDs like `phoneNumberId`, `pageId`), `lastVerifiedAt`, `lastWebhookAt`, `lastError` | Never claims `VERIFIED_ACTIVE` unless tested with live credentials. |
| `subscriptions` | `{orgId}` | `orgId`, `planCode` (`STARTER` \| `GROWTH` \| `BUILDER_PRO` \| `ENTERPRISE`), `billingCycle` (`MONTHLY` \| `ANNUAL`), `basePriceInr`, `onboardingFeePaid`, `status` (`TRIAL` \| `ACTIVE` \| `PAST_DUE` \| `CANCELLED`), `entitlements` (`{ maxProjects, maxUsers, monthlyAiCredits, monthlyWhatsappQuota }`), `addons`, `currentPeriodStart`, `currentPeriodEnd`, `razorpaySubscriptionId` | Enforced server-side when creating projects, inviting users, or invoking AI/WA. |
| `invoices` | `{invoiceId}` | `orgId`, `invoiceNumber`, `subscriptionId`, `billingReason` (`SUBSCRIPTION` \| `ONBOARDING` \| `ADDON` \| `RENEWAL`), `subtotalInr`, `gstInr`, `totalInr`, `status` (`DRAFT` \| `ISSUED` \| `PAID` \| `VOID`), `razorpayOrderId`, `razorpayPaymentId`, `issuedAt`, `paidAt`, `pdfStoragePath` | Platform SaaS invoices (distinct from builder customer collections). |
| `ai_usage_logs` | `{logId}` | `orgId`, `uid`, `feature` (1 of 14 AI tasks), `model`, `promptVersion`, `inputTokens`, `outputTokens`, `estimatedCostUsd`, `creditsConsumed`, `entityType`, `entityId`, `latencyMs`, `status`, `createdAt` | Powers AI budget enforcement & Super Admin/Builder usage analytics. |
| `audit_events` | `{auditId}` | `orgId` (or `PLATFORM`), `actorUid`, `actorEmail`, `actorRole`, `action`, `category` (`PRICING` \| `INVENTORY` \| `PARKING` \| `DISCOUNT` \| `APPROVAL` \| `BOOKING` \| `PAYMENT` \| `DOCUMENT` \| `PERMISSION` \| `AUTH` \| `BILLING` \| `AI`), `entityType`, `entityId`, `summary`, `before` (sanitized), `after` (sanitized), `ipAddress`, `createdAt` | Strictly append-only (`allow update, delete: if false;` everywhere). |

---

## 3. Cloud Storage Bucket Layout

```text
gs://{bucket}/
├── organizations/{orgId}/
│   ├── branding/{filename}
│   ├── projects/{projectId}/
│   │   ├── media/{documentId}_v{ver}_{filename}
│   │   ├── floor-plans/{floorPlanVersionId}_{filename}
│   │   └── documents/{documentId}_v{ver}_{filename}
│   ├── quotations/{quotationId}/v{ver}/quotation_{quotationNumber}.pdf
│   ├── bookings/{bookingId}/{documentId}_{filename}
│   └── receipts/{collectionId}/receipt_{receiptNumber}.pdf
└── public-listings/{orgId}/{projectId}/{filename}
```
Storage rules validate `request.auth != null`, organization membership, role permission, and strict content-type (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`) + size limits (25 MB docs, 10 MB images).
