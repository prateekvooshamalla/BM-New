import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import {
  isWithinMetaServiceWindow,
  type Conversation,
  type Message,
} from '@bharat-makaan/shared';
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

export function InboxScreen() {
  const { activeOrgId } = useMobileStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (!activeOrgId) return;
    const unsub = onSnapshot(
      query(
        collection(mobileDb, 'conversations'),
        where('orgId', '==', activeOrgId),
        orderBy('updatedAt', 'desc')
      ),
      (snap) => setConversations(snap.docs.map((d) => d.data() as Conversation)),
      () => setConversations([])
    );
    return () => unsub();
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId || !selectedConv) {
      setMessages([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(mobileDb, 'messages'),
        where('orgId', '==', activeOrgId),
        where('conversationId', '==', selectedConv.id),
        orderBy('createdAt', 'asc')
      ),
      (snap) => setMessages(snap.docs.map((d) => d.data() as Message))
    );
    return () => unsub();
  }, [activeOrgId, selectedConv]);

  const sendReply = async () => {
    if (!activeOrgId || !selectedConv) return;
    const windowOpen = isWithinMetaServiceWindow(selectedConv.lastCustomerMessageAt);
    await callMobileBackend('sendWhatsappMessage', {
      orgId: activeOrgId,
      conversationId: selectedConv.id,
      messageType: windowOpen ? 'TEXT' : 'TEMPLATE',
      templateName: windowOpen ? undefined : 'project_brochure_intro',
      content: replyText.trim() || 'Namaste! Sharing project details via approved template.',
    });
    setReplyText('');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="WhatsApp Shared Inbox"
        subtitle="Meta Cloud API threads with 24h window & AI approval gate"
      />
      <ScrollView contentContainerStyle={styles.body}>
        {selectedConv ? (
          <View>
            <NativeButton
              variant="outline"
              label="← Back to Threads"
              onPress={() => setSelectedConv(null)}
            />
            <View style={{ marginVertical: 12 }}>
              {messages.map((m) => (
                <NativeCard key={m.id}>
                  <Text style={styles.msgMeta}>
                    {m.direction} • {m.deliveryStatus}
                  </Text>
                  <Text style={styles.msgBody}>{m.content}</Text>
                </NativeCard>
              ))}
            </View>
            <NativeInput
              placeholder="Write reply or leave blank to send template..."
              value={replyText}
              onChangeText={setReplyText}
            />
            <NativeButton label="Send WhatsApp Message" onPress={sendReply} />
          </View>
        ) : conversations.length === 0 ? (
          <NativeEmptyState
            title="No WhatsApp account connected."
            description="Conversations synchronize automatically when Meta WhatsApp Cloud API is active."
          />
        ) : (
          conversations.map((c) => (
            <NativeCard key={c.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.name}>{c.customerName}</Text>
                <NativeStatusPill status={c.optInStatus} />
              </View>
              <Text style={styles.msgMeta}>{c.customerPhone}</Text>
              <Text style={styles.msgBody}>{c.lastMessagePreview || 'Open conversation'}</Text>
              <View style={{ marginTop: 8 }}>
                <NativeButton
                  variant="outline"
                  label="Open Thread"
                  onPress={() => setSelectedConv(c)}
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
  msgMeta: { fontSize: 11, color: palette.mutedForeground },
  msgBody: { fontSize: 13, color: palette.foreground, marginTop: 4 },
});
