import type { PermissionKey } from '@bharat-makaan/shared';

export interface WorkspaceCollectionAccess {
  permissions: readonly PermissionKey[];
  projectScoped?: boolean;
}

export const WORKSPACE_COLLECTION_ACCESS = {
  projects: { permissions: ['projects:view'], projectScoped: true },
  project_phases: { permissions: ['projects:view'], projectScoped: true },
  towers: { permissions: ['projects:view'], projectScoped: true },
  floors: { permissions: ['projects:view'], projectScoped: true },
  units: { permissions: ['inventory:view'], projectScoped: true },
  parking_slots: { permissions: ['parking:view'], projectScoped: true },
  parking_allocations: { permissions: ['parking:view'], projectScoped: true },
  price_books: { permissions: ['pricing:view'], projectScoped: true },
  price_revisions: { permissions: ['pricing:view'], projectScoped: true },
  payment_plans: {
    permissions: ['pricing:view', 'quotations:view'],
    projectScoped: true,
  },
  quotations: { permissions: ['quotations:view'], projectScoped: true },
  leads: { permissions: ['leads:view_all', 'leads:view'], projectScoped: true },
  lead_activities: { permissions: ['leads:view'] },
  lead_registrations: { permissions: ['partners:view'], projectScoped: true },
  site_visits: { permissions: ['visits:view'], projectScoped: true },
  bookings: { permissions: ['bookings:view'], projectScoped: true },
  collection_records: { permissions: ['collections:view'], projectScoped: true },
  reconciliation_records: { permissions: ['collections:reconcile'] },
  documents: { permissions: ['documents:view'] },
  floor_plan_versions: { permissions: ['documents:view'], projectScoped: true },
  forms: { permissions: ['forms:manage', 'leads:view'] },
  form_submissions: { permissions: ['forms:manage', 'leads:view_all'] },
  conversations: { permissions: ['whatsapp:view'] },
  messages: { permissions: ['whatsapp:view'] },
  organization_members: { permissions: ['staff:view'] },
  integrations: { permissions: ['settings:view'] },
  approvals: { permissions: ['approvals:decide'] },
  subscriptions: { permissions: ['billing:view', 'settings:view'] },
  entitlements: { permissions: ['billing:view', 'dashboard:view'] },
  invoices: { permissions: ['billing:view'] },
  payments: { permissions: ['billing:view'] },
  onboarding_orders: { permissions: ['billing:view'] },
  credit_topups: { permissions: ['billing:view'] },
  usage_ledger: { permissions: ['billing:view', 'reports:view'] },
  audit_events: { permissions: ['audit:view'] },
  ai_usage_logs: { permissions: ['reports:view'] },
  ai_inventory_drafts: { permissions: ['inventory:view'], projectScoped: true },
  ai_import_jobs: { permissions: ['inventory:view'], projectScoped: true },
  partner_organizations: { permissions: ['partners:view'] },
} satisfies Record<string, WorkspaceCollectionAccess>;

export function getWorkspaceCollectionAccess(
  collectionName: string
): WorkspaceCollectionAccess | undefined {
  if (!Object.hasOwn(WORKSPACE_COLLECTION_ACCESS, collectionName)) return undefined;
  return WORKSPACE_COLLECTION_ACCESS[
    collectionName as keyof typeof WORKSPACE_COLLECTION_ACCESS
  ];
}

export interface WorkspaceSnapshotRecord {
  id: string;
  data: Record<string, unknown>;
}

export function filterWorkspaceSnapshotRecords(
  collectionName: string,
  records: WorkspaceSnapshotRecord[],
  options: {
    actorUid: string;
    authorizedPermission: PermissionKey;
    allowedProjectIds: readonly string[] | null;
  }
): WorkspaceSnapshotRecord[] {
  const { actorUid, authorizedPermission, allowedProjectIds } = options;

  if (collectionName === 'leads' && authorizedPermission !== 'leads:view_all') {
    return records.filter((record) => record.data.assignedAgentUid === actorUid);
  }
  if (!allowedProjectIds) return records;

  const allowedProjects = new Set(allowedProjectIds);
  return records.filter(({ id, data }) => {
    if (collectionName === 'projects') return allowedProjects.has(id);

    const projectId = data.projectId;
    if (
      collectionName === 'ai_inventory_drafts' &&
      (projectId === null || projectId === undefined)
    ) {
      return true;
    }
    if (typeof projectId === 'string' && allowedProjects.has(projectId)) return true;

    return (
      collectionName === 'leads' &&
      authorizedPermission === 'leads:view_all' &&
      Array.isArray(data.preferredProjectIds) &&
      data.preferredProjectIds.some(
        (preferredProjectId) =>
          typeof preferredProjectId === 'string' && allowedProjects.has(preferredProjectId)
      )
    );
  });
}
