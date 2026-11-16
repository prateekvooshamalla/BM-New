import * as React from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, KeyRound, Shield, UserPlus, UserX } from 'lucide-react';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  type OrganizationMember,
  type PermissionKey,
  type RoleKey,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PermissionGate } from '@/components/shared/PermissionGate';

export function StaffManagementPanel() {
  const { activeOrgId, projects } = useTenantStore();
  const [members, setMembers] = React.useState<OrganizationMember[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Modals
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [editMember, setEditMember] = React.useState<OrganizationMember | null>(null);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [feedbackBanner, setFeedbackBanner] = React.useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteName, setInviteName] = React.useState('');
  const [invitePhone, setInvitePhone] = React.useState('');
  const [inviteDepartment, setInviteDepartment] = React.useState('');
  const [inviteManagerUid, setInviteManagerUid] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<RoleKey>('SALES_EXECUTIVE');
  const [invitePermissions, setInvitePermissions] = React.useState<PermissionKey[]>([
    ...DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE,
  ]);
  const [inviteProjects, setInviteProjects] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  // Lead transfer state
  const [fromUid, setFromUid] = React.useState('');
  const [toUid, setToUid] = React.useState('');
  const [transferReason, setTransferReason] = React.useState('');

  React.useEffect(() => {
    if (!activeOrgId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'organization_members'), where('orgId', '==', activeOrgId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as OrganizationMember));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [activeOrgId]);

  const handleRoleSelect = (role: RoleKey) => {
    setInviteRole(role);
    setInvitePermissions([...DEFAULT_ROLE_PERMISSIONS[role]]);
  };

  const togglePerm = (perm: PermissionKey, list: PermissionKey[], setter: (p: PermissionKey[]) => void) => {
    if (list.includes(perm)) {
      setter(list.filter((p) => p !== perm));
    } else {
      setter([...list, perm]);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setSubmitting(true);
    setFeedbackBanner(null);
    try {
      await callBackendFunction('inviteStaffMember', {
        orgId: activeOrgId,
        email: inviteEmail,
        displayName: inviteName,
        phone: invitePhone,
        role: inviteRole,
        permissions: invitePermissions,
        assignedProjectIds: inviteProjects,
        department: inviteDepartment,
        managerUid: inviteManagerUid || undefined,
      });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteName('');
      setInvitePhone('');
      setInviteDepartment('');
      setFeedbackBanner(`Invited ${inviteName} (${inviteEmail}) successfully.`);
    } catch (err) {
      setFeedbackBanner(err instanceof Error ? err.message : 'Invitation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (
    member: OrganizationMember,
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'
  ) => {
    if (!activeOrgId) return;
    try {
      await callBackendFunction('updateMemberAccess', {
        orgId: activeOrgId,
        targetUid: member.uid,
        status,
      });
      setFeedbackBanner(`Updated ${member.displayName} status to ${status}.`);
    } catch (err) {
      setFeedbackBanner(err instanceof Error ? err.message : 'Failed to update member status.');
    }
  };

  const handleSavePermissions = async () => {
    if (!activeOrgId || !editMember) return;
    setSubmitting(true);
    try {
      await callBackendFunction('updateMemberAccess', {
        orgId: activeOrgId,
        targetUid: editMember.uid,
        role: editMember.role,
        permissions: editMember.permissions,
        assignedProjectIds: editMember.assignedProjectIds,
        department: editMember.department,
      });
      setEditMember(null);
      setFeedbackBanner(`Updated permissions for ${editMember.displayName}.`);
    } catch (err) {
      setFeedbackBanner(err instanceof Error ? err.message : 'Failed to update permissions.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (email: string) => {
    if (!activeOrgId) return;
    try {
      const res = await callBackendFunction<
        { orgId: string; targetEmail: string },
        { resetLink: string }
      >('generateEmployeePasswordReset', {
        orgId: activeOrgId,
        targetEmail: email,
      });
      setFeedbackBanner(`Password reset link generated for ${email}: ${res.resetLink}`);
    } catch (err) {
      setFeedbackBanner(err instanceof Error ? err.message : 'Password reset failed.');
    }
  };

  const handleLeadTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setSubmitting(true);
    try {
      const res = await callBackendFunction<
        { orgId: string; fromAgentUid: string; toAgentUid: string; reason: string },
        { transferredCount: number }
      >('transferEmployeeLeads', {
        orgId: activeOrgId,
        fromAgentUid: fromUid,
        toAgentUid: toUid,
        reason: transferReason,
      });
      setTransferOpen(false);
      setTransferReason('');
      setFeedbackBanner(`Transferred ${res.transferredCount} leads successfully.`);
    } catch (err) {
      setFeedbackBanner(err instanceof Error ? err.message : 'Lead transfer failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<OrganizationMember>[] = [
    {
      accessorKey: 'displayName',
      header: 'Employee',
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-foreground">{row.original.displayName}</div>
          <div className="text-xs text-muted-foreground">{row.original.email}</div>
        </div>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Role & Department',
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-semibold text-foreground">
            {ROLE_LABELS[row.original.role] ?? row.original.role}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {row.original.department || 'All Departments'}
          </div>
        </div>
      ),
    },
    {
      id: 'scope',
      header: 'Project Scope',
      cell: ({ row }) => {
        const count = row.original.assignedProjectIds?.length ?? 0;
        return (
          <span className="text-xs text-muted-foreground">
            {count === 0 ? 'All Projects' : `${count} Assigned Project(s)`}
          </span>
        );
      },
    },
    {
      id: 'permissionsCount',
      header: 'Permissions',
      cell: ({ row }) => (
        <span className="text-xs font-mono text-muted-foreground">
          {row.original.permissions.length} granted
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="flex items-center gap-1.5">
            <PermissionGate permission="staff:manage_permissions">
              <Button variant="outline" size="sm" onClick={() => setEditMember({ ...m })}>
                <Shield className="h-3.5 w-3.5" />
                Access
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Generate password reset link"
                onClick={() => handlePasswordReset(m.email)}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            </PermissionGate>
            <PermissionGate permission="staff:suspend">
              {m.status === 'ACTIVE' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => handleStatusChange(m, 'SUSPENDED')}
                >
                  <UserX className="h-3.5 w-3.5" />
                  Suspend
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleStatusChange(m, 'ACTIVE')}
                >
                  Reactivate
                </Button>
              )}
            </PermissionGate>
          </div>
        );
      },
    },
  ];

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={UserPlus}
        title="No organization selected."
        description="Create or select a builder organization first to manage staff, departments, and granular permissions."
      />
    );
  }

  return (
    <div className="space-y-4">
      {feedbackBanner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs text-foreground break-all">
          {feedbackBanner}
        </div>
      )}

      <DataTable
        columns={columns}
        data={members}
        isLoading={loading}
        searchPlaceholder="Search employees by name, email or role..."
        emptyMessage="No team members added yet. Invite your first employee."
        toolbarRight={
          <div className="flex items-center gap-2">
            <PermissionGate permission="staff:transfer_leads">
              <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Transfer Leads
              </Button>
            </PermissionGate>
            <PermissionGate permission="staff:invite">
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" />
                Invite Employee
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {/* Invite Employee Modal */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Invite Employee & Set Permissions</DialogTitle>
            <DialogDescription>
              Assign role, department, reporting manager, project scope, and granular permissions.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Full Name *</Label>
                <Input
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Aarav Sharma"
                />
              </div>
              <div className="space-y-1">
                <Label>Official Email *</Label>
                <Input
                  required
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="aarav@builder.com"
                />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                  placeholder="+91 9876543210"
                />
              </div>
              <div className="space-y-1">
                <Label>Department</Label>
                <Input
                  value={inviteDepartment}
                  onChange={(e) => setInviteDepartment(e.target.value)}
                  placeholder="Sales / CRM / Finance / Inventory"
                />
              </div>
              <div className="space-y-1">
                <Label>Role Template *</Label>
                <Select value={inviteRole} onValueChange={(v) => handleRoleSelect(v as RoleKey)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.filter((r) => r !== 'PLATFORM_SUPER_ADMIN' && r !== 'CUSTOMER').map(
                      (r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Reporting Manager</Label>
                <Select
                  value={inviteManagerUid || '__NONE__'}
                  onValueChange={(v) => setInviteManagerUid(v === '__NONE__' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">No Direct Manager</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.uid} value={m.uid}>
                        {m.displayName} ({ROLE_LABELS[m.role]})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {projects.length > 0 && (
              <div className="space-y-1.5">
                <Label>Assigned Projects (Leave unchecked for all projects)</Label>
                <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 max-h-28 overflow-y-auto">
                  {projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={inviteProjects.includes(p.id)}
                        onCheckedChange={() =>
                          setInviteProjects((prev) =>
                            prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                          )
                        }
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Granular Permissions ({invitePermissions.length} selected)</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-md border border-border p-3 max-h-44 overflow-y-auto">
                {PERMISSIONS.filter((p) => p !== 'platform:super_admin').map((perm) => (
                  <label key={perm} className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <Checkbox
                      checked={invitePermissions.includes(perm)}
                      onCheckedChange={() =>
                        togglePerm(perm, invitePermissions, setInvitePermissions)
                      }
                    />
                    <span className="truncate">{perm}</span>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending Invite...' : 'Invite Employee'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Member Access Modal */}
      <Dialog open={Boolean(editMember)} onOpenChange={(o) => !o && setEditMember(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Access — {editMember?.displayName}</DialogTitle>
            <DialogDescription>
              Modify role, department, project assignments, or granular permissions. All changes
              are recorded in the immutable audit trail.
            </DialogDescription>
          </DialogHeader>
          {editMember && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select
                    value={editMember.role}
                    onValueChange={(v) =>
                      setEditMember({
                        ...editMember,
                        role: v as RoleKey,
                        permissions: [...DEFAULT_ROLE_PERMISSIONS[v as RoleKey]],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.filter((r) => r !== 'PLATFORM_SUPER_ADMIN').map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Input
                    value={editMember.department ?? ''}
                    onChange={(e) =>
                      setEditMember({ ...editMember, department: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Permissions ({editMember.permissions.length})</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-md border border-border p-3 max-h-48 overflow-y-auto">
                  {PERMISSIONS.filter((p) => p !== 'platform:super_admin').map((perm) => (
                    <label key={perm} className="flex items-center gap-2 text-[11px] cursor-pointer">
                      <Checkbox
                        checked={editMember.permissions.includes(perm)}
                        onCheckedChange={() =>
                          togglePerm(perm, editMember.permissions, (next) =>
                            setEditMember({ ...editMember, permissions: next })
                          )
                        }
                      />
                      <span className="truncate">{perm}</span>
                    </label>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditMember(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSavePermissions} disabled={submitting}>
                  Save Access Policy
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Transfer Employee Leads Modal */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Employee Leads</DialogTitle>
            <DialogDescription>
              Reassign active leads and follow-ups from one team member to another with full audit
              history.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleLeadTransfer} className="space-y-3">
            <div className="space-y-1">
              <Label>Transfer From Employee *</Label>
              <Select value={fromUid} onValueChange={setFromUid}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outgoing employee" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.uid} value={m.uid}>
                      {m.displayName} ({m.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Transfer To Active Employee *</Label>
              <Select value={toUid} onValueChange={setToUid}>
                <SelectTrigger>
                  <SelectValue placeholder="Select receiving employee" />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => m.status === 'ACTIVE' && m.uid !== fromUid)
                    .map((m) => (
                      <SelectItem key={m.uid} value={m.uid}>
                        {m.displayName} ({m.email})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reason for Transfer *</Label>
              <Input
                required
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                placeholder="e.g., Role transition / territory realignment"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !fromUid || !toUid}>
                Transfer Leads
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
