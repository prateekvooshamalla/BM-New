import { create } from 'zustand';
import type {
  Organization,
  OrganizationMember,
  PartnerMember,
  PartnerOrganization,
  Project,
  TenantEntitlements,
} from '@bharat-makaan/shared';

export type ProjectScopeMode = 'ALL_PROJECTS' | 'PORTFOLIO_OVERVIEW' | 'SINGLE_PROJECT';

const STORAGE_PREFIX = 'bm_project_scope_';
const ACTIVE_ORG_STORAGE_PREFIX = 'bm_active_org_';

function readPersistedActiveOrgId(uid: string | null): string | null {
  if (!uid || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(`${ACTIVE_ORG_STORAGE_PREFIX}${uid}`);
  } catch {
    return null;
  }
}

function writePersistedActiveOrgId(uid: string | null, orgId: string | null): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    if (orgId) {
      window.localStorage.setItem(`${ACTIVE_ORG_STORAGE_PREFIX}${uid}`, orgId);
    } else {
      window.localStorage.removeItem(`${ACTIVE_ORG_STORAGE_PREFIX}${uid}`);
    }
  } catch {
    // Ignore storage quota errors
  }
}

function readPersistedProjectScope(orgId: string): {
  mode: ProjectScopeMode;
  projectId: string | null;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${orgId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { mode?: ProjectScopeMode; projectId?: string | null };
    if (
      parsed.mode === 'ALL_PROJECTS' ||
      parsed.mode === 'PORTFOLIO_OVERVIEW' ||
      parsed.mode === 'SINGLE_PROJECT'
    ) {
      return { mode: parsed.mode, projectId: parsed.projectId ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

function writePersistedProjectScope(
  orgId: string | null,
  mode: ProjectScopeMode,
  projectId: string | null
): void {
  if (!orgId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${orgId}`,
      JSON.stringify({ mode, projectId })
    );
  } catch {
    // Ignore storage quota errors
  }
}

interface TenantState {
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  isAuthLoading: boolean;
  isSuperAdmin: boolean;
  mfaEnrolledCount: number;
  pendingUnverifiedInvitationsCount: number;

  organizations: Organization[];
  memberships: OrganizationMember[];
  activeOrgId: string | null;
  activeOrganization: Organization | null;
  activeMember: OrganizationMember | null;
  activeEntitlements: TenantEntitlements | null;

  projects: Project[];
  projectScopeMode: ProjectScopeMode;
  activeProjectId: string | null;
  activeProject: Project | null;

  selectedContextTowerId: string | null;
  selectedContextUnitId: string | null;

  aiDrawerOpen: boolean;
  aiDrawerWidth: number;
  activeAiSessionId: string | null;
  aiInitialPrompt: string | null;

  partnerMemberships: PartnerMember[];
  activePartnerOrg: PartnerOrganization | null;

  compareUnitIds: string[];
  theme: 'light' | 'dark';

  setAuthContext: (ctx: {
    uid: string | null;
    email: string | null;
    emailVerified?: boolean;
    displayName: string | null;
    isSuperAdmin: boolean;
    mfaEnrolledCount: number;
    pendingUnverifiedInvitationsCount?: number;
    isAuthLoading: boolean;
  }) => void;
  setActiveEntitlements: (entitlements: TenantEntitlements | null) => void;
  setOrganizationsAndMemberships: (
    orgs: Organization[],
    members: OrganizationMember[]
  ) => void;
  selectOrganization: (orgId: string) => void;
  setProjects: (projects: Project[]) => void;
  selectProject: (projectId: string | null, mode?: ProjectScopeMode) => void;
  setSelectedContextEntity: (ctx: {
    towerId?: string | null;
    unitId?: string | null;
  }) => void;
  setAiDrawerOpen: (open: boolean, initialPrompt?: string | null) => void;
  setAiDrawerWidth: (width: number) => void;
  setActiveAiSessionId: (sessionId: string | null) => void;
  consumeAiInitialPrompt: () => string | null;
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
  emailVerified: false,
  displayName: null,
  isAuthLoading: true,
  isSuperAdmin: false,
  mfaEnrolledCount: 0,
  pendingUnverifiedInvitationsCount: 0,

  organizations: [],
  memberships: [],
  activeOrgId: null,
  activeOrganization: null,
  activeMember: null,
  activeEntitlements: null,

  projects: [],
  projectScopeMode: 'ALL_PROJECTS',
  activeProjectId: null,
  activeProject: null,

  selectedContextTowerId: null,
  selectedContextUnitId: null,

  aiDrawerOpen: false,
  aiDrawerWidth: 460,
  activeAiSessionId: null,
  aiInitialPrompt: null,

  partnerMemberships: [],
  activePartnerOrg: null,

  compareUnitIds: [],
  theme: 'light',

  setAuthContext: (ctx) => set((state) => ({ ...state, ...ctx })),
  setActiveEntitlements: (activeEntitlements) => set({ activeEntitlements }),

  setOrganizationsAndMemberships: (orgs, members) =>
    set((state) => {
      const persistedOrgId = readPersistedActiveOrgId(state.uid);
      const preferredOrgId =
        state.activeOrgId && orgs.some((o) => o.id === state.activeOrgId)
          ? state.activeOrgId
          : persistedOrgId && orgs.some((o) => o.id === persistedOrgId)
            ? persistedOrgId
            : (orgs[0]?.id ?? null);
      if (preferredOrgId) {
        writePersistedActiveOrgId(state.uid, preferredOrgId);
      }
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
      writePersistedActiveOrgId(state.uid, orgId);
      const activeOrganization = state.organizations.find((o) => o.id === orgId) ?? null;
      const activeMember = state.memberships.find((m) => m.orgId === orgId) ?? null;
      return {
        activeOrgId: orgId,
        activeOrganization,
        activeMember,
        projectScopeMode: 'ALL_PROJECTS',
        activeProjectId: null,
        activeProject: null,
        selectedContextTowerId: null,
        selectedContextUnitId: null,
        activeAiSessionId: null,
        projects: [],
      };
    }),

  setProjects: (projects) =>
    set((state) => {
      const persisted = state.activeOrgId
        ? readPersistedProjectScope(state.activeOrgId)
        : null;

      if (
        persisted &&
        (persisted.mode === 'ALL_PROJECTS' || persisted.mode === 'PORTFOLIO_OVERVIEW')
      ) {
        return {
          projects,
          projectScopeMode: persisted.mode,
          activeProjectId: null,
          activeProject: null,
        };
      }

      if (persisted?.mode === 'SINGLE_PROJECT' && persisted.projectId) {
        const matched = projects.find((p) => p.id === persisted.projectId) ?? null;
        if (matched) {
          return {
            projects,
            projectScopeMode: 'SINGLE_PROJECT',
            activeProjectId: matched.id,
            activeProject: matched,
          };
        }
      }

      if (state.activeProjectId && projects.some((p) => p.id === state.activeProjectId)) {
        const matched = projects.find((p) => p.id === state.activeProjectId) ?? null;
        return {
          projects,
          projectScopeMode: 'SINGLE_PROJECT',
          activeProjectId: matched?.id ?? null,
          activeProject: matched,
        };
      }

      // If exactly one project exists and user hasn't explicitly chosen ALL_PROJECTS, select it; otherwise preserve multi-project mode
      if (projects.length === 1 && state.projectScopeMode !== 'PORTFOLIO_OVERVIEW') {
        return {
          projects,
          projectScopeMode: 'SINGLE_PROJECT',
          activeProjectId: projects[0]!.id,
          activeProject: projects[0]!,
        };
      }

      return {
        projects,
        projectScopeMode: state.projectScopeMode,
        activeProjectId: null,
        activeProject: null,
      };
    }),

  selectProject: (projectId, explicitMode) =>
    set((state) => {
      const nextMode: ProjectScopeMode = projectId
        ? 'SINGLE_PROJECT'
        : (explicitMode ?? 'ALL_PROJECTS');
      const activeProject = projectId
        ? (state.projects.find((p) => p.id === projectId) ?? null)
        : null;
      writePersistedProjectScope(state.activeOrgId, nextMode, projectId);
      return {
        projectScopeMode: nextMode,
        activeProjectId: projectId,
        activeProject,
        selectedContextTowerId: null,
        selectedContextUnitId: null,
      };
    }),

  setSelectedContextEntity: (ctx) =>
    set((state) => ({
      selectedContextTowerId:
        ctx.towerId !== undefined ? ctx.towerId : state.selectedContextTowerId,
      selectedContextUnitId:
        ctx.unitId !== undefined ? ctx.unitId : state.selectedContextUnitId,
    })),

  setAiDrawerOpen: (open, initialPrompt) =>
    set((state) => ({
      aiDrawerOpen: open,
      aiInitialPrompt:
        initialPrompt !== undefined ? initialPrompt : state.aiInitialPrompt,
    })),

  setAiDrawerWidth: (width) =>
    set({
      aiDrawerWidth: Math.min(780, Math.max(360, Math.round(width))),
    }),

  setActiveAiSessionId: (sessionId) => set({ activeAiSessionId: sessionId }),

  consumeAiInitialPrompt: () => {
    const prompt = get().aiInitialPrompt;
    if (prompt) {
      set({ aiInitialPrompt: null });
    }
    return prompt;
  },

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
      activeEntitlements: null,
      emailVerified: false,
      pendingUnverifiedInvitationsCount: 0,
      projects: [],
      projectScopeMode: 'ALL_PROJECTS',
      activeProjectId: null,
      activeProject: null,
      selectedContextTowerId: null,
      selectedContextUnitId: null,
      aiDrawerOpen: false,
      activeAiSessionId: null,
      aiInitialPrompt: null,
      partnerMemberships: [],
      activePartnerOrg: null,
    }),
}));
