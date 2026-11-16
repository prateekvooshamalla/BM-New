import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { Bookmark, LogOut, Scale } from 'lucide-react';
import { BRAND_CONFIG } from '@bharat-makaan/config';
import { auth } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';
import { WorkspaceViewSwitcher } from '@/components/layout/WorkspaceViewSwitcher';

export function PublicPortalLayout() {
  const navigate = useNavigate();
  const {
    uid,
    isSuperAdmin,
    organizations,
    memberships,
    partnerMemberships,
    compareUnitIds,
  } = useTenantStore();

  const hasBuilderAccess =
    organizations.length > 0 || memberships.some((m) => m.status === 'ACTIVE');
  const hasPartnerAccess = partnerMemberships.some((p) => p.status === 'ACTIVE');

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="bm-container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              BM
            </span>
            <span className="text-base font-bold tracking-tight">{BRAND_CONFIG.name}</span>
          </Link>

          <nav className="hidden items-center gap-5 text-sm font-medium md:flex">
            <NavLink to="/buy" className="text-muted-foreground hover:text-foreground">
              Buy
            </NavLink>
            <NavLink to="/rent" className="text-muted-foreground hover:text-foreground">
              Rent
            </NavLink>
            <NavLink to="/projects" className="text-muted-foreground hover:text-foreground">
              Projects
            </NavLink>
            <NavLink
              to="/compare"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Scale className="h-3.5 w-3.5" />
              Compare {compareUnitIds.length > 0 && `(${compareUnitIds.length})`}
            </NavLink>
            {uid && (
              <>
                <NavLink
                  to="/saved"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  Saved
                </NavLink>
                <NavLink
                  to="/my-enquiries"
                  className="text-muted-foreground hover:text-foreground"
                >
                  My Enquiries
                </NavLink>
                <NavLink
                  to="/my-visits"
                  className="text-muted-foreground hover:text-foreground"
                >
                  My Visits
                </NavLink>
              </>
            )}
            <NavLink to="/pricing" className="text-muted-foreground hover:text-foreground">
              Builder Pricing
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            {uid ? (
              <>
                <WorkspaceViewSwitcher />
                {!hasBuilderAccess && !hasPartnerAccess && !isSuperAdmin && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/saved">My Shortlist</Link>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  title="Sign out"
                  aria-label="Sign out"
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/login">Sign In</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/register?persona=builder">For Builders</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-card py-12 text-xs text-muted-foreground">
        <div className="bm-container grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="space-y-2">
            <div className="text-sm font-bold text-foreground">{BRAND_CONFIG.name}</div>
            <p className="leading-relaxed">{BRAND_CONFIG.promise}</p>
          </div>
          <div className="space-y-2">
            <div className="font-semibold text-foreground">Customer Property Portal</div>
            <ul className="space-y-1.5">
              <li><Link to="/buy" className="hover:underline">Buy Properties</Link></li>
              <li><Link to="/rent" className="hover:underline">Rent Properties</Link></li>
              <li><Link to="/projects" className="hover:underline">Verified Projects</Link></li>
              <li><Link to="/saved" className="hover:underline">Saved Properties</Link></li>
              <li><Link to="/my-enquiries" className="hover:underline">My Enquiries &amp; Visits</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="font-semibold text-foreground">Builders &amp; Partners</div>
            <ul className="space-y-1.5">
              <li><Link to="/for-professionals" className="hover:underline">For Builders &amp; Agencies</Link></li>
              <li><Link to="/pricing" className="hover:underline">Builder Packages (₹5,999 / ₹4,999)</Link></li>
              <li>
                <Link
                  to={
                    hasBuilderAccess
                      ? '/builder/dashboard'
                      : uid
                        ? '/builder/onboarding'
                        : '/register?persona=builder'
                  }
                  className="hover:underline"
                >
                  {hasBuilderAccess ? 'Open Builder Workspace' : 'Builder Onboarding'}
                </Link>
              </li>
              <li><Link to={hasPartnerAccess ? '/partner/dashboard' : '/login?persona=partner'} className="hover:underline">Channel Partner Portal</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="font-semibold text-foreground">Company &amp; Support</div>
            <ul className="space-y-1.5">
              <li><Link to="/about" className="hover:underline">About Us</Link></li>
              <li><Link to="/contact" className="hover:underline">Contact Support</Link></li>
              <li><Link to="/login" className="hover:underline">Customer Sign In</Link></li>
            </ul>
          </div>
        </div>
        <div className="bm-container mt-8 border-t border-border pt-6 flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} {BRAND_CONFIG.legalEntity}. All rights reserved.</span>
          <span>Multi-Tenant Enterprise Real Estate SaaS</span>
        </div>
      </footer>
    </div>
  );
}
