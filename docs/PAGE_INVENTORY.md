# Bharat Makaan Enterprise — Complete Page & Screen Inventory

## 1. Enterprise Web Application (`/app/*`)

Primary Sidebar Navigation contains **strictly 12 non-duplicated items** (grouped logically into *Overview*, *Inventory & Pricing*, *Sales & CRM*, *Finance & Docs*, and *Governance*):

| # | Primary Nav Item | Route(s) | Key Sub-views / Drawers / Modals | Required Permission | Empty State Copy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Dashboard** | `/app/dashboard` | Builder KPI summary, Project switcher, Sales & Collections overview, Pending Approvals queue, Upcoming Site Visits & Tasks | `dashboard:view` | `"No projects yet. Create your first project."` |
| 2 | **Projects & Inventory** | `/app/projects`, `/app/projects/:projectId`, `/app/inventory` | Create/Edit Project modal, Phase/Tower/Floor hierarchy builder, Plotted/Villa setup, Visual Tower/Floor Unit Grid, Multi-criteria Filter Bar (BHK, area, facing, status, price), Unit Detail Drawer (floor plan, hold/reserve, price breakdown, audit timeline), Bulk Unit Generator | `projects:view` / `inventory:view` | `"No projects yet. Create your first project."` / `"No units added. Import or create inventory."` |
| 3 | **Parking** | `/app/parking` | Basement/Podium/Zone visual slot matrix, Add Slots wizard, Entitlement vs Physical Allocation ledger, Allocate/Release/Swap Slot transactional modal, Slot history drawer | `parking:view` | `"No parking slots configured. Create basement, podium or surface slots."` |
| 4 | **Pricing & Cost Sheets** | `/app/pricing`, `/app/quotations`, `/app/quotations/new` | Dynamic Price Book Editor (editable labels + stable keys, custom charges, tax rules), Approval submission, Version Diff & Recharts Price History curve, CLP Payment Plan manager, 15-Step AI-Assisted Cost Sheet Generator, PDF Preview & Share modal | `pricing:view` / `quotations:view` | `"No approved price book. Create your pricing rules."` |
| 5 | **Leads & CRM** | `/app/leads`, `/app/leads/:leadId`, `/app/forms` | TanStack Table view, Drag-and-drop Kanban pipeline, Lead Detail 360° workspace (notes, tasks, follow-ups, AI qualification, property matcher), Duplicate resolver, CSV Import/Export, Bulk Assign, Visual Drag-and-Drop Lead Form Builder (QR + Embed) | `leads:view` | `"No leads received yet. Connect a lead source or create a form."` |
| 6 | **WhatsApp Inbox** | `/app/inbox` | Shared multi-agent conversation list, 24-hour Meta service window indicator, Message composer, Approved Templates selector, AI Reply Draft card (human-approval gate), Brochure/Cost-sheet attachment sender, Opt-in/Opt-out status | `whatsapp:view` | `"No WhatsApp account connected."` / `"No conversations yet."` |
| 7 | **Channel Partners** | `/app/channel-partners` | Partner directory, Onboard Partner modal, Multi-builder Project Scope & Commission editor, Lead Registration log, Lead-Protection Conflict Resolution queue, Partner performance & commission eligibility | `partners:view` | `"No channel partners onboarded yet. Invite or register a partner agency."` |
| 8 | **Site Visits** | `/app/visits` | Interactive Month/Week Calendar view, Filterable List view, Schedule Visit modal (timezone-aware), Agent assignment, Reschedule/Cancel/Outcome logger, Idempotent WhatsApp reminder trigger | `visits:view` | `"No site visits scheduled yet. Book a customer visit to get started."` |
| 9 | **Bookings & Collections** | `/app/bookings`, `/app/bookings/:bookingId` | Hold-to-Booking wizard (links approved quotation + customer KYC), Director Approval queue, Milestone Demand generator, Record Receipt / Razorpay Checkout link, Partial payment allocator, Refunds, Bank Reconciliation tab, Customer Ledger | `bookings:view` / `collections:view` | `"No active bookings yet. Convert a unit hold or approved quotation into a booking."` |
| 10 | **Documents** | `/app/documents` | Categorized repository (Master/Tower/Floor Plans, Brochures, RERA, Approvals, Cost Sheets, Receipts), Floor Plan Mapper (Tower + Floor Category + Floor Range + Unit Type), Version uploader, Preview modal, Expiring Share Link & Watermark config | `documents:view` | `"No documents uploaded yet. Upload floor plans, RERA certificates or brochures."` |
| 11 | **Reports & Audit** | `/app/reports` | 16 specialized report tabs (Project, Inventory, Price Changes, Pipeline, Sources, Agents, Partners, Visits, Quotations, Discounts, Bookings, Collections, Outstanding, Conversion, AI Usage, WhatsApp), AI Natural-Language Report runner, Immutable Audit Trail Explorer (before/after diff) | `reports:view` / `audit:view` | `"No operational records available for the selected filters."` |
| 12 | **Settings** | `/app/settings` | Consolidated tabbed workspace (Organization Profile, Team & Role Permissions, Approvals & Lead Protection Rules, Integrations & Webhooks, SaaS Subscription & Invoices, Security & MFA) — zero duplicate sidebar settings items | `settings:view` | Contextual per-tab state |

---

## 2. Dedicated Role Workspaces (Web)

| Workspace | Route Prefix | Target Roles | Capabilities |
| :--- | :--- | :--- | :--- |
| **Channel Partner Portal** | `/partner/*` | `CHANNEL_PARTNER_ADMIN`, `CHANNEL_PARTNER_AGENT` | Permitted builder/project switcher, Live authorized inventory & floor plans, Authorized cost-sheet generator, Discount request, Protected lead registration, Site visit booking, Booking & Commission tracker, Partner team management. |
| **Platform Super Admin Console** | `/super-admin/*` | `PLATFORM_SUPER_ADMIN` | Builder tenant management, SaaS plan & pricing editor (Starter/Growth/Builder Pro/Enterprise), Subscriptions & invoices monitor, Global users & MFA status, Platform integrations, AI & WhatsApp quota/cost telemetry, System health, Support requests, Global audit log. |
| **Hosted Lead Capture Form** | `/f/:formSlug` | Public / Unauthenticated | Branded custom lead form rendered from `forms` schema with conditional logic, consent checkbox, honeypot/rate-limit protection, and direct Firestore ingestion. |
| **Secure Shared Document View** | `/share/doc/:token` | External / Token-verified | Expiring token verification, optional watermark overlay, audit event recording. |

---

## 3. Public Property Portal (`/`)

All 13 required public routes with crawlable SEO metadata, canonical tags, OpenGraph tags, and JSON-LD structured data:

| # | Page | Route | Functional Scope |
| :--- | :--- | :--- | :--- |
| 1 | **Homepage** | `/` | Hero (`"Find Your Next Property. Manage Real Estate with AI."`), CTAs (`Explore Properties`, `Manage with AI`), Buy/Rent + City + Location + Type + Budget + BHK search bar, Featured verified projects (or honest empty state), Platform value pillars. |
| 2 | **Buy Properties** | `/buy` | Live filterable catalog of approved `BUY` units & projects (`isPublicPublished == true`). |
| 3 | **Rent Properties** | `/rent` | Live filterable catalog of approved `RENT` units (`isPublicPublished == true`). |
| 4 | **Projects Directory** | `/projects` | Verified builder projects with RERA badges, configurations, possession timeline, and city filters. |
| 5 | **Project Details** | `/projects/:projectId` | Master plan, towers, RERA verification, amenities, approved floor plans, available unit summary, enquire & book visit forms. |
| 6 | **Property Details** | `/properties/:unitId` | Unit specs, carpet/saleable area, facing, parking entitlement, floor plan preview, transparent estimated purchase cost from active price book, schedule visit CTA. |
| 7 | **Property Comparison** | `/compare` | Side-by-side matrix comparing up to 4 real published properties across Price, Area, Location, Builder, BHK, Facing, Parking, Amenities, Possession, Floor Plans, and Total Estimated Purchase Cost. |
| 8 | **Book Site Visit** | `/book-visit` | Public timezone-aware site visit request form persisted directly to builder's `site_visits` & `leads` pipeline. |
| 9 | **Contact Builder** | `/contact-builder/:orgId` | Direct verified builder enquiry routed into the builder's CRM with source attribution. |
| 10 | **For Professionals** | `/for-professionals` | Enterprise platform overview for Builders, Sales Teams, and Channel Partners with onboarding CTA. |
| 11 | **SaaS Pricing** | `/pricing` | Live plan tiers (Starter ₹2,999/mo, Growth ₹9,999/mo, Builder Pro ₹24,999/mo, Enterprise Custom), annual toggle, add-ons, FAQ. |
| 12 | **About** | `/about` | Bharat Makaan mission, compliance, data security, and multi-stakeholder ecosystem. |
| 13 | **Contact** | `/contact` | Platform sales & support request form persisted to platform support queue. |
| 14 | **Sign In / Register** | `/auth/login`, `/auth/register`, `/auth/mfa` | Unified authentication, Builder/Partner organization onboarding, and privileged MFA verification. |

---

## 4. React Native Mobile Application (`apps/mobile`)

Strictly **5 Bottom Tabs** with role-gated screens and shared backend persistence:

1. **Dashboard Tab**: Active org/project switcher, real-time unit availability summary, today's site visits, follow-up tasks, pending approvals (for managers/directors).
2. **Inventory Tab**: Project → Tower → Floor selector, color-coded unit grid, BHK/status/price filters, Unit Detail sheet, request hold, share unit/floor plan.
3. **Leads Tab**: Pipeline filter pills, search, Lead Detail view, quick call/WhatsApp launch, add activity/note, schedule follow-up, register partner lead.
4. **Inbox Tab**: Live WhatsApp conversation threads, 24h service window status, template/text reply, AI draft approval, share brochure/cost sheet.
5. **More Tab**: Role-authorized menu navigating to:
   - *Pricing & Quotations* (generate & share cost sheet)
   - *Site Visits* (calendar agenda, check-in, log outcome)
   - *Channel Partners* (partner status, registrations, commissions)
   - *Bookings & Collections* (booking status, customer ledger)
   - *Documents* (upload via native camera/document picker, view/share floor plans)
   - *Reports* (mobile KPI snapshot)
   - *Settings* (profile, push notifications toggle, organization switch, sign out)
