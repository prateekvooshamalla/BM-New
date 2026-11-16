import { create } from 'zustand';
import {
  hasPermission,
  type Organization,
  type OrganizationMember,
  type PermissionKey,
  type Project,
} from '@bharat-makaan/shared';

export const MOBILE_MORE_FEATURES: Array<{
  key: string;
  title: string;
  subtitle: string;
  permission: PermissionKey;
}> = [
  {
    key: 'AiAssistant',
    title: 'AI Assistant & Floor-Plan Wizard',
    subtitle: 'Natural-language CRM queries, tower setup & PDF plan extraction',
    permission: 'inventory:view',
  },
  {
    key: 'PricingQuotations',
    title: 'Pricing & Quotations',
    subtitle: 'Active price books & customer cost sheets',
    permission: 'quotations:view',
  },
  {
    key: 'SiteVisits',
    title: 'Site Visits',
    subtitle: 'Field agenda, confirmations & visit outcomes',
    permission: 'visits:view',
  },
  {
    key: 'ChannelPartners',
    title: 'Channel Partners',
    subtitle: 'Protected partner registrations & commissions',
    permission: 'partners:view',
  },
  {
    key: 'BookingsCollections',
    title: 'Bookings & Collections',
    subtitle: 'Active unit bookings & verified customer ledger',
    permission: 'bookings:view',
  },
  {
    key: 'Documents',
    title: 'Documents & Floor Plans',
    subtitle: 'Upload site photos/PDFs & share approved plans',
    permission: 'documents:view',
  },
  {
    key: 'Reports',
    title: 'Reports & Audit',
    subtitle: 'Live project performance & audit feed',
    permission: 'reports:view',
  },
  {
    key: 'Settings',
    title: 'Settings & Notifications',
    subtitle: 'Organization switcher, push alerts & sign out',
    permission: 'dashboard:view',
  },
];

export function filterAuthorizedMobileMoreFeatures(
  member: OrganizationMember | null,
  isSuperAdmin: boolean
) {
  return MOBILE_MORE_FEATURES.filter(
    (item) =>
      isSuperAdmin ||
      hasPermission(
        member
          ? {
              status: member.status,
              role: member.role,
              permissions: member.permissions,
              assignedProjectIds: member.assignedProjectIds,
            }
          : null,
        item.permission
      )
  );
}

interface MobileState {
  uid: string | null;
  email: string | null;
  isSuperAdmin: boolean;
  organizations: Organization[];
  memberships: OrganizationMember[];
  activeOrgId: string | null;
  activeMember: OrganizationMember | null;
  projects: Project[];
  activeProjectId: string | null;

  setUser: (uid: string | null, email: string | null, isSuperAdmin: boolean) => void;
  setOrgsAndMemberships: (
    orgs: Organization[],
    members: OrganizationMember[],
    preferredOrgId?: string | null
  ) => void;
  selectOrg: (orgId: string) => void;
  setProjects: (projects: Project[]) => void;
  selectProject: (projectId: string | null) => void;
  clear: () => void;
}

export const useMobileStore = create<MobileState>((set) => ({
  uid: null,
  email: null,
  isSuperAdmin: false,
  organizations: [],
  memberships: [],
  activeOrgId: null,
  activeMember: null,
  projects: [],
  activeProjectId: null,

  setUser: (uid, email, isSuperAdmin) => set({ uid, email, isSuperAdmin }),

  setOrgsAndMemberships: (orgs, members, preferredOrgId) =>
    set(() => {
      const targetId =
        preferredOrgId && orgs.some((o) => o.id === preferredOrgId)
          ? preferredOrgId
          : (orgs[0]?.id ?? null);
      return {
        organizations: orgs,
        memberships: members,
        activeOrgId: targetId,
        activeMember: members.find((m) => m.orgId === targetId) ?? null,
      };
    }),

  selectOrg: (orgId) =>
    set((state) => ({
      activeOrgId: orgId,
      activeMember: state.memberships.find((m) => m.orgId === orgId) ?? null,
      activeProjectId: null,
      projects: [],
    })),

  setProjects: (projects) =>
    set((state) => ({
      projects,
      activeProjectId:
        state.activeProjectId && projects.some((p) => p.id === state.activeProjectId)
          ? state.activeProjectId
          : (projects[0]?.id ?? null),
    })),

  selectProject: (projectId) => set({ activeProjectId: projectId }),

  clear: () =>
    set({
      uid: null,
      email: null,
      isSuperAdmin: false,
      organizations: [],
      memberships: [],
      activeOrgId: null,
      activeMember: null,
      projects: [],
      activeProjectId: null,
    }),
}));
