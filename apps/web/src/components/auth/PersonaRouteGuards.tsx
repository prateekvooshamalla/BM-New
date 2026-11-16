import * as React from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Building2, Handshake, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  evaluatePersonaRouteAccess,
  resolveDefaultPostLoginRoute,
  type RouteAccessInput,
} from '@bharat-makaan/shared';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';

export { evaluatePersonaRouteAccess, resolveDefaultPostLoginRoute, type RouteAccessInput };

export function CustomerAuthGuard({ children }: { children?: React.ReactNode }) {
  const location = useLocation();
  const { uid, isAuthLoading } = useTenantStore();

  if (isAuthLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-xs text-muted-foreground">
        Verifying session...
      </div>
    );
  }

  if (!uid) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  return <>{children ?? <Outlet />}</>;
}

export function BuilderWorkspaceGuard({
  allowOnboardingWithoutOrg = false,
  children,
}: {
  allowOnboardingWithoutOrg?: boolean;
  children?: React.ReactNode;
}) {
  const location = useLocation();
  const {
    uid,
    isAuthLoading,
    isSuperAdmin,
    mfaEnrolledCount,
    memberships,
    emailVerified,
    pendingUnverifiedInvitationsCount,
  } = useTenantStore();

  if (isAuthLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-xs text-muted-foreground">
        Verifying builder workspace permissions...
      </div>
    );
  }

  const check = evaluatePersonaRouteAccess({
    uid,
    isSuperAdmin,
    mfaEnrolledCount,
    hasActiveBuilderMembership: memberships.some((m) => m.status === 'ACTIVE'),
    hasActivePartnerMembership: false,
    targetPersona: 'BUILDER',
    isBuilderOnboardingRoute: allowOnboardingWithoutOrg,
  });

  if (!check.allowed && check.redirectTo) {
    return (
      <Navigate
        to={`${check.redirectTo}&redirect=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  if (!check.allowed) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 space-y-5">
        <EmptyState
          icon={Building2}
          title="Builder Organization Access Required"
          description={
            !emailVerified && pendingUnverifiedInvitationsCount > 0
              ? 'You have a pending employee invitation, but your email address is not yet verified. Verify your email from your inbox and refresh to activate workspace access.'
              : 'Customer and unauthorized accounts cannot access private builder inventory, pricing, or administrative dashboards. Register a new builder company or accept a verified staff invitation to continue.'
          }
        />
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="sm" asChild>
            <Link to="/builder/onboarding">Register Builder Company</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Return to Property Portal</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}

export function PartnerWorkspaceGuard({ children }: { children?: React.ReactNode }) {
  const location = useLocation();
  const { uid, isAuthLoading, isSuperAdmin, mfaEnrolledCount, partnerMemberships } =
    useTenantStore();

  if (isAuthLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-xs text-muted-foreground">
        Verifying channel partner credentials...
      </div>
    );
  }

  const check = evaluatePersonaRouteAccess({
    uid,
    isSuperAdmin,
    mfaEnrolledCount,
    hasActiveBuilderMembership: false,
    hasActivePartnerMembership: partnerMemberships.some((p) => p.status === 'ACTIVE'),
    targetPersona: 'PARTNER',
  });

  if (!check.allowed && check.redirectTo) {
    return (
      <Navigate
        to={`${check.redirectTo}&redirect=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  if (!check.allowed) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 space-y-5">
        <EmptyState
          icon={Handshake}
          title="Authorized Channel Partner Membership Required"
          description="Channel partner dashboards require an explicit builder invitation and approved project scope grant."
        />
        <div className="flex justify-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Return to Property Portal</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}

export function SuperAdminGuard({ children }: { children?: React.ReactNode }) {
  const { uid, isAuthLoading, isSuperAdmin, mfaEnrolledCount } = useTenantStore();

  if (isAuthLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-xs text-muted-foreground">
        Verifying Platform Super Admin authorization...
      </div>
    );
  }

  if (!uid) {
    return <Navigate to="/login?persona=admin" replace />;
  }

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 space-y-5">
        <EmptyState
          icon={ShieldCheck}
          title="Platform Super Admin Authorization Required"
          description="Ordinary customer, builder, and partner accounts are strictly prohibited from accessing Platform Governance."
        />
        <div className="flex justify-center">
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Return Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (mfaEnrolledCount === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 space-y-5">
        <EmptyState
          icon={ShieldAlert}
          title="Mandatory Multi-Factor Authentication (MFA) Required"
          description="Platform Super Admin governance requires an enrolled TOTP second factor. Enroll your authenticator in Security Settings before accessing /admin/*."
        />
        <div className="flex justify-center gap-3">
          <Button size="sm" asChild>
            <Link to="/builder/settings?tab=security">Enroll TOTP MFA Now</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}
