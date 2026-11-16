# Bharat Makaan — Global Multi-Project Architecture Audit

## 1. Executive Summary

An exhaustive code, schema, security-rule, and UI audit was conducted across the existing Bharat Makaan monorepo (`packages/*`, `functions/*`, `apps/web/*`, `apps/mobile/*`, and `firebase/*`).

While the foundational platform already enforces `orgId` multi-tenancy, 13 RBAC roles, transactional inventory/parking locks, and zero dummy production records, several **India-specific defaults, single-project UI fallbacks, flat project-only pricing assumptions, and static quotation layout couplings** must be upgraded so Bharat Makaan operates as a truly **global, multi-country, multi-organization (builders + agencies), multi-project SaaS platform**.

---

## 2. Identified Single-Project, Regional & Template Assumptions

### Finding 1 — Single-Project UI Fallback Overriding "All Projects" Mode
- **Locations**:
  - `apps/web/src/state/useTenantStore.ts` (`setProjects` auto-selected `projects[0].id` even when `activeProjectId` was `null`)
  - `apps/web/src/features/inventory/pages/ProjectsAndInventoryPage.tsx` (`activeProjectId ?? projects[0]?.id`)
  - `apps/web/src/features/parking/pages/ParkingPage.tsx` (`activeProjectId ?? projects[0]?.id`)
  - `apps/web/src/features/pricing/pages/PricingAndCostSheetsPage.tsx` (`activeProjectId ?? projects[0]?.id`)
  - `apps/web/src/features/bookings/pages/BookingsAndCollectionsPage.tsx` (`activeProjectId ?? projects[0]?.id`)
  - `apps/web/src/features/documents/pages/DocumentsPage.tsx` (`activeProjectId ?? projects[0]?.id`)
  - `apps/mobile/src/state/useMobileStore.ts` & `InventoryScreen.tsx`
- **Impact**: Selecting "All Organization Projects" in the header still silently scoped screens to `projects[0]`, and there was no dedicated **Portfolio Overview** mode alongside **All Projects** and **Single Project**.
- **Correction**: Introduce explicit `projectScopeMode: 'ALL_PROJECTS' | 'PORTFOLIO_OVERVIEW' | 'SINGLE_PROJECT'` persisted per organization in session state (validated against authorized `assignedProjectIds`), and update every connected screen + backend query to honor authorized multi-project aggregation vs single-project isolation.

### Finding 2 — Hardcoded Sample Placeholders (`C-704`, `Tower C`, `7th Floor`) in UI Forms
- **Locations**:
  - `apps/web/src/features/inventory/pages/ProjectsAndInventoryPage.tsx` (`useState('Tower C')`, `placeholder="Unit # (e.g. C-704)"`)
  - `apps/web/src/features/documents/pages/DocumentsPage.tsx` (`placeholder="Tower C Typical 3rd–14th Floor Plan"`)
  - `apps/web/src/features/quotations/components/CostSheetGeneratorPanel.tsx` (`7th Floor Superstructure Slab` in default milestone array)
  - `apps/mobile/src/screens/InventoryScreen.tsx` (`placeholder="Search by Unit # or BHK (e.g. C-704, 3 BHK)"`)
- **Correction**: Remove all `C-704` / `Tower C` / `7th Floor` UI defaults and placeholders. Retain `C-704` strictly as an isolated test fixture in `tests/src/phase4-quotations-documents.test.ts`.

### Finding 3 — India-Only Currency (`INR`), Area (`sq. ft.`), Tax (`GST` / `GSTIN` / `PAN`), Regulatory (`RERA`), and Timezone (`Asia/Kolkata`) Couplings
- **Locations**:
  - `packages/config/src/index.ts` (`defaultTimezone: 'Asia/Kolkata'`, `defaultCurrency: 'INR'`)
  - `packages/shared/src/entities.ts` & `pricing-engine.ts` (`AGREEMENT_GST`, `OTHER_SERVICE_GST`, `EXEMPT_CORPUS`, `*Inr` field suffixes, hardcoded `GST` labels in PDF export)
  - `packages/validation/src/index.ts` (Indian `gstin`/`pan` regex, `indianPhoneSchema` 10-digit assumption)
- **Correction**:
  - Add multi-country regionalization at both **Organization** and **Project** levels: `countryCode`, `stateOrRegion`, `currencyCode` (with ISO-4217 minor-unit precision `0 | 2 | 3` decimals), `areaUnit` (`SQFT` | `SQM` | `SQYD` | `ACRE` | `HECTARE`), `timezone`, `taxRegimeLabel` (e.g. `GST`, `VAT`, `Sales Tax`, `Transfer Tax`, `Exempt`), and `regulatoryAuthorityLabel` (e.g. `RERA`, `DLD`, `HDB`, `DRE`).
  - Generalize validation to international E.164 phone numbers and flexible tax/regulatory identifiers while maintaining backward compatibility for Indian `GSTIN`/`PAN`/`RERA` records.

### Finding 4 — Missing Dynamic Property-Type Structure Templates & Resale/Rental Inventory Modes
- **Locations**: `projects` and `units` schemas & inventory creation forms.
- **Correction**:
  - Introduce explicit `structureTemplate` per project (`APARTMENT_TOWER`, `VILLA_COMMUNITY`, `PLOTTED_LAYOUT`, `COMMERCIAL_BUILDING`, `MIXED_CUSTOM`) with dynamic hierarchy labels (e.g., `Building` -> `Floor` -> `Office/Shop` for commercial; `Phase/Community` -> `Villa` for villas; `Phase/Sector` -> `Plot` for plotted layouts—never forcing apartment towers or floors where inapplicable).
  - Support `inventoryTransactionMode: 'PRIMARY_LAUNCH' | 'RESALE' | 'RENTAL' | 'COMMERCIAL_LEASE'` and agency/brokerage organizations (`organizationType: 'BUILDER' | 'DEVELOPER' | 'AGENCY'`).

### Finding 5 — Single-Level Project Price Books Instead of 6-Level Inherited Pricing + Offers
- **Locations**: `packages/shared/src/pricing-engine.ts` & `functions/src/pricing/index.ts`.
- **Correction**:
  - Implement 6-level hierarchical pricing resolution with deterministic inheritance precedence:
    `1. Organization -> 2. Project -> 3. Phase -> 4. Structure (Tower/Building/Sector) -> 5. Unit Type -> 6. Individual Unit`
  - Support both **Lump-Sum Base Unit Price** and **Price per Area Unit**, generic multi-tax slabs (`TaxSlabRule[]`), and structured **Promotional Offers** (`PricingOffer[]`).

### Finding 6 — Static PDF Quotation Layout Instead of Reusable Cost-Sheet Template Engine
- **Locations**: `functions/src/quotations/index.ts`.
- **Correction**:
  - Add `cost_sheet_templates` collection allowing each organization to author multiple branded cost-sheet templates (header, logo, customer/unit blocks, custom line-item labels, tax breakdown visibility, schedule style, terms, sales rep block, footer) and each project to bind its own `defaultCostSheetTemplateId`.

### Finding 7 — Multi-Builder Channel Partner Switcher, Public 13-Filter Search & 3-Level Reporting
- **Correction**:
  - Upgrade Partner Portal with an explicit **Builder Switcher + Authorized Project Switcher** backed by server-verified `requirePartnerProjectScope` callables so changing a `projectId` can never leak another builder's confidential pricing or leads.
  - Upgrade Public Portal search across all 13 global dimensions (`Country`, `State/Region`, `City`, `Locality`, `Builder`, `Project`, `Property Type`, `Price`, `Configuration`, `Area`, `Availability`, `Possession Status`, `Amenities`).
  - Upgrade Super Admin with explicit, justification-mandatory audited inspection (`SUPER_ADMIN_SENSITIVE_DATA_ACCESS`) and 3-tier reporting (`Platform`, `Organization`, `Project`).
