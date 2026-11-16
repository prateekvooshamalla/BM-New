import { Link, NavLink, Outlet } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { BRAND_CONFIG } from '@bharat-makaan/config';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';

export function PublicPortalLayout() {
  const { uid, compareUnitIds } = useTenantStore();

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

          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            <NavLink to="/buy" className="text-muted-foreground hover:text-foreground">
              Buy
            </NavLink>
            <NavLink to="/rent" className="text-muted-foreground hover:text-foreground">
              Rent
            </NavLink>
            <NavLink to="/projects" className="text-muted-foreground hover:text-foreground">
              Projects
            </NavLink>
            <NavLink to="/compare" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <Scale className="h-3.5 w-3.5" />
              Compare {compareUnitIds.length > 0 && `(${compareUnitIds.length})`}
            </NavLink>
            <NavLink to="/for-professionals" className="text-muted-foreground hover:text-foreground">
              For Professionals
            </NavLink>
            <NavLink to="/pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </NavLink>
            <NavLink to="/about" className="text-muted-foreground hover:text-foreground">
              About
            </NavLink>
            <NavLink to="/contact" className="text-muted-foreground hover:text-foreground">
              Contact
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            {uid ? (
              <Button size="sm" asChild>
                <Link to="/app/dashboard">Enterprise Console</Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/auth/login">Sign In</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/auth/register">Manage with AI</Link>
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
            <div className="font-semibold text-foreground">Property Discovery</div>
            <ul className="space-y-1.5">
              <li><Link to="/buy" className="hover:underline">Buy Properties</Link></li>
              <li><Link to="/rent" className="hover:underline">Rent Properties</Link></li>
              <li><Link to="/projects" className="hover:underline">Verified RERA Projects</Link></li>
              <li><Link to="/compare" className="hover:underline">Compare Properties</Link></li>
              <li><Link to="/book-visit" className="hover:underline">Book Site Visit</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="font-semibold text-foreground">Enterprise Platform</div>
            <ul className="space-y-1.5">
              <li><Link to="/for-professionals" className="hover:underline">For Builders & Agents</Link></li>
              <li><Link to="/pricing" className="hover:underline">SaaS Plans & Pricing</Link></li>
              <li><Link to="/partner/dashboard" className="hover:underline">Channel Partner Portal</Link></li>
              <li><Link to="/app/dashboard" className="hover:underline">Builder Workspace</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="font-semibold text-foreground">Company & Support</div>
            <ul className="space-y-1.5">
              <li><Link to="/about" className="hover:underline">About Us</Link></li>
              <li><Link to="/contact" className="hover:underline">Contact Support</Link></li>
              <li><Link to="/auth/login" className="hover:underline">Sign In / Register</Link></li>
            </ul>
          </div>
        </div>
        <div className="bm-container mt-8 border-t border-border pt-6 flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} {BRAND_CONFIG.legalEntity}. All rights reserved.</span>
          <span>RERA-Compliant Multi-Builder Enterprise Cloud</span>
        </div>
      </footer>
    </div>
  );
}
