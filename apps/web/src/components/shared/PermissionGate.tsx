import * as React from 'react';
import { hasPermission, type PermissionKey } from '@bharat-makaan/shared';
import { useTenantStore } from '@/state/useTenantStore';

interface PermissionGateProps {
  permission: PermissionKey;
  projectId?: string | null;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function PermissionGate({
  permission,
  projectId,
  fallback = null,
  children,
}: PermissionGateProps) {
  const activeMember = useTenantStore((s) => s.activeMember);
  const isSuperAdmin = useTenantStore((s) => s.isSuperAdmin);

  const allowed =
    isSuperAdmin ||
    hasPermission(
      activeMember
        ? {
            status: activeMember.status,
            role: activeMember.role,
            permissions: activeMember.permissions,
            assignedProjectIds: activeMember.assignedProjectIds,
          }
        : null,
      permission,
      projectId
    );

  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
