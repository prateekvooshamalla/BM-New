import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { z } from 'zod';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import { formatInrCompact, type Lead } from '@bharat-makaan/shared';
import { createLeadSchema } from '@bharat-makaan/validation';
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
type CreateLeadValues = z.infer<typeof createLeadSchema>;

export function LeadsScreen() {
  const { activeOrgId } = useMobileStore();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [adding, setAdding] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateLeadValues>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: {
      orgId: activeOrgId ?? 'org',
      customerName: '',
      phone: '',
      source: 'MANUAL',
      preferredProjectIds: [],
      whatsappOptIn: true,
    },
  });

  useEffect(() => {
    if (!activeOrgId) return;
    const unsub = onSnapshot(
      query(
        collection(mobileDb, 'leads'),
        where('orgId', '==', activeOrgId),
        orderBy('updatedAt', 'desc')
      ),
      (snap) => setLeads(snap.docs.map((d) => d.data() as Lead)),
      () => setLeads([])
    );
    return () => unsub();
  }, [activeOrgId]);

  const onSubmit = async (values: CreateLeadValues) => {
    if (!activeOrgId) return;
    await callMobileBackend('createLead', { ...values, orgId: activeOrgId });
    reset();
    setAdding(false);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Leads & Field CRM"
        subtitle="Capture walk-ins, call buyers & sync pipeline stages"
      />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={{ marginBottom: 12 }}>
          <NativeButton
            label={adding ? 'Close Quick Lead Form' : '+ Capture Walk-In / Call Lead'}
            variant={adding ? 'outline' : 'primary'}
            onPress={() => setAdding(!adding)}
          />
        </View>

        {adding && (
          <NativeCard>
            <Controller
              control={control}
              name="customerName"
              render={({ field: { value, onChange } }) => (
                <NativeInput
                  label="Buyer Full Name *"
                  value={value}
                  onChangeText={onChange}
                  error={errors.customerName?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="phone"
              render={({ field: { value, onChange } }) => (
                <NativeInput
                  label="Mobile Number *"
                  keyboardType="phone-pad"
                  value={value}
                  onChangeText={onChange}
                  error={errors.phone?.message}
                />
              )}
            />
            <NativeButton
              label="Save Lead to Cloud CRM"
              loading={isSubmitting}
              onPress={handleSubmit(onSubmit)}
            />
          </NativeCard>
        )}

        {leads.length === 0 ? (
          <NativeEmptyState
            title="No leads received yet. Connect a lead source or create a form."
          />
        ) : (
          leads.map((lead) => (
            <NativeCard key={lead.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.name}>{lead.customerName}</Text>
                <NativeStatusPill status={lead.stage} />
              </View>
              <Text style={styles.meta}>
                {lead.normalizedPhone} • Score {lead.leadScore}/100 • {lead.source}
              </Text>
              {lead.budgetMaxInr ? (
                <Text style={styles.budget}>Budget: {formatInrCompact(lead.budgetMaxInr)}</Text>
              ) : null}
              <View style={styles.actions}>
                <NativeButton
                  variant="outline"
                  label="Call Buyer"
                  onPress={() => Linking.openURL(`tel:${lead.normalizedPhone}`)}
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
  name: { fontSize: 15, fontWeight: '700', color: palette.foreground },
  meta: { fontSize: 12, color: palette.mutedForeground, marginTop: 4 },
  budget: { fontSize: 13, fontWeight: '600', color: palette.primary, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
});
