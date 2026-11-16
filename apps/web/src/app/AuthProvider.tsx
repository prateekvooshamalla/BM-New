import * as React from 'react';
import { onAuthStateChanged, multiFactor } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type {
  Organization,
  OrganizationMember,
  PartnerMember,
  PartnerOrganization,
  Project,
  TenantEntitlements,
} from '@bharat-makaan/shared';
import {
  auth,
  callBackendFunction,
  db,
  isEmulatorMode,
  isFirebaseConfigured,
} from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setAuthContext = useTenantStore((s) => s.setAuthContext);
  const setActiveEntitlements = useTenantStore((s) => s.setActiveEntitlements);
  const setOrganizationsAndMemberships = useTenantStore((s) => s.setOrganizationsAndMemberships);
  const setProjects = useTenantStore((s) => s.setProjects);
  const setPartnerContext = useTenantStore((s) => s.setPartnerContext);
  const resetSession = useTenantStore((s) => s.resetSession);
  const activeOrgId = useTenantStore((s) => s.activeOrgId);
  const activeMember = useTenantStore((s) => s.activeMember);
  const isSuperAdmin = useTenantStore((s) => s.isSuperAdmin);

  React.useEffect(() => {
    if (!isFirebaseConfigured && !isEmulatorMode) {
      setAuthContext({
        uid: null,
        email: null,
        displayName: null,
        isSuperAdmin: false,
        mfaEnrolledCount: 0,
        isAuthLoading: false,
      });
      return;
    }

    let cleanupUserListeners: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (cleanupUserListeners) {
        cleanupUserListeners();
        cleanupUserListeners = null;
      }

      if (!user) {
        resetSession();
        return;
      }

      // Keep `isAuthLoading: true` until initial memberships & organizations resolve so guards never flash onboarding!
      setAuthContext({
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        isSuperAdmin: false,
        mfaEnrolledCount: 0,
        isAuthLoading: true,
      });

      let cancelled = false;
      let settledInitialLoad = false;

      const markInitialLoadComplete = (extra?: {
        isSuperAdmin?: boolean;
        mfaEnrolledCount?: number;
        emailVerified?: boolean;
        pendingUnverifiedInvitationsCount?: number;
      }) => {
        if (cancelled) return;
        settledInitialLoad = true;
        const cur = useTenantStore.getState();
        setAuthContext({
          uid: user.uid,
          email: user.email,
          emailVerified: extra?.emailVerified ?? cur.emailVerified ?? user.emailVerified,
          displayName: user.displayName,
          isSuperAdmin: extra?.isSuperAdmin ?? cur.isSuperAdmin,
          mfaEnrolledCount: extra?.mfaEnrolledCount ?? cur.mfaEnrolledCount,
          pendingUnverifiedInvitationsCount:
            extra?.pendingUnverifiedInvitationsCount ?? cur.pendingUnverifiedInvitationsCount,
          isAuthLoading: false,
        });
      };

      try {
        const tokenResult = await user.getIdTokenResult();
        if (cancelled) return;
        const claimSuperAdmin = tokenResult.claims.platformRole === 'PLATFORM_SUPER_ADMIN';
        const mfaCount = multiFactor(user).enrolledFactors.length;

        setAuthContext({
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          displayName: user.displayName,
          isSuperAdmin: claimSuperAdmin,
          mfaEnrolledCount: mfaCount,
          isAuthLoading: true,
        });

        // 1. Fast real-time Firestore subscription to user's organization & partner memberships
        const memQ = query(
          collection(db, 'organization_members'),
          where('uid', '==', user.uid)
        );
        const unsubOrgMem = onSnapshot(
          memQ,
          async (snap) => {
            if (cancelled) return;
            const activeMemberships = snap.docs
              .map((d) => d.data() as OrganizationMember)
              .filter((m) => m.status === 'ACTIVE');

            const orgSnaps = await Promise.all(
              activeMemberships.map((m) =>
                getDoc(doc(db, 'organizations', m.orgId)).catch(() => null)
              )
            );
            if (cancelled) return;
            const orgs = orgSnaps
              .filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()))
              .map((s) => s.data() as Organization);

            // Merge with any server-hydrated orgs so transient client read issues never wipe active orgs
            const existingOrgs = useTenantStore.getState().organizations;
            const mergedOrgsMap = new Map<string, Organization>();
            for (const eo of existingOrgs) {
              if (activeMemberships.some((m) => m.orgId === eo.id)) {
                mergedOrgsMap.set(eo.id, eo);
              }
            }
            for (const o of orgs) {
              mergedOrgsMap.set(o.id, o);
            }

            setOrganizationsAndMemberships(
              Array.from(mergedOrgsMap.values()),
              activeMemberships
            );

            // Only mark loading complete immediately if we already found active memberships;
            // if empty, wait briefly for `syncMySessionMemberships` in case an INVITED membership is being claimed.
            if (activeMemberships.length > 0 && !settledInitialLoad) {
              markInitialLoadComplete({
                isSuperAdmin: claimSuperAdmin,
                mfaEnrolledCount: mfaCount,
              });
            }
          },
          () => {
            // Handled by `syncMySessionMemberships` server fallback below
          }
        );

        const partnerMemQ = query(
          collection(db, 'partner_members'),
          where('uid', '==', user.uid)
        );
        const unsubPartnerMem = onSnapshot(
          partnerMemQ,
          async (snap) => {
            if (cancelled) return;
            const pMembers = snap.docs
              .map((d) => d.data() as PartnerMember)
              .filter((p) => p.status === 'ACTIVE');
            if (pMembers.length > 0) {
              const poSnap = await getDoc(
                doc(db, 'partner_organizations', pMembers[0]!.partnerOrgId)
              ).catch(() => null);
              if (!cancelled) {
                setPartnerContext(
                  pMembers,
                  poSnap && poSnap.exists() ? (poSnap.data() as PartnerOrganization) : null
                );
              }
            }
          },
          () => {}
        );

        cleanupUserListeners = () => {
          cancelled = true;
          unsubOrgMem();
          unsubPartnerMem();
        };

        // 2. Authoritative backend session sync (activates INVITED memberships & returns server orgs directly)
        try {
          const synced = await callBackendFunction<
            Record<string, never>,
            {
              emailVerified?: boolean;
              pendingUnverifiedInvitationsCount?: number;
              orgMemberships: OrganizationMember[];
              organizations?: Organization[];
              partnerMemberships: PartnerMember[];
              partnerOrganizations?: PartnerOrganization[];
            }
          >('syncMySessionMemberships', {});

          if (cancelled) return;

          const activeMemberships = (synced.orgMemberships ?? []).filter(
            (m) => m.status === 'ACTIVE'
          );

          let orgs: Organization[] = synced.organizations ?? [];
          if (orgs.length === 0 && activeMemberships.length > 0) {
            const orgDocs = await Promise.all(
              activeMemberships.map((m) =>
                getDoc(doc(db, 'organizations', m.orgId)).catch(() => null)
              )
            );
            orgs = orgDocs
              .filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()))
              .map((s) => s.data() as Organization);
          }

          if (cancelled) return;
          setOrganizationsAndMemberships(orgs, activeMemberships);

          if ((synced.partnerMemberships ?? []).length > 0) {
            const firstPartner = synced.partnerMemberships[0]!;
            const serverPo = (synced.partnerOrganizations ?? []).find(
              (po) => po.id === firstPartner.partnerOrgId
            );
            if (serverPo) {
              setPartnerContext(synced.partnerMemberships, serverPo);
            } else {
              const poSnap = await getDoc(
                doc(db, 'partner_organizations', firstPartner.partnerOrgId)
              ).catch(() => null);
              if (!cancelled) {
                setPartnerContext(
                  synced.partnerMemberships,
                  poSnap && poSnap.exists() ? (poSnap.data() as PartnerOrganization) : null
                );
              }
            }
          }

          markInitialLoadComplete({
            isSuperAdmin: claimSuperAdmin,
            mfaEnrolledCount: mfaCount,
            emailVerified: synced.emailVerified ?? user.emailVerified,
            pendingUnverifiedInvitationsCount:
              synced.pendingUnverifiedInvitationsCount ?? 0,
          });
        } catch {
          // Callable unavailable or cold-started; finalize loading using Firestore snapshot state
          markInitialLoadComplete({
            isSuperAdmin: claimSuperAdmin,
            mfaEnrolledCount: mfaCount,
          });
        }
      } catch {
        markInitialLoadComplete({
          isSuperAdmin: false,
          mfaEnrolledCount: 0,
        });
      }
    });

    return () => {
      if (cleanupUserListeners) cleanupUserListeners();
      unsubAuth();
    };
  }, [
    resetSession,
    setAuthContext,
    setOrganizationsAndMemberships,
    setPartnerContext,
  ]);

  // Live project list subscription for active organization
  React.useEffect(() => {
    if (!activeOrgId) {
      setProjects([]);
      return;
    }

    const q = query(
      collection(db, 'projects'),
      where('orgId', '==', activeOrgId),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rawList = snap.docs.map((d) => d.data() as Project);
        const isUnrestrictedAdmin =
          isSuperAdmin ||
          activeMember?.role === 'PLATFORM_SUPER_ADMIN' ||
          activeMember?.role === 'BUILDER_ADMIN' ||
          activeMember?.role === 'PROJECT_DIRECTOR' ||
          !activeMember?.assignedProjectIds ||
          activeMember.assignedProjectIds.length === 0;
        const filtered = isUnrestrictedAdmin
          ? rawList
          : rawList.filter((p) => activeMember.assignedProjectIds.includes(p.id));
        setProjects(filtered);
      },
      () => {
        setProjects([]);
      }
    );

    return () => unsub();
  }, [activeMember, activeOrgId, isSuperAdmin, setProjects]);

  // Live entitlements & prepaid wallets subscription for active organization
  React.useEffect(() => {
    if (!activeOrgId) {
      setActiveEntitlements(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'entitlements', activeOrgId),
      (snap) => {
        setActiveEntitlements(snap.exists() ? (snap.data() as TenantEntitlements) : null);
      },
      () => setActiveEntitlements(null)
    );
    return () => unsub();
  }, [activeOrgId, setActiveEntitlements]);

  return <>{children}</>;
}
