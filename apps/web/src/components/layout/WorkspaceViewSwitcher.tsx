import { Link, useLocation } from 'react-router-dom';
import { Building2, Handshake, ShieldCheck, UserRound } from 'lucide-react';
import { useTenantStore } from '@/state/useTenantStore';

export function WorkspaceViewSwitcher() {
  const location = useLocation();
  const {
    uid,
    isAuthLoading,
    isSuperAdmin,
    organizations,
    activeOrganization,
    memberships,
    partnerMemberships,
  } = useTenantStore();

  if (!uid || isAuthLoading) {
    return null;
  }

  const hasBuilderAccess =
    organizations.length > 0 || memberships.some((m) => m.status === 'ACTIVE');
  const hasPartnerAccess = partnerMemberships.some((p) => p.status === 'ACTIVE');

  // Pure customer accounts without builder/partner/admin roles stay strictly in Customer view
  if (!hasBuilderAccess && !hasPartnerAccess && !isSuperAdmin) {
    return null;
  }

  const pathname = location.pathname;
  const isBuilderView = pathname.startsWith('/builder') || pathname.startsWith('/app');
  const isPartnerView = pathname.startsWith('/partner');
  const isAdminView = pathname.startsWith('/admin') || pathname.startsWith('/super-admin');
  const isCustomerView = !isBuilderView && !isPartnerView && !isAdminView;

  return (
    <div
      role="navigation"
      aria-label="View Mode Switcher"
      className="inline-flex items-center rounded-lg border border-border bg-secondary/60 p-0.5 text-xs"
    >
      <Link
        to="/"
        title="Browse public property portal as Customer"
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
          isCustomerView
            ? 'bg-background text-foreground shadow-xs font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0" />
        <span>View as Customer</span>
      </Link>

      {(hasBuilderAccess || isSuperAdmin) && (
        <Link
          to="/builder/dashboard"
          title={
            activeOrganization?.name
              ? `Switch to Builder Workspace (${activeOrganization.name})`
              : 'Switch to Builder Workspace'
          }
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
            isBuilderView
              ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span>View as Builder</span>
        </Link>
      )}

      {hasPartnerAccess && (
        <Link
          to="/partner/dashboard"
          title="Switch to Channel Partner Portal"
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
            isPartnerView
              ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Handshake className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Partner</span>
        </Link>
      )}

      {isSuperAdmin && (
        <Link
          to="/admin/dashboard"
          title="Switch to Platform Super Admin Console"
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
            isAdminView
              ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Admin</span>
        </Link>
      )}
    </div>
  );
}
