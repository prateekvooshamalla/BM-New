import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import {
  hasPermission,
  type Organization,
  type OrganizationMember,
  type Project,
} from '@bharat-makaan/shared';
import {
  callMobileBackend,
  mobileAuth,
  mobileDb,
  readSecureActiveOrgId,
} from '../services/firebase';
import { useMobileStore } from '../state/useMobileStore';
import { AuthScreen } from '../screens/AuthScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { LeadsScreen } from '../screens/LeadsScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { MoreStackScreen } from '../screens/MoreStackScreens';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const palette = DESIGN_TOKENS.colors.light;

function MainBottomTabs() {
  const { activeMember, isSuperAdmin } = useMobileStore();

  const canPerm = (perm: any) =>
    isSuperAdmin ||
    !activeMember ||
    hasPermission(
      {
        status: activeMember.status,
        role: activeMember.role,
        permissions: activeMember.permissions,
        assignedProjectIds: activeMember.assignedProjectIds,
      },
      perm
    );

  // Strictly 5 Bottom Tabs: Dashboard, Inventory, Leads, Inbox, More
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.mutedForeground,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      {canPerm('inventory:view') && (
        <Tab.Screen name="Inventory" component={InventoryScreen} />
      )}
      {canPerm('leads:view') && <Tab.Screen name="Leads" component={LeadsScreen} />}
      {canPerm('whatsapp:view') && <Tab.Screen name="Inbox" component={InboxScreen} />}
      <Tab.Screen name="More" component={MoreStackScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const {
    uid,
    activeOrgId,
    setUser,
    setOrgsAndMemberships,
    setProjects,
    clear,
  } = useMobileStore();

  useEffect(() => {
    const unsub = onAuthStateChanged(mobileAuth, async (user) => {
      if (!user) {
        clear();
        return;
      }
      const tokenRes = await user.getIdTokenResult();
      const isSuperAdmin = tokenRes.claims.platformRole === 'PLATFORM_SUPER_ADMIN';
      setUser(user.uid, user.email, isSuperAdmin);

      try {
        const savedOrgId = await readSecureActiveOrgId();
        const synced = await callMobileBackend<
          Record<string, never>,
          { orgMemberships: OrganizationMember[] }
        >('syncMySessionMemberships', {});

        const active = synced.orgMemberships.filter((m) => m.status === 'ACTIVE');
        const orgSnaps = await Promise.all(
          active.map((m) => getDoc(doc(mobileDb, 'organizations', m.orgId)))
        );
        const orgs = orgSnaps
          .filter((s) => s.exists())
          .map((s) => s.data() as Organization);

        setOrgsAndMemberships(orgs, active, savedOrgId);
      } catch {
        // Fallback offline/cold-start handling
      }
    });
    return () => unsub();
  }, [clear, setOrgsAndMemberships, setUser]);

  useEffect(() => {
    if (!activeOrgId) {
      setProjects([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(mobileDb, 'projects'), where('orgId', '==', activeOrgId)),
      (snap) => setProjects(snap.docs.map((d) => d.data() as Project)),
      () => setProjects([])
    );
    return () => unsub();
  }, [activeOrgId, setProjects]);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {uid ? (
          <Stack.Screen name="EnterpriseTabs" component={MainBottomTabs} />
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
