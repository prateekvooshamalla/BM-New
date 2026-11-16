# Bharat Makaan — Production Role & Permission Matrix

This document defines the four isolated user experiences (**Customer**, **Builder**, **Channel Partner**, and **Platform Super Admin**), their route namespaces, and server-enforced permission boundaries.

---

## 1. Four User Experiences & Route Isolation

| Persona | Allowed Route Namespace | Auth & MFA Requirement | Forbidden Surfaces |
| :--- | :--- | :--- | :--- |
| **A. Customer (Buyer / Tenant)** | `/`, `/buy`, `/rent`, `/projects`, `/property/:slug`, `/project/:slug`, `/compare`, `/login` (public); `/saved`, `/my-enquiries`, `/my-visits` (authenticated) | Anonymous for browsing; Firebase Auth for saved properties, enquiries & visit tracking | **Strictly blocked** from `/builder/*`, `/partner/*`, `/admin/*`, internal inventory, unpublished units, price books, employee data, and partner commissions |
| **B. Builder Organization & Staff** | `/builder/dashboard`, `/builder/projects`, `/builder/projects/:id`, `/builder/inventory`, `/builder/parking`, `/builder/pricing`, `/builder/cost-sheets`, `/builder/leads`, `/builder/inbox`, `/builder/channel-partners`, `/builder/visits`, `/builder/bookings`, `/builder/collections`, `/builder/documents`, `/builder/ai-assistant`, `/builder/reports`, `/builder/team`, `/builder/billing`, `/builder/settings` | Verified Firebase Auth + `ACTIVE` `OrganizationMember` + Active/Grace Subscription Entitlement; MFA enforced for `BUILDER_ADMIN` & `FINANCE_MANAGER` when `mfaRequired=true` | Blocked from `/admin/*` and other builders' organizations/projects |
| **C. Channel Partner Agency** | `/partner/dashboard`, `/partner/builders`, `/partner/projects`, `/partner/inventory`, `/partner/leads`, `/partner/visits`, `/partner/quotations`, `/partner/commissions`, `/partner/profile` | Verified Firebase Auth + `ACTIVE` `PartnerMember` + explicit `AUTHORIZED` `PartnerBuilderScope` grant per builder & project | Blocked from `/builder/*`, `/admin/*`, unapproved builders/projects, internal draft price books, builder customer ledgers, and direct inventory/project/booking mutations |
| **D. Platform Super Admin** | `/admin/dashboard`, `/admin/builders`, `/admin/organizations`, `/admin/projects`, `/admin/users`, `/admin/subscriptions`, `/admin/payments`, `/admin/credits`, `/admin/integrations`, `/admin/audit`, `/admin/settings` | Verified Firebase Auth + `platformRole == 'PLATFORM_SUPER_ADMIN'` + **Mandatory TOTP MFA** (`mfaVerified == true`) | Direct un-audited client reads of customer PII (`leads`, `conversations`) blocked in `firestore.rules`; diagnostic inspection requires server-audited justification |

---

## 2. Granular Builder & Partner Role Permissions

| Capability | `BUILDER_ADMIN` | `PROJECT_MANAGER` | `INVENTORY_MANAGER` | `PRICING_MANAGER` | `SALES_MANAGER` | `SALES_EXECUTIVE` | `FINANCE_MANAGER` | `CHANNEL_PARTNER_ADMIN` | `CUSTOMER` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Manage Org Settings & Team** (`org:manage`, `staff:*`) | Yes (All) | View Staff | No | No | View/Transfer Leads | No | No | Own Agency Only | No |
| **Manage SaaS Billing & Wallets** (`billing:manage`) | Yes | No | No | No | No | No | Yes | No | No |
| **Create / Activate Projects** (`projects:create`, `projects:edit`) | Yes (Within Paid Capacity) | Edit Assigned | View Assigned | View Assigned | View Assigned | View Assigned | View Assigned | No | Published Only |
| **Manage Towers, Floors, Units & AI Imports** (`inventory:manage`) | Yes | Assigned Projects | Assigned Projects | View Only | Hold / Reserve / Release | Hold Only (Assigned) | View Only | Permitted Non-Booked Read Only | Published Only |
| **Configure & Activate Price Books** (`pricing:*`) | Full + Approve | View | No | Draft + Submit + Activate | View | View | View | Permitted Active Rates Only | No |
| **Generate Cost Sheets & Quotations** (`quotations:*`) | Full + Approve Discount | Create + Share | No | Create | Create + Approve Discount | Create + Request Discount | View | Permitted Projects Only | Own Shared Links |
| **Lead CRM & WhatsApp Inbox** (`leads:*`, `whatsapp:*`) | All Org Leads | Assigned Projects | No | No | All Assigned Projects | Own Assigned Leads | No | Own Registered Leads Only | Own Enquiries Only |
| **Bookings & Collections** (`bookings:*`, `collections:*`) | Full + Approve/Cancel | View | No | No | Create + View | Create + View | Approve + Record + Reconcile + Refund | View Own Converted Status | No |
| **Use Prepaid AI Assistant** (`ai:use` / `inventory:view`) | Yes (Debits AI Wallet) | Assigned Projects | Assigned Projects | Assigned Projects | Assigned Projects | Read/Match Only | Reports Only | Scoped Availability Only | No |

---

## 3. Anti-Escalation Invariants

1. **No Self-Privilege Escalation**: No user may modify their own `role`, `permissions`, or `status` in `organization_members`.
2. **Sole Admin Protection**: The last `ACTIVE` `BUILDER_ADMIN` of an organization cannot be suspended or demoted.
3. **Project Scope Intersection**: For any non-admin staff member with non-empty `assignedProjectIds`, every project-level read and write must satisfy `targetProjectId in assignedProjectIds`.
4. **Partner Grant Isolation**: Channel partners never gain access merely by registering an account; a Builder Admin/Sales Manager must issue an invitation or approve a partner grant (`status === 'AUTHORIZED'`) for explicit `projectIds`.
