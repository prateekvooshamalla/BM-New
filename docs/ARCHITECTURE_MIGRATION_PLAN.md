# Bharat Makaan — Global Multi-Project Architecture Migration Plan

## 1. Guiding Principles

1. **Preserve Existing Code & Data**: Zero destructive drops, zero broken routes, zero dummy database records.
2. **Additive Backward Compatibility**: Existing organizations, projects, price books, quotations (including the optional `C-704` regression test), leads, bookings, and collections continue functioning seamlessly while unlocking global multi-country, multi-currency, dynamic property-type, 6-level pricing, and reusable cost-sheet template capabilities.
3. **Incremental Verified Stages**: Every stage compiles cleanly, passes automated unit/integration tests, and maintains web + mobile parity.

---

## 2. Staged Execution Plan

### Stage 0 — Audit, Architecture Specs & Git Checkpoint
- Complete repository audit (`docs/GLOBAL_ARCHITECTURE_AUDIT.md`).
- Define global multi-project data model (`docs/MULTI_PROJECT_DATA_MODEL.md`) and permission matrix (`docs/MULTI_TENANT_PERMISSION_MATRIX.md`).
- Commit documentation and tag Git checkpoint `checkpoint-pre-global-upgrade`.

### Stage 1 — Shared Global Domain, 6-Level Pricing & Template Engine (`packages/*`)
- **`@bharat-makaan/config`**:
  - Add global `COUNTRY_PRESETS` (`IN`, `AE`, `US`, `GB`, `SG`, `AU`, `CA`, `EU`, `JP`, `KW`), `CURRENCY_DEFINITIONS` (with ISO-4217 symbol, locale, and `minorUnitDigits: 0 | 2 | 3`), `AREA_UNITS` (`SQFT`, `SQM`, `SQYD`, `ACRE`, `HECTARE` + conversion factors), and `PROJECT_STRUCTURE_TEMPLATES` (`APARTMENT_TOWER`, `VILLA_COMMUNITY`, `PLOTTED_LAYOUT`, `COMMERCIAL_BUILDING`, `CUSTOM_HIERARCHY`).
- **`@bharat-makaan/shared`**:
  - Extend `Organization`, `Project`, `Tower` (Structure), `Unit`, `PriceBook`, `Quotation`, and add `CostSheetTemplate` & `PricingScopeOverride` entities.
  - Implement precise minor-unit decimal helpers (`toMinorUnits`, `fromMinorUnits`, `roundCurrency`, `formatMoney`, `formatArea`) alongside existing `formatInr` / `formatAreaSqft`.
  - Upgrade `pricing-engine.ts` to support:
    1. **6-Level Pricing Inheritance** (`ORGANIZATION -> PROJECT -> PHASE -> STRUCTURE -> UNIT_TYPE -> UNIT`) via `resolveEffectivePriceBook(...)`.
    2. Both `PER_AREA` and `BASE_UNIT_PRICE` (lump-sum) calculation modes.
    3. Configurable regional tax labels & rates (no hardcoded Indian GST requirement) + promotional `offers` (`PERCENTAGE_REBATE`, `FIXED_REBATE`, `FLOOR_RISE_WAIVER`, `PARKING_WAIVER`).
- **`@bharat-makaan/validation`**:
  - Upgrade schemas to support international E.164 phone numbers, multi-country tax/regulatory IDs, dynamic project structure templates, 6-level pricing overrides, and `costSheetTemplateSchema` while remaining 100% backward-compatible with existing payloads.

### Stage 2 — Backend Services, Security Rules & Non-Destructive Migration (`functions/*`, `firebase/*`, `scripts/*`)
- **`firebase/firestore.rules` & `firestore.indexes.json`**:
  - Add rules & composite indexes for `cost_sheet_templates`, `pricing_overrides`, project-scoped `leads`/`site_visits`, and global public portal filters (`countryCode`, `stateOrRegion`, `city`, `projectType`).
- **Cloud Functions (`functions/src/*`)**:
  - `organizations`: Support `organizationType` (`BUILDER`, `DEVELOPER`, `REAL_ESTATE_AGENCY`), regional currency/area/tax settings, and Super Admin `superAdminInspectOrganizationData` with mandatory reason + `SUPER_ADMIN_SENSITIVE_DATA_ACCESS` audit event.
  - `projects` & `inventory`: Support dynamic `structureTemplate`, optional phases/structures/floors, commercial/office/retail/villa/plot/resale/rental units, and strict `requireOrgPermission(..., projectId)` checks.
  - `pricing` & `quotations`: Add `savePricingOverride`, `upsertCostSheetTemplate`, 6-level inheritance resolution, and dynamic template-driven PDF generation (`pdf-lib` using template header/logo, currency formatting, regional tax labels, section toggles, custom charges, terms, and footer).
  - `channel-partners`: Add `listPartnerAuthorizedProjects` & `listPartnerAuthorizedInventory` enforcing strict multi-builder project scope isolation and confidential field redaction.
- **Migration Utility (`scripts/migrate-multi-project-schema.ts`)**:
  - Idempotent, non-destructive backfill script normalizing any legacy documents with missing regional/structure metadata.

### Stage 3 — Web & Mobile Global Switcher, Dynamic UI, Partner Switcher & 3-Level Reporting (`apps/web`, `apps/mobile`)
- **Global Organization & Project Switcher (Web Header & Mobile)**:
  - Upgrade header switcher with Organization selector + 3 explicit Project Scope modes:
    1. **All Projects** (consolidated authorized data across permitted projects)
    2. **Portfolio Overview** (executive cross-project comparison matrix & aggregate KPIs)
    3. **Single Project** (isolated project operations)
  - Persist selection per-org without bypassing `assignedProjectIds` RBAC; remove all `activeProjectId ?? projects[0]?.id` overrides and remove all `C-704` / `Tower C` UI placeholders!
- **Dynamic Inventory, Global Pricing & Cost-Sheet Template UI**:
  - Adapt Project & Inventory forms dynamically to `APARTMENT_TOWER`, `VILLA_COMMUNITY`, `PLOTTED_LAYOUT`, and `COMMERCIAL_BUILDING` (hiding irrelevant apartment floor/tower prompts for villas/plots; showing Building/Floor/Office/Shop for commercial).
  - Add Currency, Area Unit, Regional Tax Labels, 6-Level Override Editor, Promotional Offers, and **Cost-Sheet Template Designer** to Pricing & Quotations.
- **Multi-Builder Partner Switcher, Global 13-Filter Public Portal & 3-Level Reports**:
  - Add Builder Switcher + Authorized Project Switcher to `/partner/*`.
  - Upgrade Public Portal search with Country, State/Region, City, Locality, Builder, Project, Property Type, Price, Configuration, Area, Availability, Possession, and Amenities filters + cross-builder comparison.
  - Upgrade Reports to support **Platform**, **Organization (Portfolio)**, and **Project** levels.

### Stage 4 — 14-Scenario Automated Validation & Full Regression Suite (`tests/*`)
- Build `tests/src/global-multi-project-validation.test.ts` + extend `tests/src/emulator/firestore-rules.test.ts` to test **all 14 required validation scenarios** end-to-end alongside all 22 existing tests!
