# Bharat Makaan — AI Tool & Permission Matrix

Every AI Assistant tool executes exclusively on the backend (`functions/src/ai/tools.ts`) after verifying Firebase Auth, active tenant or channel-partner membership, explicit `PermissionKey`, and `assignedProjectIds` / `builderScopes` project access.

| Tool Name | Operation Class | Required Permission(s) | Scope Enforcement | Execution Mode |
| :--- | :--- | :--- | :--- | :--- |
| `listAuthorizedOrganizations` | Read | Authenticated User | User's `ACTIVE` org/partner memberships | Immediate Read |
| `listAuthorizedProjects` | Read | `projects:view` | Filtered to `assignedProjectIds` or partner `projectIds` | Immediate Read |
| `getProjectStructure` | Read | `projects:view` | Target `projectId` must be authorized | Immediate Read |
| `getTowerStructure` | Read | `inventory:view` | Target `projectId` must be authorized | Immediate Read |
| `findExistingUnits` | Read | `inventory:view` | Redacts confidential fields for Channel Partners | Immediate Read |
| `getInventoryAvailability` | Read | `inventory:view` | Project-scoped live status counts | Immediate Read |
| `getFloorPlanMappings` | Read | `documents:view` | Project-scoped `floor_plan_versions` | Immediate Read |
| `explainInventoryChanges` | Read | `pricing:view` or `audit:view` | Project-scoped `price_revisions` & `audit_events` | Immediate Read |
| `prepareLeadMatching` | Read | `leads:view` + `inventory:view` | Matches authorized leads to `AVAILABLE` units | Immediate Read |
| `summarizeProjectLeads` | Read | `leads:view` | Scoped to assigned leads unless `leads:view_all` | Immediate Read |
| `getJobStatus` | Read | `inventory:view` | Must belong to caller's `orgId` & authorized `projectId` | Immediate Read |
| `createTowerDraft` | Staged Draft | `inventory:manage` | Builder/Staff only (Partners blocked) | Draft Only (Requires Confirmation) |
| `updateTowerDraft` | Staged Draft | `inventory:manage` | Builder/Staff only; validates numbering & duplicates | Draft Only (Requires Confirmation) |
| `previewFloorGeneration` | Staged Preview | `inventory:manage` | Computes floors, skipped/refuge levels & unit codes | Draft Preview Only |
| `validateUnitNumbering` | Validation | `inventory:view` | Cross-checks live `units` collection for collisions | Read / Validation |
| `previewInventoryChanges` | Staged Preview | `inventory:manage` | Flags `BOOKED`/`REGISTERED` locks & duplicate conflicts | Draft Preview Only |
| `commitApprovedInventoryDraft` | Mutating Commit | `inventory:manage` (+ `projects:edit` for new towers) | Requires explicit user confirmation + `idempotencyKey` | Confirmed Chunked Commit + Audit |
| `createPricingDraft` | Staged Draft | `pricing:edit_draft` | Creates `DRAFT` `PriceBook` only (never auto-activates) | Confirmed Draft Creation + Audit |
| `createQuotationTemplateDraft` | Staged Draft | `pricing:edit_draft` | Creates `cost_sheet_templates` record | Confirmed Creation + Audit |
| `createFollowUpTaskDraft` | Mutating CRM | `leads:edit` | Requires user confirmation before writing `lead_activities` | Confirmed Write + Audit |

## Hard Security Boundaries

1. **Channel Partners** (`CHANNEL_PARTNER_ADMIN`, `CHANNEL_PARTNER_AGENT`) can query permitted availability, view approved floor plans, match their own protected leads, and request authorized quotations on permitted `(orgId, projectId)` pairs—they can **never** create/modify towers, floors, units, price books, or read other agencies'/builder internal leads.
2. **Project-Scoped Staff** (`assignedProjectIds.length > 0`) are rejected (`permission-denied`) if a prompt or tool call references an unassigned `projectId`.
3. **Cross-Builder Isolation**: Every session, draft, document, and import job validates `resource.orgId === verifiedOrgId`.
4. **Protected Sold Inventory**: Units in `BOOKED`, `AGREEMENT`, or `REGISTERED` status can never be overwritten, renumbered, or deleted by AI-assisted imports.
