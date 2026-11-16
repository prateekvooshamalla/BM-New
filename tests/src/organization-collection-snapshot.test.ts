import { describe, expect, it } from 'vitest';
import {
  filterWorkspaceSnapshotRecords,
  getWorkspaceCollectionAccess,
  type WorkspaceSnapshotRecord,
} from '../../functions/src/organizations/collection-snapshot-access';

describe('organization collection snapshot access', () => {
  it('requires collection-specific permissions and excludes private AI sessions', () => {
    expect(getWorkspaceCollectionAccess('audit_events')?.permissions).toEqual(['audit:view']);
    expect(getWorkspaceCollectionAccess('invoices')?.permissions).toEqual(['billing:view']);
    expect(getWorkspaceCollectionAccess('ai_sessions')).toBeUndefined();
    expect(getWorkspaceCollectionAccess('unknown')).toBeUndefined();
  });

  it('filters project-scoped data and preserves projectless inventory drafts', () => {
    const records: WorkspaceSnapshotRecord[] = [
      { id: 'phase-1', data: { projectId: 'project-a' } },
      { id: 'phase-2', data: { projectId: 'project-b' } },
      { id: 'draft-1', data: { projectId: null } },
      { id: 'draft-2', data: { projectId: 'project-b' } },
    ];

    expect(
      filterWorkspaceSnapshotRecords('project_phases', records.slice(0, 2), {
        actorUid: 'user-1',
        authorizedPermission: 'projects:view',
        allowedProjectIds: ['project-a'],
      })
    ).toEqual([records[0]]);
    expect(
      filterWorkspaceSnapshotRecords('ai_inventory_drafts', records.slice(2), {
        actorUid: 'user-1',
        authorizedPermission: 'inventory:view',
        allowedProjectIds: ['project-a'],
      })
    ).toEqual([records[2]]);
  });

  it('limits basic lead viewers to their own leads and scopes all-lead viewers', () => {
    const leads: WorkspaceSnapshotRecord[] = [
      {
        id: 'lead-own',
        data: { assignedAgentUid: 'user-1', projectId: 'project-b' },
      },
      {
        id: 'lead-project',
        data: { assignedAgentUid: 'user-2', preferredProjectIds: ['project-a'] },
      },
      {
        id: 'lead-other',
        data: { assignedAgentUid: 'user-2', projectId: 'project-b' },
      },
    ];

    expect(
      filterWorkspaceSnapshotRecords('leads', leads, {
        actorUid: 'user-1',
        authorizedPermission: 'leads:view',
        allowedProjectIds: ['project-a'],
      })
    ).toEqual([leads[0]]);
    expect(
      filterWorkspaceSnapshotRecords('leads', leads, {
        actorUid: 'user-1',
        authorizedPermission: 'leads:view_all',
        allowedProjectIds: ['project-a'],
      })
    ).toEqual([leads[1]]);
  });
});
