import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import { formatInrCompact } from '@bharat-makaan/shared';
import { useMobileStore } from '../state/useMobileStore';
import {
  NativeCard,
  NativeEmptyState,
  ScreenHeader,
} from '../components/NativePrimitives';

const palette = DESIGN_TOKENS.colors.light;

export function DashboardScreen() {
  const { activeOrgId, organizations, projects } = useMobileStore();
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  const stats = projects.reduce(
    (acc, p) => {
      acc.totalUnits += p.stats?.totalUnits ?? 0;
      acc.availableUnits += p.stats?.availableUnits ?? 0;
      acc.bookedUnits += p.stats?.bookedUnits ?? 0;
      acc.leads += p.stats?.totalLeads ?? 0;
      acc.visits += p.stats?.totalSiteVisits ?? 0;
      acc.salesValue += p.stats?.bookedSalesValueInr ?? 0;
      acc.collections += p.stats?.collectionsVerifiedInr ?? 0;
      return acc;
    },
    {
      totalUnits: 0,
      availableUnits: 0,
      bookedUnits: 0,
      leads: 0,
      visits: 0,
      salesValue: 0,
      collections: 0,
    }
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={activeOrg ? activeOrg.name : 'Executive Dashboard'}
        subtitle="Real-time synchronized Firebase enterprise metrics"
      />
      <ScrollView contentContainerStyle={styles.body}>
        {projects.length === 0 ? (
          <NativeEmptyState
            title="No projects yet. Create your first project."
            description="All mobile metrics sync in real time with your organization's projects."
          />
        ) : (
          <>
            <NativeCard>
              <Text style={styles.metricLabel}>Available / Total Inventory</Text>
              <Text style={styles.metricValue}>
                {stats.availableUnits} / {stats.totalUnits} Units
              </Text>
              <Text style={styles.metricSub}>{stats.bookedUnits} Booked</Text>
            </NativeCard>

            <NativeCard>
              <Text style={styles.metricLabel}>Booked Sales & Collections</Text>
              <Text style={styles.metricValue}>{formatInrCompact(stats.salesValue)}</Text>
              <Text style={styles.metricSub}>
                Verified Collected: {formatInrCompact(stats.collections)}
              </Text>
            </NativeCard>

            <NativeCard>
              <Text style={styles.metricLabel}>Pipeline & Site Visits</Text>
              <Text style={styles.metricValue}>{stats.leads} Leads</Text>
              <Text style={styles.metricSub}>{stats.visits} Scheduled Visits</Text>
            </NativeCard>

            {projects.map((p) => (
              <NativeCard key={p.id}>
                <Text style={styles.projTitle}>
                  {p.name} ({p.code})
                </Text>
                <Text style={styles.metricSub}>
                  {p.locality}, {p.city} • RERA: {p.reraNumber}
                </Text>
              </NativeCard>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: 16 },
  metricLabel: { fontSize: 11, fontWeight: '600', color: palette.mutedForeground },
  metricValue: { fontSize: 22, fontWeight: '700', color: palette.primary, marginTop: 4 },
  metricSub: { fontSize: 12, color: palette.mutedForeground, marginTop: 4 },
  projTitle: { fontSize: 14, fontWeight: '700', color: palette.foreground },
});
