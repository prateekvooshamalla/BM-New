/**
 * @bharat-makaan/shared — RBAC & Granular Permission Engine
 * Enforces permission-based authorization (not role-name checks alone)
 * with explicit organization status and optional project-level scoping.
 */

export const ROLES = [
  'PLATFORM_SUPER_ADMIN',
  'BUILDER_ADMIN',
  'PROJECT_DIRECTOR',
  'PROJECT_MANAGER',
  'SALES_MANAGER',
  'SALES_EXECUTIVE',
  'CRM_EXECUTIVE',
  'INVENTORY_MANAGER',
  'PRICING_MANAGER',
  'FINANCE_MANAGER',
  'CHANNEL_PARTNER_ADMIN',
  'CHANNEL_PARTNER_AGENT',
  'CUSTOMER',
] as const;

export type RoleKey = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Dashboard & Organization
  'dashboard:view',
  'org:manage',
  'staff:view',
  'staff:invite',
  'staff:manage_permissions',
  'staff:suspend',
  'staff:transfer_leads',
  // Projects & Hierarchy
  'projects:view',
  'projects:create',
  'projects:edit',
  'projects:publish_public',
  // Visual Inventory
  'inventory:view',
  'inventory:manage',
  'inventory:hold',
  'inventory:reserve',
  'inventory:release',
  // Physical Parking
  'parking:view',
  'parking:manage',
  'parking:allocate',
  'parking:swap',
  // Dynamic Pricing
  'pricing:view',
  'pricing:edit_draft',
  'pricing:submit_approval',
  'pricing:approve',
  'pricing:activate',
  // Quotations & Cost Sheets
  'quotations:view',
  'quotations:create',
  'quotations:request_discount',
  'quotations:approve_discount',
  'quotations:share',
  // Documents & Floor Plans
  'documents:view',
  'documents:upload',
  'documents:manage_versions',
  'documents:share_external',
  // Channel Partners
  'partners:view',
  'partners:manage',
  'partners:register_lead',
  'partners:resolve_conflict',
  'partners:view_commissions',
  // Leads, CRM & Forms
  'leads:view',
  'leads:view_all',
  'leads:create',
  'leads:edit',
  'leads:assign',
  'leads:import_export',
  'forms:manage',
  // WhatsApp Inbox
  'whatsapp:view',
  'whatsapp:send',
  'whatsapp:approve_ai_reply',
  'whatsapp:manage_templates',
  'whatsapp:configure_auto_send',
  // Site Visits
  'visits:view',
  'visits:schedule',
  'visits:manage_outcome',
  // Bookings & Collections
  'bookings:view',
  'bookings:create',
  'bookings:approve',
  'bookings:cancel',
  'collections:view',
  'collections:record',
  'collections:refund',
  'collections:reconcile',
  // AI, Reports, Audit, Settings & SaaS Billing
  'ai:use',
  'ai:admin_reports',
  'reports:view',
  'audit:view',
  'approvals:decide',
  'settings:view',
  'settings:manage_integrations',
  'billing:view',
  'billing:manage',
  // Platform Super Admin
  'platform:super_admin',
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  PLATFORM_SUPER_ADMIN: 'Platform Super Admin',
  BUILDER_ADMIN: 'Builder Admin',
  PROJECT_DIRECTOR: 'Project Director',
  PROJECT_MANAGER: 'Project Manager',
  SALES_MANAGER: 'Sales Manager',
  SALES_EXECUTIVE: 'Sales Executive',
  CRM_EXECUTIVE: 'CRM Executive',
  INVENTORY_MANAGER: 'Inventory Manager',
  PRICING_MANAGER: 'Pricing Manager',
  FINANCE_MANAGER: 'Finance Manager',
  CHANNEL_PARTNER_ADMIN: 'Channel Partner Admin',
  CHANNEL_PARTNER_AGENT: 'Channel Partner Agent',
  CUSTOMER: 'Customer',
};

const ALL_BUILDER_PERMISSIONS: PermissionKey[] = PERMISSIONS.filter(
  (p) => p !== 'platform:super_admin'
);

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  PLATFORM_SUPER_ADMIN: [...PERMISSIONS],
  BUILDER_ADMIN: [...ALL_BUILDER_PERMISSIONS],
  PROJECT_DIRECTOR: ALL_BUILDER_PERMISSIONS.filter(
    (p) => p !== 'billing:manage' && p !== 'org:manage'
  ),
  PROJECT_MANAGER: [
    'dashboard:view',
    'staff:view',
    'projects:view',
    'projects:edit',
    'inventory:view',
    'inventory:manage',
    'inventory:hold',
    'inventory:reserve',
    'inventory:release',
    'parking:view',
    'parking:manage',
    'parking:allocate',
    'parking:swap',
    'pricing:view',
    'quotations:view',
    'quotations:create',
    'quotations:share',
    'documents:view',
    'documents:upload',
    'documents:manage_versions',
    'documents:share_external',
    'partners:view',
    'leads:view',
    'leads:view_all',
    'visits:view',
    'visits:schedule',
    'visits:manage_outcome',
    'bookings:view',
    'collections:view',
    'ai:use',
    'reports:view',
    'audit:view',
    'settings:view',
  ],
  SALES_MANAGER: [
    'dashboard:view',
    'staff:view',
    'staff:transfer_leads',
    'projects:view',
    'inventory:view',
    'inventory:hold',
    'inventory:reserve',
    'parking:view',
    'parking:allocate',
    'pricing:view',
    'quotations:view',
    'quotations:create',
    'quotations:request_discount',
    'quotations:approve_discount',
    'quotations:share',
    'documents:view',
    'documents:share_external',
    'partners:view',
    'partners:manage',
    'partners:resolve_conflict',
    'partners:view_commissions',
    'leads:view',
    'leads:view_all',
    'leads:create',
    'leads:edit',
    'leads:assign',
    'leads:import_export',
    'forms:manage',
    'whatsapp:view',
    'whatsapp:send',
    'whatsapp:approve_ai_reply',
    'whatsapp:manage_templates',
    'visits:view',
    'visits:schedule',
    'visits:manage_outcome',
    'bookings:view',
    'bookings:create',
    'bookings:approve',
    'collections:view',
    'ai:use',
    'ai:admin_reports',
    'reports:view',
    'approvals:decide',
    'settings:view',
  ],
  SALES_EXECUTIVE: [
    'dashboard:view',
    'projects:view',
    'inventory:view',
    'inventory:hold',
    'parking:view',
    'pricing:view',
    'quotations:view',
    'quotations:create',
    'quotations:request_discount',
    'quotations:share',
    'documents:view',
    'documents:share_external',
    'leads:view',
    'leads:create',
    'leads:edit',
    'whatsapp:view',
    'whatsapp:send',
    'whatsapp:approve_ai_reply',
    'visits:view',
    'visits:schedule',
    'visits:manage_outcome',
    'bookings:view',
    'bookings:create',
    'ai:use',
  ],
  CRM_EXECUTIVE: [
    'dashboard:view',
    'projects:view',
    'inventory:view',
    'quotations:view',
    'documents:view',
    'documents:share_external',
    'leads:view',
    'leads:view_all',
    'leads:create',
    'leads:edit',
    'leads:assign',
    'whatsapp:view',
    'whatsapp:send',
    'whatsapp:approve_ai_reply',
    'visits:view',
    'visits:schedule',
    'visits:manage_outcome',
    'bookings:view',
    'collections:view',
    'collections:record',
    'ai:use',
    'reports:view',
  ],
  INVENTORY_MANAGER: [
    'dashboard:view',
    'projects:view',
    'projects:edit',
    'projects:publish_public',
    'inventory:view',
    'inventory:manage',
    'inventory:hold',
    'inventory:reserve',
    'inventory:release',
    'parking:view',
    'parking:manage',
    'parking:allocate',
    'parking:swap',
    'documents:view',
    'documents:upload',
    'documents:manage_versions',
    'reports:view',
    'audit:view',
  ],
  PRICING_MANAGER: [
    'dashboard:view',
    'projects:view',
    'inventory:view',
    'parking:view',
    'pricing:view',
    'pricing:edit_draft',
    'pricing:submit_approval',
    'pricing:activate',
    'quotations:view',
    'quotations:create',
    'documents:view',
    'ai:use',
    'reports:view',
    'audit:view',
  ],
  FINANCE_MANAGER: [
    'dashboard:view',
    'projects:view',
    'inventory:view',
    'pricing:view',
    'quotations:view',
    'partners:view',
    'partners:view_commissions',
    'bookings:view',
    'bookings:approve',
    'bookings:cancel',
    'collections:view',
    'collections:record',
    'collections:refund',
    'collections:reconcile',
    'documents:view',
    'documents:upload',
    'reports:view',
    'audit:view',
    'billing:view',
    'billing:manage',
  ],
  CHANNEL_PARTNER_ADMIN: [
    'dashboard:view',
    'projects:view',
    'inventory:view',
    'quotations:view',
    'quotations:create',
    'quotations:request_discount',
    'quotations:share',
    'documents:view',
    'documents:share_external',
    'partners:view',
    'partners:register_lead',
    'partners:view_commissions',
    'leads:view',
    'leads:create',
    'visits:view',
    'visits:schedule',
    'bookings:view',
  ],
  CHANNEL_PARTNER_AGENT: [
    'dashboard:view',
    'projects:view',
    'inventory:view',
    'quotations:view',
    'quotations:create',
    'quotations:request_discount',
    'quotations:share',
    'documents:view',
    'partners:register_lead',
    'partners:view_commissions',
    'leads:view',
    'leads:create',
    'visits:view',
    'visits:schedule',
    'bookings:view',
  ],
  CUSTOMER: [
    'projects:view',
    'documents:view',
    'quotations:view',
    'bookings:view',
    'collections:view',
    'visits:view',
    'visits:schedule',
  ],
};

export interface PermissionSubject {
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  role: RoleKey;
  permissions: PermissionKey[];
  assignedProjectIds?: string[];
  isPlatformSuperAdmin?: boolean;
}

/**
 * Evaluates explicit permission keys, active account status, and optional project scope.
 */
export function hasPermission(
  subject: PermissionSubject | null | undefined,
  requiredPermission: PermissionKey,
  targetProjectId?: string | null
): boolean {
  if (!subject) return false;
  if (subject.isPlatformSuperAdmin || subject.role === 'PLATFORM_SUPER_ADMIN') {
    return subject.status === 'ACTIVE';
  }
  if (subject.status !== 'ACTIVE') return false;
  if (!subject.permissions.includes(requiredPermission)) return false;

  if (
    targetProjectId &&
    Array.isArray(subject.assignedProjectIds) &&
    subject.assignedProjectIds.length > 0 &&
    subject.role !== 'BUILDER_ADMIN' &&
    subject.role !== 'PROJECT_DIRECTOR'
  ) {
    return subject.assignedProjectIds.includes(targetProjectId);
  }

  return true;
}

export function isPrivilegedMfaRole(role: RoleKey): boolean {
  return (
    role === 'PLATFORM_SUPER_ADMIN' ||
    role === 'BUILDER_ADMIN' ||
    role === 'FINANCE_MANAGER'
  );
}
