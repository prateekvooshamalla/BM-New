# Bharat Makaan — Authentication, Authorization & Multi-Tenant Security Audit

**Audit Date:** 2026-11-16
**Baseline Checkpoint Tag:** `checkpoint-pre-production-auth-billing`

---

## 1. Scope Inspected

Every authentication, session, RBAC, routing, Firestore Security Rule, Storage Security Rule, Cloud Function guard, and Super Admin provisioning file was audited:

- `functions/src/shared/auth-guard.ts`
- `functions/src/auth/index.ts`
- `functions/src/organizations/index.ts` & `functions/src/organizations/super-admin.ts`
- `functions/src/integrations/index.ts` & `functions/src/whatsapp/index.ts`
- `functions/src/ai/models.ts` & `functions/src/ai/tools.ts`
- `firebase/firestore.rules` & `firebase/storage.rules`
- `scripts/provision-super-admin.ts`
- `apps/web/src/app/AuthProvider.tsx`, `apps/web/src/app/AppRouter.tsx`, `apps/web/src/features/auth/pages/AuthPage.tsx`
- `apps/mobile/src/navigation/RootNavigator.tsx` & `apps/mobile/src/services/firebase.ts`

---

## 2. Security & Architectural Gaps Identified

| ID | Severity | Component | Finding | Remediation |
| :--- | :---: | :--- | :--- | :--- |
| **SEC-01** | **CRITICAL** | `firebase/firestore.rules` (L249) | `partner_organizations` read rule included `(isSignedIn() && resource.data.authorizedOrgIds.size() > 0)`, allowing any signed-in user (including Customers or unrelated Builders) to read partner organization records. | Restrict `partner_organizations` reads strictly to `isSuperAdmin() \|\| isActivePartnerMember(partnerOrgId)` and authorized builder staff via server-validated queries/rules. |
| **SEC-02** | **HIGH** | `functions/src/shared/auth-guard.ts` | `requireAuth` decoded caller token claims from `request.auth` without checking Firebase Auth account `disabled` status or refresh-token revocation (`tokensValidAfterTime`). | Add `requireVerifiedAuth` validating live `UserRecord` (`!disabled`, `tokensValidAfterTime <= auth_time`) so revoked or disabled accounts are rejected immediately across all privileged callables. |
| **SEC-03** | **HIGH** | `functions/src/shared/auth-guard.ts` | `requireSuperAdmin` extracted `mfaVerified` (`firebase.sign_in_second_factor`) but did not enforce MFA when `token.requireMfa === true`. | Enforce `mfaVerified === true` whenever `requireMfa` claim is active on `PLATFORM_SUPER_ADMIN` or privileged `mfaRequired` org members. |
| **SEC-04** | **HIGH** | `functions/src/auth/index.ts` & `AuthPage.tsx` | Email registration did not trigger `sendEmailVerification`, and `syncMySessionMemberships` auto-accepted `INVITED` staff/partner records by email without verifying `userRecord.emailVerified === true`. | Trigger `sendEmailVerification` on email sign-up and require `userRecord.emailVerified === true` before claiming any `INVITED` organization or partner membership. |
| **SEC-05** | **HIGH** | `functions/src/organizations/index.ts` | `updateMemberAccessService` did not block `actor.uid === input.targetUid`, allowing a user with `staff:manage_permissions` to mutate their own role/permissions or suspend the sole `BUILDER_ADMIN`. | Explicitly prohibit self-role/permission mutation and prevent suspending/demoting the last active `BUILDER_ADMIN` of an organization. |
| **SEC-06** | **HIGH** | `apps/web/src/app/AppRouter.tsx` | Enterprise workspace routes were not wrapped in dedicated role/entitlement route guards, and the four user personas (Customer, Builder, Channel Partner, Super Admin) shared overlapping paths. | Separate into 4 strict route trees (`/`, `/builder/*`, `/partner/*`, `/admin/*`) with dedicated client guards backed by server-side RBAC and Firestore rules. |
| **SEC-07** | **HIGH** | `packages/config` & `functions/src/integrations` | Legacy 4-tier SaaS plan catalog (`STARTER`, `GROWTH`, `BUILDER_PRO`, `ENTERPRISE`) conflicted with the production 2-package model (`SINGLE_PROJECT` ₹5,999/mo, `MULTI_PROJECT` ₹4,999/project/mo min 2), lacked webhook event deduplication (`subscription_events`), and bundled AI/WhatsApp quotas instead of prepaid wallets. | Replace with `SINGLE_PROJECT` & `MULTI_PROJECT`, optional `onboarding_orders`, Razorpay Subscriptions API + idempotent raw-body HMAC webhooks, and append-only prepaid AI & WhatsApp wallets (`usage_ledger`). |
| **SEC-08** | **MEDIUM** | `firebase/storage.rules` | Storage rules verified `organization_members` permission without checking whether the parent `organizations/{orgId}` is `ACTIVE` (non-suspended) and lacked customer/partner path isolation. | Require `organizations/{orgId}.data.status == 'ACTIVE'` on tenant Storage reads/writes and enforce strict MIME + 25 MB size limits. |
| **SEC-09** | **MEDIUM** | `functions/src/ai/models.ts` | Default model IDs referenced unverified placeholder names (`gpt-6.1-*`) instead of current supported OpenAI production models. | Default to current supported OpenAI models (`gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o4-mini`) with full environment-variable override and pre-execution wallet reservation/reconciliation. |

---

## 3. Shared Authorization Architecture

1. **Trusted Custom Claims (Minimal & Bounded)**:
   - Firebase Auth custom claims are used **only** for platform-global flags:
     - `platformRole: 'PLATFORM_SUPER_ADMIN'`
     - `requireMfa: true`
   - Custom claims are **never** writable by clients and **never** overloaded with large per-project arrays (avoiding Firebase's 1,000-byte custom claim limit).
2. **Authoritative Firestore Access Grants**:
   - **Builder Staff**: `organization_members/{orgId}_{uid}` (`role`, `permissions[]`, `assignedProjectIds[]`, `status`, `mfaRequired`).
   - **Channel Partners**: `partner_organizations/{partnerOrgId}` (`builderScopes[builderOrgId]` with `status: 'INVITED' | 'PENDING_APPROVAL' | 'AUTHORIZED' | 'SUSPENDED'` and `projectIds[]`) + `partner_members/{partnerOrgId}_{uid}`.
   - **Customers**: Authenticated Firebase UID (`customers/{uid}` + `customer_saved_properties/{uid}_{unitId}`) with zero membership in builder/partner/admin collections required.
3. **Defense-in-Depth**:
   - Client route guards (`CustomerAuthGuard`, `BuilderWorkspaceGuard`, `PartnerWorkspaceGuard`, `SuperAdminGuard`) provide UX isolation and immediate redirection.
   - Every Cloud Function (`onCall` / `onRequest`) re-verifies token validity, revocation, MFA status, organization status, subscription/grace entitlement, project scope, and wallet balance via Admin SDK before mutating state.
   - Firestore & Storage Security Rules deny all access by default and block all direct client writes to privileged collections (`organizations`, `organization_members`, `subscriptions`, `entitlements`, `payments`, `invoices`, `usage_ledger`, `credit_topups`, `audit_events`).
