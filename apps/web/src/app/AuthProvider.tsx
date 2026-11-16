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
} from '@bharat-makaan/shared';
import { auth, callBackendFunction, db, isEmulatorMode, isFirebaseConfigured } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setAuthContext = useTenantStore((s) => s.setAuthContext);
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

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        resetSession();
        return;
      }

      try {
        const tokenResult = await user.getIdTokenResult();
        const isSuperAdmin = tokenResult.claims.platformRole === 'PLATFORM_SUPER_ADMIN';
        const mfaCount = multiFactor(user).enrolledFactors.length;

        setAuthContext({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          isSuperAdmin,
          mfaEnrolledCount: mfaCount,
          isAuthLoading: false,
        });

        // Sync pending invitations & fetch memberships
        try {
          const synced = await callBackendFunction<
            Record<string, never>,
            {
              orgMemberships: OrganizationMember[];
              partnerMemberships: PartnerMember[];
            }
          >('syncMySessionMemberships', {});

          const activeMemberships = synced.orgMemberships.filter((m) => m.status === 'ACTIVE');
          const orgDocs = await Promise.all(
            activeMemberships.map((m) => getDoc(doc(db, 'organizations', m.orgId)))
          );
          const orgs = orgDocs
            .filter((snap) => snap.exists())
            .map((snap) => snap.data() as Organization);

          setOrganizationsAndMemberships(orgs, activeMemberships);

          if (synced.partnerMemberships.length > 0) {
            const firstPartner = synced.partnerMemberships[0]!;
            const poSnap = await getDoc(doc(db, 'partner_organizations', firstPartner.partnerOrgId));
            setPartnerContext(
              synced.partnerMemberships,
              poSnap.exists() ? (poSnap.data() as PartnerOrganization) : null
            );
          }
        } catch {
          // Fallback to direct Firestore query if callable is cold-starting
          const memQ = query(
            collection(db, 'organization_members'),
            where('uid', '==', user.uid)
          );
          onSnapshot(memQ, async (snap) => {
            const members = snap.docs
              .map((d) => d.data() as OrganizationMember)
              .filter((m) => m.status === 'ACTIVE');
            const orgSnaps = await Promise.all(
              members.map((m) => getDoc(doc(db, 'organizations', m.orgId)))
            );
            const orgs = orgSnaps
              .filter((s) => s.exists())
              .map((s) => s.data() as Organization);
            setOrganizationsAndMemberships(orgs, members);
          });
        }
      } catch {
        setAuthContext({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          isSuperAdmin: false,
          mfaEnrolledCount: 0,
          isAuthLoading: false,
        });
      }
    });

    return () => unsubAuth();
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

  return <>{children}</>;
}
