import { create } from 'zustand';
import type {
  Organization,
  OrganizationMember,
  PartnerMember,
  PartnerOrganization,
  Project,
} from '@bharat-makaan/shared';

interface TenantState {
  uid: string | null;
  email: string | null;
  displayName: string | null;
  isAuthLoading: boolean;
  isSuperAdmin: boolean;
  mfaEnrolledCount: number;

  organizations: Organization[];
  memberships: OrganizationMember[];
  activeOrgId: string | null;
  activeOrganization: Organization | null;
  activeMember: OrganizationMember | null;

  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;

  partnerMemberships: PartnerMember[];
  activePartnerOrg: PartnerOrganization | null;

  compareUnitIds: string[];
  theme: 'light' | 'dark';

  setAuthContext: (ctx: {
    uid: string | null;
    email: string | null;
    displayName: string | null;
    isSuperAdmin: boolean;
    mfaEnrolledCount: number;
    isAuthLoading: boolean;
  }) => void;
  setOrganizationsAndMemberships: (
    orgs: Organization[],
    members: OrganizationMember[]
  ) => void;
  selectOrganization: (orgId: string) => void;
  setProjects: (projects: Project[]) => void;
  selectProject: (projectId: string | null) => void;
  setPartnerContext: (
    partnerMemberships: PartnerMember[],
    partnerOrg: PartnerOrganization | null
  ) => void;
  toggleCompareUnit: (unitId: string) => void;
  clearCompareUnits: () => void;
  toggleTheme: () => void;
  resetSession: () => void;
}

export const useTenantStore = create<TenantState>((set, get) => ({
  uid: null,
  email: null,
  displayName: null,
  isAuthLoading: true,
  isSuperAdmin: false,
  mfaEnrolledCount: 0,

  organizations: [],
  memberships: [],
  activeOrgId: null,
  activeOrganization: null,
  activeMember: null,

  projects: [],
  activeProjectId: null,
  activeProject: null,

  partnerMemberships: [],
  activePartnerOrg: null,

  compareUnitIds: [],
  theme: 'light',

  setAuthContext: (ctx) => set((state) => ({ ...state, ...ctx })),

  setOrganizationsAndMemberships: (orgs, members) =>
    set((state) => {
      const preferredOrgId =
        state.activeOrgId && orgs.some((o) => o.id === state.activeOrgId)
          ? state.activeOrgId
          : (orgs[0]?.id ?? null);
      const activeOrganization = orgs.find((o) => o.id === preferredOrgId) ?? null;
      const activeMember = members.find((m) => m.orgId === preferredOrgId) ?? null;
      return {
        organizations: orgs,
        memberships: members,
        activeOrgId: preferredOrgId,
        activeOrganization,
        activeMember,
      };
    }),

  selectOrganization: (orgId) =>
    set((state) => {
      const activeOrganization = state.organizations.find((o) => o.id === orgId) ?? null;
      const activeMember = state.memberships.find((m) => m.orgId === orgId) ?? null;
      return {
        activeOrgId: orgId,
        activeOrganization,
        activeMember,
        activeProjectId: null,
        activeProject: null,
        projects: [],
      };
    }),

  setProjects: (projects) =>
    set((state) => {
      const preferredProjectId =
        state.activeProjectId && projects.some((p) => p.id === state.activeProjectId)
          ? state.activeProjectId
          : (projects[0]?.id ?? null);
      const activeProject = projects.find((p) => p.id === preferredProjectId) ?? null;
      return {
        projects,
        activeProjectId: preferredProjectId,
        activeProject,
      };
    }),

  selectProject: (projectId) =>
    set((state) => ({
      activeProjectId: projectId,
      activeProject: projectId ? (state.projects.find((p) => p.id === projectId) ?? null) : null,
    })),

  setPartnerContext: (partnerMemberships, activePartnerOrg) =>
    set({ partnerMemberships, activePartnerOrg }),

  toggleCompareUnit: (unitId) =>
    set((state) => {
      if (state.compareUnitIds.includes(unitId)) {
        return { compareUnitIds: state.compareUnitIds.filter((id) => id !== unitId) };
      }
      if (state.compareUnitIds.length >= 4) {
        return { compareUnitIds: [...state.compareUnitIds.slice(1), unitId] };
      }
      return { compareUnitIds: [...state.compareUnitIds, unitId] };
    }),

  clearCompareUnits: () => set({ compareUnitIds: [] }),

  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', next === 'dark');
    }
    set({ theme: next });
  },

  resetSession: () =>
    set({
      uid: null,
      email: null,
      displayName: null,
      isAuthLoading: false,
      isSuperAdmin: false,
      mfaEnrolledCount: 0,
      organizations: [],
      memberships: [],
      activeOrgId: null,
      activeOrganization: null,
      activeMember: null,
      projects: [],
      activeProjectId: null,
      activeProject: null,
      partnerMemberships: [],
      activePartnerOrg: null,
    }),
}));
