import React, { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import { formatAreaSqft, formatInr, type Unit } from '@bharat-makaan/shared';
import { callMobileBackend, mobileDb } from '../services/firebase';
import { useMobileStore } from '../state/useMobileStore';
import {
  NativeButton,
  NativeCard,
  NativeEmptyState,
  NativeInput,
  NativeStatusPill,
  ScreenHeader,
} from '../components/NativePrimitives';

const palette = DESIGN_TOKENS.colors.light;

export function InventoryScreen() {
  const { activeOrgId, activeProjectId, projects } = useMobileStore();
  const projectId = activeProjectId ?? projects[0]?.id ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrgId || !projectId) {
      setUnits([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(mobileDb, 'units'),
        where('orgId', '==', activeOrgId),
        where('projectId', '==', projectId)
      ),
      (snap) => setUnits(snap.docs.map((d) => d.data() as Unit)),
      () => setUnits([])
    );
    return () => unsub();
  }, [activeOrgId, projectId]);

  const filtered = units.filter((u) =>
    search.trim()
      ? u.unitNumber.toLowerCase().includes(search.trim().toLowerCase()) ||
        u.bhk.toLowerCase().includes(search.trim().toLowerCase())
      : true
  );

  const handleHold = async (u: Unit) => {
    if (!activeOrgId) return;
    setBusyId(u.id);
    try {
      await callMobileBackend('transitionUnitStatus', {
        orgId: activeOrgId,
        unitId: u.id,
        targetStatus: 'ON_HOLD',
        action: 'HOLD',
        holdDurationHours: 48,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleShare = async (u: Unit) => {
    await Share.share({
      message: `Unit ${u.unitNumber} (${u.bhk}, ${formatAreaSqft(u.saleableAreaSqft)}, ${u.facing}) — ${formatInr(u.calculatedTotalPrice)} [${u.status}]`,
    });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Visual Inventory"
        subtitle="Live unit availability, transactional holds & instant sharing"
      />
      <ScrollView contentContainerStyle={styles.body}>
        <NativeInput
          placeholder="Search by Unit # or BHK (e.g. 101, A-1204, 3 BHK)"
          value={search}
          onChangeText={setSearch}
        />

        {filtered.length === 0 ? (
          <NativeEmptyState
            title="No units added. Import or create inventory."
            description="Units synchronize live across web and mobile."
          />
        ) : (
          filtered.map((u) => (
            <NativeCard key={u.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.unitTitle}>
                  {u.unitNumber} — {u.bhk}
                </Text>
                <NativeStatusPill status={u.status} />
              </View>
              <Text style={styles.meta}>
                Floor {u.floorNumber} • {formatAreaSqft(u.saleableAreaSqft)} • {u.facing} Facing
              </Text>
              <Text style={styles.price}>{formatInr(u.calculatedTotalPrice)}</Text>
              <View style={styles.actions}>
                {u.status === 'AVAILABLE' && (
                  <NativeButton
                    label="Place 48h Hold"
                    loading={busyId === u.id}
                    onPress={() => handleHold(u)}
                  />
                )}
                <NativeButton
                  variant="outline"
                  label="Share Unit"
                  onPress={() => handleShare(u)}
                />
              </View>
            </NativeCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: 16 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  unitTitle: { fontSize: 15, fontWeight: '700', color: palette.foreground },
  meta: { fontSize: 12, color: palette.mutedForeground, marginTop: 4 },
  price: { fontSize: 16, fontWeight: '700', color: palette.primary, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
});
