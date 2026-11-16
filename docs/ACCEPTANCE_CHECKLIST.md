# Bharat Makaan Enterprise — Development & Acceptance Checklist

Every milestone and feature is evaluated against Section 25 (Definition of Done):
> UI implemented → Forms validate (Zod) → Backend operations work → Data persists in Firestore/Storage → Permissions enforced (Client + Rules + Cloud Functions) → Loading & empty/error states work → Web & Mobile sync → Automated tests pass → Documented.

---

## Pre-Coding Architecture Deliverables
- [x] Master Implementation Plan (`docs/IMPLEMENTATION_PLAN.md`)
- [x] Package & Module Dependency Map (`docs/DEPENDENCY_MAP.md`)
- [x] Firestore 36-Entity Data Model & Storage Layout (`docs/DATA_MODEL.md`)
- [x] Complete Web, Portal, Partner, Admin & Mobile Page Inventory (`docs/PAGE_INVENTORY.md`)
- [x] Development & Acceptance Checklist (`docs/ACCEPTANCE_CHECKLIST.md`)
- [x] Live Progress Log (`docs/PROGRESS.md`)

---

## Phase 1 — Foundation
- [x] Clean monorepo (`pnpm-workspace.yaml`, `apps/web`, `apps/mobile`, `functions`, `packages/shared`, `packages/validation`, `packages/config`, `firebase`, `scripts`, `tests`)
- [x] `apps/web/src/styles/globals.css` with Tailwind CSS v4 `@import "tailwindcss"`, `@theme`, deep navy / soft ivory / charcoal design tokens, light & dark themes, focus/accessibility rules
- [x] Reusable shadcn/ui & Radix primitives styled via central CSS variables
- [x] Web Enterprise Layout with strictly 12 non-duplicated primary navigation items
- [x] Firebase Authentication + MFA support + Organization Switcher
- [x] 13 Roles + granular permission engine (`@bharat-makaan/shared`)
- [x] Staff invitation, project/department/manager assignment, suspension, revocation, lead transfer
- [x] Server-side Super Admin provisioning script (`scripts/provision-super-admin.ts` for `prateek.parts@gmail.com` with strong env/prompted password & `requireMfa: true`)
- [x] Multi-tenant `firestore.rules` & `storage.rules` foundation
- [x] Automated tests: Org creation, staff invitations, multi-tenant RBAC isolation

---

## Phase 2 — Enterprise Core (Projects, Visual Inventory & Parking)
- [x] Project CRUD with RERA, location/coordinates, configurations, amenities, possession, team, plotted/villa optional hierarchy support
- [x] Phase, Tower/Block, and Floor (with `floorCategory`) CRUD
- [x] Database-driven Project Dashboard (zero fake numbers; clean empty states)
- [x] Interactive Visual Inventory matrix (filter by BHK, area, facing, status, price; search by unit number)
- [x] Unit Detail drawer (linked floor plan, calculated price, hold/reserve actions, audit history)
- [x] Transactional status state machine (`Available → On Hold → Reserved → Booked → Agreement → Registered` + authorized release/cancel/expiry)
- [x] Physical Parking inventory (basement/podium/zone, 5 slot types, entitlement vs physical allocation, transactional allocate/release/swap)
- [x] Automated tests: Project/tower/floor/unit creation, status transitions, concurrent reservation conflict prevention, parking conflict prevention

---

## Phase 3 — Dynamic Pricing Engine
- [x] Price Book CRUD (draft, edit, impact preview, submit for approval, approve/reject, schedule, activate, archive, clone)
- [x] Editable cost-sheet line-item display labels with stable `internalKey` identifiers (zero user-text eval)
- [x] Custom charges (fixed, per-sq.-ft., percentage, tax category, unit-type scoping, show/hide, display order)
- [x] Immutability lock on approved price books + frozen snapshots for issued quotations
- [x] Price Revision tracking, comparison view, and Recharts historical price chart
- [x] Automated tests: Price book editing, custom labels, approval & immutability, historical price preservation

---

## Phase 4 — AI-Assisted Cost Sheet Generator & Documents
- [x] 15-step Cost Sheet builder (Builder → Project → Tower → Floor → Unit → Price Book → Parking → CLP Plan → Discounts → Taxes → Preview → Approval → Versioned PDF → Share → History)
- [x] Construction-Linked & Date-Linked Payment Plan manager with 100% reconciliation check
- [x] Authoritative backend & client PDF generation with full statutory & schedule breakdown
- [x] C-704 reference total regression test (`₹3,92,73,985`)
- [x] Document & Floor Plan repository (11 categories, upload/preview/download/rename/versioning, tower + floor-range + floor-category + unit-type mapping, expiring links, watermarks, audit trail)
- [x] Automated tests: Deterministic cost sheet math, tax/rounding rules, CLP milestone totals, C-704 ₹3,92,73,985 test, PDF generation

---

## Phase 5 — Sales Operations (CRM, Channel Partners, WhatsApp, Site Visits)
- [x] Lead CRM (TanStack Table + Kanban pipeline, advanced filters, bulk assignment, notes, tasks, follow-ups, scoring, duplicate detection, CSV import/export, conversion stats)
- [x] Channel Partner Portal (`/partner/*` — RERA, multi-builder project scopes, commissions, authorized inventory/cost sheets, lead registration, configurable lead-protection & conflict resolution)
- [x] Official Meta WhatsApp Cloud API integration (webhook verification + HMAC check, shared inbox, 24h customer-service window enforcement, approved templates, human-gated AI drafts, opt-in/opt-out, brochure/cost-sheet sharing)
- [x] Site Visit scheduling (Calendar + List views, timezone-aware UTC storage, confirmation/reschedule/cancel/outcome, idempotent reminder job)
- [x] Automated tests: Partner lead registration, duplicate/lead-protection conflict handling, site visit scheduling, WhatsApp webhook verification

---

## Phase 6 — Bookings, Payments & Collections
- [x] Controlled Hold → Booking workflow linking approved quotation & customer KYC with manager approval gate
- [x] Token recording, booking confirmation, cancellation & authorized inventory/parking release
- [x] Milestone demands, receipts, partial payments, allocations, refunds, bank reconciliation, customer ledger
- [x] Strict separation between Builder Customer Collections and Bharat Makaan SaaS Billing
- [x] Razorpay order creation & HMAC-SHA256 webhook signature verification (never trusting frontend status alone)
- [x] Automated tests: Booking state transitions, concurrent booking lock, payment allocation & webhook signature reconciliation

---

## Phase 7 — Universal Lead Capture, Form Builder & OpenAI Service
- [x] Drag-and-drop Form Builder (12+ field types, conditional logic, consent checkbox, branding, hosted `/f/:slug`, iframe embed, QR code, analytics, honeypot/rate-limit protection)
- [x] Universal Lead Ingestion pipeline (`Capture → Validate → Normalize → Deduplicate → Attribute → Assign → Qualify → Follow Up`) with Meta Lead Ads, Instagram, Google Ads & authenticated webhooks
- [x] Centralized OpenAI backend service (`functions/src/ai`) implementing all 14 enterprise AI tasks with structured Zod outputs, prompt versioning, token/cost logging, budget caps, and zero hallucinated financials
- [x] Automated tests: Public form submission & spam guard, lead ingestion deduplication, AI service structured output & budget guard

---

## Phase 8 — Public Property Portal
- [x] Homepage with exact required hero headline, subheadline, CTAs, and Buy/Rent search bar
- [x] All 13+ public pages (`/`, `/buy`, `/rent`, `/projects`, `/projects/:id`, `/properties/:id`, `/compare`, `/book-visit`, `/contact-builder/:orgId`, `/for-professionals`, `/pricing`, `/about`, `/contact`, `/auth/*`)
- [x] Strict `isPublicPublished == true` filtering (only approved listings appear)
- [x] Real-data Property Comparison matrix including total estimated purchase cost
- [x] SEO metadata, canonical URLs, OpenGraph, JSON-LD, `robots.txt`, and sitemap generator

---

## Phase 9 — Mobile Application (React Native + Expo)
- [x] Expo + TypeScript + NativeWind + React Navigation app with 5 bottom tabs (`Dashboard`, `Inventory`, `Leads`, `Inbox`, `More`)
- [x] Shared `@bharat-makaan/shared` & `@bharat-makaan/validation` domain & schema reuse
- [x] Secure session persistence (`expo-secure-store`), native image/document picking, FCM push registration
- [x] Role-gated screens synced live with web via shared Firestore & Cloud Functions
- [x] Automated tests: Cross-platform state/schema parity & mobile/web data synchronization

---

## Phase 10 — Super Admin, SaaS Billing, Reports, QA & Deployment
- [x] Super Admin console (`/super-admin/*` — builders, plans, users, integrations, AI/WA telemetry, health, support, audit)
- [x] SaaS Subscription Billing (Starter ₹2,999, Growth ₹9,999, Builder Pro ₹24,999, Enterprise Custom, annual/monthly, onboarding fee, add-ons, Razorpay webhook verification, backend entitlement enforcement, mobile app-store billing compliance guard)
- [x] 16 Reporting dashboards + immutable Audit Trail Explorer
- [x] Full TypeScript check, ESLint, Vitest unit + emulator integration tests, production Vite & Functions builds
- [x] Complete documentation (`README.md`, `docs/SETUP_GUIDE.md`, `docs/API_AND_INTEGRATIONS.md`, `docs/FEATURE_COVERAGE.md`, `docs/KNOWN_LIMITATIONS.md`)
