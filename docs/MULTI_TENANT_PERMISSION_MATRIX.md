# Bharat Makaan — Multi-Tenant & Multi-Project Permission Matrix

## 1. Three Distinct Authorization Scopes

Every operation in Bharat Makaan is evaluated across **three explicit security boundaries** in both `firebase/firestore.rules` and Cloud Functions (`functions/src/shared/auth-guard.ts`):

1. **Scope 1 — Platform Super Admin (`PLATFORM_SUPER_ADMIN`)**:
   - Manages global SaaS plans, registered builder/agency tenants, total project counts, platform billing, integration quotas, and support tickets.
   - **Customer-Sensitive Data Restriction**: Super Admin console views only aggregate counts and tenant metadata by default. Any inspection of tenant-internal sensitive records requires invoking `superAdminInspectOrganizationData` with a mandatory justification reason (`min 10 chars`), which writes an immutable `SUPER_ADMIN_SENSITIVE_DATA_ACCESS` record to `audit_events`!
2. **Scope 2 — Organization Administration (`BUILDER_ADMIN`, `PROJECT_DIRECTOR`, Org-Wide Managers)**:
   - Full access across all projects belonging to `orgId` (`assignedProjectIds.length === 0` or executive override roles).
   - Can create unlimited independent projects (up to SaaS subscription `maxProjects` entitlement), configure org-wide branding/regional defaults, manage staff, assign staff to specific projects, authorize channel partners, and run consolidated **Organization / Portfolio Reports**.
3. **Scope 3 — Project-Scoped Staff & Multi-Builder Channel Partners**:
   - **Project-Scoped Employees** (`assignedProjectIds: ['projA', ...]`):
     - Backend callables (`requireOrgPermission(request, orgId, permission, projectId)`) and Firestore Security Rules (`hasProjectScopedPermission(orgId, permission, projectId)`) verify that `projectId in member.assignedProjectIds`.
     - Attempting to read or mutate unauthorized `Project B` returns `PERMISSION_DENIED` even if the client tampers with the `projectId` payload!
     - In `ALL_PROJECTS` and `PORTFOLIO_OVERVIEW` UI modes, queries aggregate **only** across `member.assignedProjectIds`.
   - **Multi-Builder Channel Partners** (`CHANNEL_PARTNER_ADMIN`, `CHANNEL_PARTNER_AGENT`):
     - Partner membership (`partner_members/{partnerOrgId}_{uid}`) grants access **only** to builders where `partnerOrg.builderScopes[orgId].status === 'AUTHORIZED'` AND **only** to `projectId in partnerOrg.builderScopes[orgId].projectIds`.
     - Partners NEVER see internal draft price books (`status == 'DRAFT'`), `internalNotes`, other partners' leads/commissions, or unauthorized projects—even if they manipulate `orgId` or `projectId` in requests!

---

## 2. Role × Scope × Capability Matrix

| Capability | Super Admin | Builder / Agency Admin | Project Director | Project / Inventory / Pricing / Sales Manager | Project-Assigned Executive | Channel Partner (Scoped) | Public Visitor |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Manage SaaS Plans, Tenants & Global Health | Yes | — | — | — | — | — | — |
| Inspect Sensitive Tenant Records | **Explicit Justification + Audited Only** | Own Org | Own Org | Scoped Projects | Assigned Projects | — | — |
| Create / Configure Organization Regional & Tax Settings | — | Own Org | Read | Read | — | — | — |
| Create Independent Projects | — | Own Org (Quota) | Own Org (Quota) | — | — | — | — |
| View "All Projects" / "Portfolio Overview" | Platform Totals | All Org Projects | All Org Projects | Permitted Projects | **Only `assignedProjectIds`** | **Only Authorized Builder Projects** | — |
| Manage Dynamic Hierarchy (Phases / Structures / Units) | — | Own Org | Own Org | Permitted (`inventory:manage`) | View / Hold (`assignedProjectIds`) | View Available Only | Published Only |
| Configure 6-Level Pricing & Custom Regional Taxes | — | Own Org | Approve | Draft / Activate (`pricing:*`) | Read Approved | View Authorized Price Only | Published Price Only |
| Author & Assign Cost-Sheet Templates | — | Own Org | Own Org | Permitted (`pricing:edit_draft`) | Use Assigned Template | Use Authorized Template | — |
| Generate Official Quotations & PDFs | — | Own Org | Own Org | Permitted Projects | Assigned Projects | Authorized Projects Only | — |
| Register Leads & View CRM | — | All Org Leads | All Org Leads | Permitted Projects | Own / Assigned Project Leads | Own Registered Leads Only | Submit Enquiry |
| Resolve Partner Lead-Protection Conflicts | — | Own Org | Own Org | Sales Manager (`partners:resolve_conflict`) | — | — | — |
| Controlled Bookings, Collections & Reconciliations | — | Own Org | Approve | Finance / Sales Manager | Request Booking | Track Own Booking Status & Commission | — |
| Publish / Unpublish Public Portal Listings | — | Own Org | Own Org | `projects:publish_public` | — | — | Read Published Only |

---

## 3. Server-Side Enforcement Checklist

1. **Zero Trust on Selected Project ID**: Frontend header switcher (`activeOrgId`, `projectScopeMode`, `activeProjectId`) is purely a UX selector; every Cloud Function callable and Firestore security rule independently validates `orgId` membership, active account status, granular `PermissionKey`, and `projectId` authorization.
2. **Cross-Tenant & Cross-Builder Isolation**: Queries filter by `orgId` + authorized `projectId` set; Firestore rules reject cross-org reads/writes unconditionally unless `isPublicPublished == true` on public catalog collections (`projects`, `units`).
3. **Confidential Field Redaction for Partners & Public**: Channel partner inventory/quotation endpoints return sanitized project/unit projections (omitting `internalNotes`, draft price books, and other buyers' PII).
