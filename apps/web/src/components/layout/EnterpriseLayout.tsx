import * as React from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import {
  BarChart3,
  Building2,
  CalendarClock,
  Calculator,
  CarFront,
  FileText,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Plus,
  ReceiptIndianRupee,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { PRIMARY_WEB_NAVIGATION } from '@bharat-makaan/config';
import { hasPermission, type PermissionKey } from '@bharat-makaan/shared';
import { auth, isEmulatorMode, isFirebaseConfigured } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CreateOrganizationDialog } from '@/features/organizations/components/CreateOrganizationDialog';
import { AiAssistantDock } from '@/features/ai-assistant/components/AiAssistantDock';

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  'projects-inventory': Building2,
  parking: CarFront,
  'pricing-cost-sheets': Calculator,
  'leads-crm': Users,
  'whatsapp-inbox': MessageSquareText,
  'channel-partners': Handshake,
  'site-visits': CalendarClock,
  'bookings-collections': ReceiptIndianRupee,
  documents: FileText,
  'reports-audit': BarChart3,
  settings: Settings,
};

export function EnterpriseLayout() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [createOrgOpen, setCreateOrgOpen] = React.useState(false);

  const {
    email,
    displayName,
    isSuperAdmin,
    mfaEnrolledCount,
    organizations,
    activeOrgId,
    activeMember,
    projects,
    projectScopeMode,
    activeProjectId,
    aiDrawerOpen,
    partnerMemberships,
    theme,
    selectOrganization,
    selectProject,
    setAiDrawerOpen,
    toggleTheme,
  } = useTenantStore();

  const groupedNav = React.useMemo(() => {
    const groups = new Map<string, Array<(typeof PRIMARY_WEB_NAVIGATION)[number]>>();
    for (const item of PRIMARY_WEB_NAVIGATION) {
      const permitted =
        isSuperAdmin ||
        !activeMember ||
        hasPermission(
          {
            status: activeMember.status,
            role: activeMember.role,
            permissions: activeMember.permissions,
            assignedProjectIds: activeMember.assignedProjectIds,
          },
          item.permission as PermissionKey
        );
      if (!permitted) continue;
      const existing = groups.get(item.group) ?? [];
      existing.push(item);
      groups.set(item.group, existing);
    }
    return Array.from(groups.entries());
  }, [activeMember, isSuperAdmin]);

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/auth/login');
  };

  const showMfaWarning =
    Boolean(activeMember?.mfaRequired || isSuperAdmin) && mfaEnrolledCount === 0;

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Brand Header */}
      <div className="flex h-15 items-center justify-between border-b border-sidebar-border px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            BM
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-foreground">Bharat Makaan</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Enterprise Cloud
            </div>
          </div>
        </Link>
        <button
          type="button"
          className="rounded-md p-1 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Organization Switcher */}
      <div className="border-b border-sidebar-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Builder Organization
          </span>
          <button
            type="button"
            onClick={() => setCreateOrgOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        {organizations.length > 0 && activeOrgId ? (
          <Select value={activeOrgId} onValueChange={selectOrganization}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select organization" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name} ({org.headquartersCity})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => setCreateOrgOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Create Builder Organization
          </Button>
        )}
      </div>

      {/* Strictly 12 Primary Navigation Items (Grouped, Zero Duplication) */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4" aria-label="Primary Navigation">
        {groupedNav.map(([groupName, items]) => (
          <div key={groupName} className="space-y-0.5">
            <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {groupName}
            </div>
            {items.map((item) => {
              const Icon = NAV_ICONS[item.id] ?? FolderKanban;
              return (
                <NavLink
                  key={item.id}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `bm-nav-item ${isActive ? 'bg-sidebar-active text-sidebar-active-foreground font-semibold' : ''}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                      />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}

        {/* AI Workspace & Dedicated Console Switchers */}
        <div className="border-t border-sidebar-border pt-3 space-y-1">
          <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            AI &amp; Dedicated Consoles
          </div>
          <NavLink
            to="/app/ai-studio"
            onClick={() => setMobileMenuOpen(false)}
            className={({ isActive }) =>
              `bm-nav-item ${isActive ? 'bg-sidebar-active text-sidebar-active-foreground font-semibold' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                <Sparkles
                  className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <span>AI Floor-Plan Studio</span>
              </>
            )}
          </NavLink>
          {partnerMemberships.length > 0 && (
            <NavLink to="/partner/dashboard" className="bm-nav-item">
              <Handshake className="h-4 w-4 text-muted-foreground" />
              <span>Partner Agency Portal</span>
            </NavLink>
          )}
          {isSuperAdmin && (
            <NavLink to="/super-admin" className="bm-nav-item">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Platform Super Admin</span>
            </NavLink>
          )}
        </div>
      </nav>

      {/* Footer User Strip */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-foreground">
              {displayName || email || 'Enterprise User'}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {activeMember?.role.replace(/_/g, ' ') ??
                (isSuperAdmin ? 'Platform Super Admin' : 'No Organization Selected')}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="Sign out"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside className="bm-sidebar hidden w-64 shrink-0 md:block">{renderSidebarContent()}</aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="bm-dialog-overlay fixed inset-0"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="bm-sidebar relative z-10 w-64 max-w-[85vw]">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Context Bar */}
        <header className="sticky top-0 z-30 flex h-15 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>

            {activeOrgId && (
              <div className="flex items-center gap-2">
                <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
                  Project Context:
                </span>
                <Select
                  value={
                    activeProjectId
                      ? activeProjectId
                      : projectScopeMode === 'PORTFOLIO_OVERVIEW'
                        ? '__PORTFOLIO__'
                        : '__ALL__'
                  }
                  onValueChange={(val) => {
                    if (val === '__ALL__') {
                      selectProject(null, 'ALL_PROJECTS');
                    } else if (val === '__PORTFOLIO__') {
                      selectProject(null, 'PORTFOLIO_OVERVIEW');
                    } else {
                      selectProject(val, 'SINGLE_PROJECT');
                    }
                  }}
                >
                  <SelectTrigger className="h-8 w-[200px] sm:w-[250px] text-xs">
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ALL__">All Organization Projects</SelectItem>
                    <SelectItem value="__PORTFOLIO__">Portfolio Consolidated View</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.code}) — {p.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={aiDrawerOpen ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setAiDrawerOpen(!aiDrawerOpen)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Assistant</span>
            </Button>
            <Link
              to="/"
              className="hidden text-xs font-medium text-muted-foreground hover:text-foreground sm:inline px-2"
            >
              Public Portal
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title="Switch light/dark theme"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Environment / MFA Banners */}
        {!isFirebaseConfigured && !isEmulatorMode && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <strong>Firebase Configuration Pending:</strong> Populate{' '}
            <code>apps/web/.env.local</code> with your Firebase project credentials (or set{' '}
            <code>VITE_USE_FIREBASE_EMULATORS=true</code>) to enable live persistence.
          </div>
        )}

        {showMfaWarning && (
          <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50/80 px-6 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                Multi-Factor Authentication (MFA) is required for your privileged role. Please
                complete second-factor enrollment in Settings → Security & MFA.
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => navigate('/app/settings?tab=security')}
            >
              Configure MFA
            </Button>
          </div>
        )}

        {/* Routed Feature Page */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1400px] space-y-6">
            <Outlet />
          </div>
        </main>
      </div>

      <CreateOrganizationDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
      <AiAssistantDock />
    </div>
  );
}
