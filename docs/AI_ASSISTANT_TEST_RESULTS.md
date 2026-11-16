# Bharat Makaan — Internal AI Assistant & Floor-Plan Intelligence Test Results

**Execution Date:** 2026-11-16
**Repository Branch:** `main`

---

## 1. Automated Verification Summary

| Verification Gate | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Monorepo TypeScript Typecheck** | `pnpm typecheck` | **PASS (Exit 0)** | 7/7 packages clean (`config`, `shared`, `validation`, `functions`, `apps/web`, `apps/mobile`, `tests`) |
| **Monorepo ESLint** | `pnpm lint` | **PASS (Exit 0)** | `0 errors` across all workspaces |
| **Service & AI Integration Suite** | `pnpm test` | **PASS (Exit 0)** | `11 passed (11)` test files, `25 passed (25)` end-to-end tests |
| **Live Firestore Emulator Security Rules** | `firebase emulators:exec --only firestore "pnpm test:emulator"` | **PASS (Exit 0)** | `3 passed (3)` live emulator rules tests verifying `ai_sessions`, `ai_inventory_drafts`, `ai_import_jobs`, project-scoped RBAC, and PII protection |
| **Production Monorepo Build** | `pnpm build` | **PASS (Exit 0)** | Built `@bharat-makaan/config`, `@bharat-makaan/shared`, `@bharat-makaan/validation`, Cloud Functions v2 bundle (`functions/lib/index.js`), and Vite Web SPA (`apps/web/dist`) |

---

## 2. 20 Required AI Assistant & Floor-Plan Extraction Scenarios Matrix

All 20 mandatory scenarios are exercised end-to-end in `tests/src/ai-assistant-inventory.test.ts`:

| # | Scenario | Status | Verified Assertions |
| :---: | :--- | :---: | :--- |
| **1** | Creating a tower through multi-turn conversation | **PASS** | Progressive 5-turn conversation (`Tower 1` → `Green Valley Phase 2` → `25 floors` → `4 units/floor + ground lobby` → `101–104, 3x 3 BHK + 1x 4 BHK`) commits 1 tower, 25 residential floors, and 100 units |
| **2** | Correct project resolution from active context | **PASS** | Pre-scoped session (`projectId` set) skips asking `"Which project should I add it to?"` and immediately prompts for floor count |
| **3** | Unknown project clarification | **PASS** | Requesting `"Add Tower 1 to project Unknown Atlantis"` keeps `projectId = null`, lists authorized projects, and prompts structured selection |
| **4** | Collecting floor count & unit configuration progressively | **PASS** | `session.missingFields` transitions deterministically (`projectId` → `totalFloors` → `unitsPerFloor` → `numberingPattern` / `bhkMix` → `[]`) |
| **5** | Handling differently configured floors | **PASS** | Typical residential floors (`1–19`, 4 apartments/floor) + Exceptional Sky Penthouse floor (`Floor 20`, 2 penthouses) generated and persisted accurately |
| **6** | Handling skipped and refuge floors | **PASS** | Skipped floor `13` excluded completely from `floors` and `units`; Refuge floors `8` and `16` created with `floorCategory: 'REFUGE'` and `0` saleable units |
| **7** | Detecting duplicate towers and duplicate unit numbers | **PASS** | Staging `Tower 1` / `Unit 101` against existing records raises `DUPLICATE_TOWER_CODE` and blocks `readyToCommit` |
| **8** | Handling corrected wizard answers mid-conversation | **PASS** | Saying `"Actually 20 floors, skip floor 13, and refuge floors 8 and 16"` updates `totalFloors = 20` and recomputes exact unit count (`68`) |
| **9** | Reading multi-page PDFs | **PASS** | 5-page architectural PDF validated via `inspectPdfBufferPages` (`pageCount === 5`) and automatically escalated (`> 4` pages) to `gpt-6-astra` (`DOCUMENT_ESCALATION_EXTRACTION`) |
| **10** | Extracting typical floor templates with provenance | **PASS** | Extracted fields record `sourceDocumentId`, `sourceFileName`, `sourcePage`, `confidence`, and `reviewStatus` in `draft.extractedEvidence` |
| **11** | Not extrapolating unsupported Typical Floor ranges | **PASS** | PDF labeled `"Typical Floor Plan"` without explicit min/max floor numbers sets `isTypicalUnbounded = true`, emits `AMBIGUOUS_FLOOR_RANGE`, generates `0` extrapolated units, and rejects commit until explicit floor range (`1..10`) is confirmed |
| **12** | Correcting AI-extracted values | **PASS** | `updateAiInventoryDraftService` renames `101` → `ZN-101P`, updates saleable/carpet area, marks `102` as `SKIP`, and records `reviewStatus: 'CORRECTED'` |
| **13** | Preventing unauthorized imports | **PASS** | `SALES_EXECUTIVE` (without `inventory:manage`) and `CHANNEL_PARTNER_ADMIN` are rejected with `permission-denied` when attempting to create/commit inventory or access unassigned projects |
| **14** | Preventing cross-builder access | **PASS** | Builder B admin is rejected when attempting to access Builder A sessions, projects, drafts, or cross-tenant Firebase Storage prefixes (`organizations/orgA/...`) |
| **15** | Large import retries without duplicate records | **PASS** | `160` units + `40` floors + `1` tower (`201` ops) committed across multiple `<= 150`-op batches with checkpoints; re-running `confirmAndCommitAiDraft` with same `idempotencyKey` and calling `retryImportJobService` produce `0` duplicates |
| **16** | Rejecting unsupported and malformed files | **PASS** | Truncated/non-PDF bytes rejected with `Malformed PDF`, `.exe` MIME type rejected by Zod validation, and untrusted PDF prompt-injection directives stripped via `sanitizeUntrustedDocumentText` |
| **17** | Linking floor plans accurately to created units | **PASS** | Committed units receive persisted `floorPlanVersionId` mapped from uploaded floor-plan documents (`floor_plan_versions`) |
| **18** | Preserving existing quotations and booked units | **PASS** | `BOOKED` unit `101` raises `PROTECTED_BOOKED_UNIT` error; existing issued quotation total (`totalPayableInr`) remains completely untouched |
| **19** | Maintaining accurate project stats & clean draft cancellation | **PASS** | `cancelInventoryDraftService` leaves `0` unintended units; committed imports recompute `project.stats` (`totalTowers: 2`, `totalUnits: 161`, `bookedUnits: 1`, `availableUnits: 160`) from persisted Firestore docs |
| **20** | Updating CRM queries immediately after import | **PASS** | Natural-language queries (`"Show all available 3 BHK flats in Tower B"`, `"How many flats are booked on floors 10 to 20?"`, `"Find east-facing apartments above the 15th floor"`, `"Which units are missing floor plans?"`, `"Show all leads interested in this project"`, and Channel Partner scoped inventory) immediately reflect newly committed units |
