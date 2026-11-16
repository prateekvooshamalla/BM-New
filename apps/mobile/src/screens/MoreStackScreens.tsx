import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import {
  formatInr,
  type Booking,
  type DocumentRecord,
  type PartnerOrganization,
  type Quotation,
  type SiteVisit,
} from '@bharat-makaan/shared';
import {
  clearSecureSession,
  mobileAuth,
  mobileDb,
  pickAndUploadFloorPlanPdf,
  pickAndUploadSitePhoto,
  registerDeviceForPushNotifications,
  saveSecureActiveOrgId,
} from '../services/firebase';
import {
  filterAuthorizedMobileMoreFeatures,
  useMobileStore,
} from '../state/useMobileStore';
import {
  NativeButton,
  NativeCard,
  NativeEmptyState,
  NativeStatusPill,
  ScreenHeader,
} from '../components/NativePrimitives';
import { AiAssistantScreen } from './AiAssistantScreen';

const palette = DESIGN_TOKENS.colors.light;

export function MoreStackScreen() {
  const {
    activeOrgId,
    activeProjectId,
    activeMember,
    isSuperAdmin,
    organizations,
    projects,
    selectOrg,
    clear,
  } = useMobileStore();

  const [subScreen, setSubScreen] = useState<string | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [partners, setPartners] = useState<PartnerOrganization[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const authorizedItems = filterAuthorizedMobileMoreFeatures(activeMember, isSuperAdmin);

  useEffect(() => {
    if (!activeOrgId) return;

    const uQt = onSnapshot(
      query(collection(mobileDb, 'quotations'), where('orgId', '==', activeOrgId)),
      (s) => setQuotations(s.docs.map((d) => d.data() as Quotation)),
      () => setQuotations([])
    );
    const uVs = onSnapshot(
      query(collection(mobileDb, 'site_visits'), where('orgId', '==', activeOrgId)),
      (s) => setVisits(s.docs.map((d) => d.data() as SiteVisit)),
      () => setVisits([])
    );
    const uPt = onSnapshot(
      query(
        collection(mobileDb, 'partner_organizations'),
        where('authorizedOrgIds', 'array-contains', activeOrgId)
      ),
      (s) => setPartners(s.docs.map((d) => d.data() as PartnerOrganization)),
      () => setPartners([])
    );
    const uBk = onSnapshot(
      query(collection(mobileDb, 'bookings'), where('orgId', '==', activeOrgId)),
      (s) => setBookings(s.docs.map((d) => d.data() as Booking)),
      () => setBookings([])
    );
    const uDc = onSnapshot(
      query(collection(mobileDb, 'documents'), where('orgId', '==', activeOrgId)),
      (s) => setDocuments(s.docs.map((d) => d.data() as DocumentRecord)),
      () => setDocuments([])
    );

    return () => {
      uQt();
      uVs();
      uPt();
      uBk();
      uDc();
    };
  }, [activeOrgId]);

  if (!subScreen) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title="More Enterprise Modules"
          subtitle="Role-gated tools synchronized with Bharat Makaan Cloud"
        />
        <ScrollView contentContainerStyle={styles.body}>
          {authorizedItems.map((item) => (
            <NativeCard key={item.key}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemSub}>{item.subtitle}</Text>
              <View style={{ marginTop: 10 }}>
                <NativeButton
                  variant="outline"
                  label={`Open ${item.title}`}
                  onPress={() => setSubScreen(item.key)}
                />
              </View>
            </NativeCard>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title={subScreen} subtitle="Tap back to return to authorized modules" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={{ marginBottom: 12 }}>
          <NativeButton
            variant="outline"
            label="← Back to More Menu"
            onPress={() => {
              setSubScreen(null);
              setNotice(null);
            }}
          />
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {subScreen === 'AiAssistant' && <AiAssistantScreen />}

        {subScreen === 'PricingQuotations' &&
          (quotations.length === 0 ? (
            <NativeEmptyState title="No approved price book or issued quotations yet." />
          ) : (
            quotations.map((q) => (
              <NativeCard key={q.id}>
                <Text style={styles.itemTitle}>
                  {q.quotationNumber} — Unit {q.unitNumber}
                </Text>
                <Text style={styles.itemSub}>
                  {q.customer.name} • {formatInr(q.totalPayableInr)}
                </Text>
                <NativeStatusPill status={q.status} />
              </NativeCard>
            ))
          ))}

        {subScreen === 'SiteVisits' &&
          (visits.length === 0 ? (
            <NativeEmptyState title="No site visits scheduled yet." />
          ) : (
            visits.map((v) => (
              <NativeCard key={v.id}>
                <Text style={styles.itemTitle}>{v.customerName}</Text>
                <Text style={styles.itemSub}>
                  {new Date(v.scheduledStartAt).toLocaleString()} • {v.customerPhone}
                </Text>
                <NativeStatusPill status={v.status} />
              </NativeCard>
            ))
          ))}

        {subScreen === 'ChannelPartners' &&
          (partners.length === 0 ? (
            <NativeEmptyState title="No channel partners onboarded yet." />
          ) : (
            partners.map((p) => (
              <NativeCard key={p.id}>
                <Text style={styles.itemTitle}>{p.companyName}</Text>
                <Text style={styles.itemSub}>
                  Leads: {p.metrics.registeredLeadsCount} • Eligible:{' '}
                  {formatInr(p.metrics.eligibleCommissionInr)}
                </Text>
              </NativeCard>
            ))
          ))}

        {subScreen === 'BookingsCollections' &&
          (bookings.length === 0 ? (
            <NativeEmptyState title="No active bookings yet." />
          ) : (
            bookings.map((b) => (
              <NativeCard key={b.id}>
                <Text style={styles.itemTitle}>
                  {b.bookingNumber} — Unit {b.unitNumber}
                </Text>
                <Text style={styles.itemSub}>
                  Collected {formatInr(b.totalCollectedVerifiedInr)} /{' '}
                  {formatInr(b.totalPayableInr)}
                </Text>
                <NativeStatusPill status={b.status} />
              </NativeCard>
            ))
          ))}

        {subScreen === 'Documents' && (
          <View>
            {activeOrgId && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <NativeButton
                  label="Upload Site Photo"
                  onPress={async () => {
                    try {
                      await pickAndUploadSitePhoto(activeOrgId, activeProjectId);
                      setNotice('Uploaded site photo to Firebase Storage.');
                    } catch (e) {
                      setNotice(e instanceof Error ? e.message : 'Upload cancelled.');
                    }
                  }}
                />
                <NativeButton
                  variant="outline"
                  label="Pick PDF Plan"
                  onPress={async () => {
                    try {
                      await pickAndUploadFloorPlanPdf(activeOrgId, activeProjectId);
                      setNotice('Uploaded PDF document.');
                    } catch (e) {
                      setNotice(e instanceof Error ? e.message : 'Upload cancelled.');
                    }
                  }}
                />
              </View>
            )}
            {documents.length === 0 ? (
              <NativeEmptyState title="No documents uploaded yet." />
            ) : (
              documents.map((d) => (
                <NativeCard key={d.id}>
                  <Text style={styles.itemTitle}>
                    {d.title} (v{d.currentVersion})
                  </Text>
                  <Text style={styles.itemSub}>
                    {d.category} • {d.visibility}
                  </Text>
                </NativeCard>
              ))
            )}
          </View>
        )}

        {subScreen === 'Reports' && (
          <NativeCard>
            <Text style={styles.itemTitle}>Portfolio Snapshot</Text>
            <Text style={styles.itemSub}>Active Projects: {projects.length}</Text>
            <Text style={styles.itemSub}>Issued Quotations: {quotations.length}</Text>
            <Text style={styles.itemSub}>Active Bookings: {bookings.length}</Text>
          </NativeCard>
        )}

        {subScreen === 'Settings' && (
          <View>
            {organizations.map((org) => (
              <NativeCard key={org.id}>
                <Text style={styles.itemTitle}>{org.name}</Text>
                <View style={{ marginTop: 8 }}>
                  <NativeButton
                    variant={org.id === activeOrgId ? 'primary' : 'outline'}
                    label={org.id === activeOrgId ? 'Active Organization' : 'Switch Organization'}
                    onPress={async () => {
                      selectOrg(org.id);
                      await saveSecureActiveOrgId(org.id);
                    }}
                  />
                </View>
              </NativeCard>
            ))}

            {activeOrgId && (
              <View style={{ marginBottom: 12 }}>
                <NativeButton
                  variant="outline"
                  label="Enable FCM Push Notifications"
                  onPress={async () => {
                    const tok = await registerDeviceForPushNotifications(activeOrgId);
                    setNotice(tok ? 'Push token registered.' : 'Notification permission declined.');
                  }}
                />
              </View>
            )}

            <NativeCard>
              <Text style={styles.itemSub}>
                SaaS Subscription Management is handled via the Enterprise Web Billing Portal in
                compliance with mobile app-store guidelines.
              </Text>
            </NativeCard>

            <NativeButton
              variant="danger"
              label="Sign Out"
              onPress={async () => {
                await clearSecureSession();
                await signOut(mobileAuth);
                clear();
              }}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: 16 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: palette.foreground },
  itemSub: { fontSize: 12, color: palette.mutedForeground, marginTop: 4 },
  notice: { fontSize: 12, color: palette.primary, marginBottom: 10 },
});
