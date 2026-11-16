# Bharat Makaan Enterprise — Master Implementation Plan

## 1. Executive Architecture Summary

**Bharat Makaan** is an AI-powered, multi-tenant enterprise real estate management SaaS platform and public property discovery portal built for builders, developers, project sales teams, channel partners, and property buyers across India.

The platform comprises two connected products sharing a single authoritative Firebase backend and domain layer:
1. **Enterprise Real Estate Management Platform** (Web & React Native Mobile): Multi-builder organization isolation, RBAC with granular permission matrices, hierarchical project/phase/tower/floor/unit visual inventory, independent physical parking inventory, dynamic versioned price books with editable cost-sheet labels, deterministic cost-sheet & Construction-Linked Payment (CLP) engine with AI-assisted descriptions & PDF generation, document & floor-plan management, channel partner portal with lead-protection rules, omnichannel CRM & Meta WhatsApp Cloud API shared inbox, universal lead capture & drag-and-drop form builder, site visit scheduling, transactional bookings & collections with Razorpay verification, reports & immutable audit trails, Super Admin console, and SaaS subscription billing.
2. **Public Property Portal** (Web): SEO-friendly discovery experience for buyers to search Buy/Rent listings and verified builder projects, compare properties side-by-side using real published inventory & pricing rules, enquire, and book site visits.

---

## 2. Monorepo Structure

```text
bharat-makaan/
├── apps/
│   ├── web/                          # Vite + React + TypeScript + Tailwind CSS v4 + shadcn/ui
│   │   ├── public/                   # Static assets, robots.txt, sitemap endpoint config
│   │   └── src/
│   │       ├── app/                  # Router, providers, auth/permission guards, layouts
│   │       ├── components/
│   │       │   ├── ui/               # Centralized shadcn/ui + Radix primitives
│   │       │   ├── shared/           # EmptyState, DataTable, PageHeader, ConfirmDialog, StatMetric, AuditTimeline
│   │       │   └── layout/           # EnterpriseShell (12 nav items), PublicShell, SuperAdminShell, PartnerShell
│   │       ├── features/
│   │       │   ├── auth/             # Sign-in, Register, MFA enrollment/challenge, Org switcher
│   │       │   ├── dashboard/        # Real-time builder & project KPIs, tasks, funnel analytics
│   │       │   ├── organizations/    # Staff invitations, roles, permission editor, org membership
│   │       │   ├── projects/         # Project hierarchy CRUD, phases, towers, floors, RERA, team
│   │       │   ├── inventory/        # Visual tower/floor matrix, filters, unit drawer, status holds
│   │       │   ├── parking/          # Basement/podium zones, slot inventory, entitlement vs allocation, swap
│   │       │   ├── pricing/          # Dynamic price books, custom charge labels, approvals, version diff/chart
│   │       │   ├── quotations/       # 15-step cost sheet builder, CLP editor, PDF generator, AI copy helper
│   │       │   ├── leads/            # Kanban + TanStack Table CRM, scoring, dedup, bulk assign, CSV I/O
│   │       │   ├── whatsapp/         # Meta Cloud API shared inbox, 24h window guard, templates, AI drafts
│   │       │   ├── channel-partners/ # Partner orgs, RERA, commissions, lead registration & conflict resolution
│   │       │   ├── visits/           # Calendar & list views, timezone-aware booking, outcomes, reminders
│   │       │   ├── bookings/         # Transactional holds -> bookings, milestones, collections, ledger, Razorpay
│   │       │   ├── documents/        # Floor plan mapping (tower/floor-range/unit-type), versioning, expiring links
│   │       │   ├── forms/            # Drag-and-drop form builder, conditional rules, embed/QR, public renderer
│   │       │   ├── reports/          # 16 report views + immutable audit log explorer + AI NL reports
│   │       │   ├── settings/         # Org profile, integrations status, lead-protection policy, billing, MFA
│   │       │   ├── admin/            # Platform Super Admin console, SaaS plans, tenants, AI/WA quotas, health
│   │       │   └── public-portal/    # Homepage, Buy, Rent, Projects, Details, Compare, Enquire, Pricing, About
│   │       ├── lib/                  # Firebase client SDK, callable function client, query keys, SEO utils
│   │       ├── state/                # Zustand stores (active org/project context, UI drawers, compare tray)
│   │       └── styles/
│   │           └── globals.css       # Single source of truth: Tailwind v4 @theme, CSS tokens, light/dark modes
│   └── mobile/                       # React Native + Expo + TypeScript + NativeWind + React Navigation
│       ├── app.json
│       ├── App.tsx
│       └── src/
│           ├── components/           # Native accessible primitives (Button, Card, Input, Badge, EmptyState)
│           ├── navigation/           # 5 Bottom Tabs (Dashboard, Inventory, Leads, Inbox, More) + Auth Stack
│           ├── screens/              # Role-aware screens synced with shared Firebase backend
│           ├── services/             # Firebase Auth with SecureStore persistence, FCM push notifications, media picker
│           └── state/                # Zustand mobile session & org context store
├── functions/                        # Firebase Cloud Functions v2 (TypeScript, Node 22, Firebase Admin)
│   └── src/
│       ├── index.ts                  # Exported HTTPS callables, webhooks, triggers, scheduled jobs
│       ├── shared/                   # Auth/RBAC middleware, tenant guard, rate limiter, error handler
│       ├── auth/                     # User bootstrap, custom claims sync, invite acceptance, MFA policy check
│       ├── organizations/            # Org creation, member management, lead transfer, suspension
│       ├── projects/                 # Project/phase/tower/floor CRUD, aggregate counter maintenance
│       ├── inventory/                # Unit CRUD, bulk generator, transactional status machine, hold expiry job
│       ├── parking/                  # Slot CRUD, transactional allocation, release, swap
│       ├── pricing/                  # Price book drafts, rule evaluation, approval lock, immutable versioning
│       ├── quotations/               # Deterministic cost-sheet compute, CLP validation, PDF generation, sharing
│       ├── bookings/                 # Hold-to-booking transaction, cancellation & authorized inventory release
│       ├── collections/              # Milestone demands, Razorpay order/webhook verification, receipts, ledger
│       ├── leads/                    # Ingestion pipeline (capture->dedup->assign->score), activities, bulk ops
│       ├── whatsapp/                 # Meta Cloud API webhook (GET verify + POST HMAC), outbound sender, templates
│       ├── integrations/             # Meta Lead Ads, Instagram/Messenger, Google Ads webhook, Razorpay SaaS billing
│       ├── ai/                       # Official OpenAI SDK service, 14 structured-output tools, token/budget guard
│       ├── channel-partners/         # Partner onboarding, builder scoping, lead registration & protection check
│       ├── approvals/                # Unified approval engine (price books, discounts, bookings, cancellations)
│       ├── documents/                # Upload validation, version replacement, signed/expiring share links
│       ├── notifications/            # FCM push dispatcher, configurable transactional email, visit reminder cron
│       └── audit/                    # Append-only audit writer & query helpers
├── packages/
│   ├── shared/                       # Domain interfaces, RBAC permissions, state machines, deterministic math engine
│   ├── validation/                   # Shared Zod schemas for every entity, form, callable payload, and webhook
│   └── config/                       # Design system tokens (colors, spacing, typography), SaaS plan defaults, TS configs
├── firebase/
│   ├── firestore.rules               # Strict multi-tenant isolation, permission checks, server-only write locks
│   ├── firestore.indexes.json        # Compound indexes for cursor pagination & multi-field enterprise filters
│   └── storage.rules                 # Organization & visibility-scoped Cloud Storage rules with size/MIME checks
├── docs/                             # Architecture, data model, page inventory, API/integrations, progress, QA reports
├── scripts/                          # Server-side Super Admin provisioning (`prateek.parts@gmail.com`), sitemap builder
├── tests/                            # Unit, deterministic pricing/C-704 regression, RBAC, and Firebase Emulator suites
├── firebase.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 3. Core Architectural Principles

1. **Zero Dummy Data Policy**: Production collections start completely empty. Dashboards, charts, Kanban boards, inventory grids, and public portal listings query live Firestore documents and render contextual, actionable empty states when zero records exist. Realistic fixtures live strictly inside `tests/`.
2. **Deterministic Financial Engine**: Monetary computations (per-sq.-ft. rates, floor-rise thresholds, premiums, custom charges, Indian GST slabs, CGST nearest-rupee or exact paise rounding, discounts, and Construction-Linked Payment schedules) execute strictly through pure deterministic functions in `@bharat-makaan/shared` and verified server-side in `functions/src/pricing` & `functions/src/quotations`. OpenAI is never used for arithmetic.
3. **Transactional Concurrency Control**: Unit holds/reservations/bookings and physical parking allocations execute exclusively inside Firestore server-side transactions (`db.runTransaction`), preventing double-booking or conflicting slot assignments under concurrent load.
4. **Permission-First Multi-Tenancy**: Every user membership stores explicit role + granular permission overrides (`PermissionKey[]`) and optional project/department scoping. Both Firestore Security Rules and Cloud Functions enforce organization membership, active account status, and specific permission keys.
5. **Honest External Integrations**: OpenAI, Meta WhatsApp Cloud API, Meta/Instagram Lead Ads, Google Ads Webhooks, Razorpay, Google Maps, and Email providers are built against their real official SDKs/HTTP specs with HMAC signature verification, environment/secret configuration, and live connection health checks—reporting `"Not Configured"` or exact credential blockers until real API keys are supplied.

---

## 4. Phased Execution Roadmap

| Phase | Milestone | Key Deliverables & Validation Gate |
| :--- | :--- | :--- |
| **Phase 1** | Foundation | Monorepo (`pnpm`), `@bharat-makaan/{config,shared,validation}`, `globals.css` (Tailwind v4 + tokens), shadcn/ui primitives, 12-item Web Shell, Auth + MFA support, Org & RBAC engine, Super Admin bootstrap script (`prateek.parts@gmail.com`), base Firestore/Storage rules, Phase 1 tests. |
| **Phase 2** | Enterprise Core | Projects, phases, towers/blocks, floors, plotted/villa support, units CRUD + bulk wizard, interactive visual inventory matrix with rich filters, unit detail drawer, transactional status workflow, physical parking inventory (entitlement vs slot allocation/swap), Phase 2 tests. |
| **Phase 3** | Dynamic Pricing | Versioned price books, editable cost-sheet line-item labels with stable internal keys, custom charge builder, approval lock, immutable snapshots, unit price impact preview, historical revision table & Recharts comparison chart, Phase 3 tests. |
| **Phase 4** | Quotations & Documents | 15-step AI-assisted cost sheet generator, CLP & date-linked payment plan editor (100% reconciliation), C-704 ₹3,92,73,985 regression test, authoritative PDF generation, Document & Floor Plan manager (tower/floor-range/unit-type mapping, versioning, expiring links), Phase 4 tests. |
| **Phase 5** | Sales Operations | Full Lead CRM (Table + Kanban, scoring, duplicate detection, bulk assign, CSV import/export), Channel Partner portal (RERA, commissions, lead-protection & dispute workflow), Meta WhatsApp Cloud API shared inbox (24h window, templates, human-approved AI replies), Site Visit calendar/list & reminders, Phase 5 tests. |
| **Phase 6** | Booking & Finance | Controlled hold-to-booking workflow, quotation & customer linking, approval gates, token recording, milestone demand generation, receipts, partial payments, allocations, refunds, customer ledger, Razorpay order + webhook signature verification, Phase 6 tests. |
| **Phase 7** | Lead Capture & AI | Visual drag-and-drop Form Builder (conditional logic, QR code, iframe embed, hosted URL, spam protection), Universal Lead Ingestion pipeline (Meta, Instagram, Google Ads, Webhooks), Centralized OpenAI service covering all 14 enterprise AI capabilities with token/budget tracking, Phase 7 tests. |
| **Phase 8** | Public Property Portal | Homepage (`Find Your Next Property. Manage Real Estate with AI.`), Buy, Rent, Projects, Project/Property Details, real-data Property Comparison matrix, Site Visit & Builder enquiry forms, For Professionals, SaaS Pricing, About, Contact, SEO metadata + canonicals + sitemap, Phase 8 tests. |
| **Phase 9** | Mobile Application | Expo + React Native + NativeWind app sharing `@bharat-makaan/{shared,validation}`, 5 bottom tabs (`Dashboard`, `Inventory`, `Leads`, `Inbox`, `More`), role-gated workflows, SecureStore session, native file/image picker, push notifications, web/mobile sync tests. |
| **Phase 10** | Admin, QA & Deployment | Platform Super Admin console, SaaS subscription billing (Starter ₹2,999, Growth ₹9,999, Builder Pro ₹24,999, Enterprise Custom + add-ons), 16 Reports & immutable Audit Explorer, full TypeScript/lint/unit/emulator test run, production build verification, complete documentation suite. |
