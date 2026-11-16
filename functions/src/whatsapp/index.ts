import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  isWithinMetaServiceWindow,
  normalizeIndianPhone,
  type Conversation,
  type Message,
  type Organization,
} from '@bharat-makaan/shared';
import { adminDb } from '../shared/firebase-admin';
import { requireOrgPermission, type AuthenticatedActor } from '../shared/auth-guard';
import { writeAuditEvent } from '../audit';

export function verifyMetaWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algo, providedHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !providedHex) return false;

  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(providedHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function processInboundWhatsappEventService(
  db: Firestore,
  params: {
    orgId: string;
    fromPhone: string;
    customerName: string;
    textBody: string;
    waMessageId: string;
    timestampIso?: string;
  }
): Promise<{ conversation: Conversation; message: Message }> {
  const normalizedPhone = normalizeIndianPhone(params.fromPhone);
  const nowIso = params.timestampIso ?? new Date().toISOString();
  const isOptOut = /^(stop|unsubscribe)$/i.test(params.textBody.trim());
  const isOptIn = /^(start|subscribe|yes)$/i.test(params.textBody.trim());

  const existingConvSnap = await db
    .collection('conversations')
    .where('orgId', '==', params.orgId)
    .where('customerPhone', '==', normalizedPhone)
    .where('channel', '==', 'WHATSAPP')
    .limit(1)
    .get();

  let conversation: Conversation;
  if (existingConvSnap.empty) {
    const convRef = db.collection('conversations').doc();
    conversation = {
      id: convRef.id,
      orgId: params.orgId,
      leadId: null,
      customerPhone: normalizedPhone,
      customerName: params.customerName || normalizedPhone,
      channel: 'WHATSAPP',
      assignedAgentUid: null,
      status: 'OPEN',
      lastCustomerMessageAt: nowIso,
      optInStatus: isOptOut ? 'OPTED_OUT' : 'OPTED_IN',
      unreadCount: 1,
      lastMessagePreview: params.textBody.slice(0, 120),
      updatedAt: nowIso,
      createdAt: nowIso,
    };
    await convRef.set(conversation);
  } else {
    const prev = existingConvSnap.docs[0]!.data() as Conversation;
    conversation = {
      ...prev,
      lastCustomerMessageAt: nowIso,
      optInStatus: isOptOut ? 'OPTED_OUT' : isOptIn ? 'OPTED_IN' : prev.optInStatus,
      unreadCount: (prev.unreadCount ?? 0) + 1,
      lastMessagePreview: params.textBody.slice(0, 120),
      updatedAt: nowIso,
    };
    await existingConvSnap.docs[0]!.ref.set(conversation);
  }

  const msgRef = db.collection('messages').doc();
  const message: Message = {
    id: msgRef.id,
    orgId: params.orgId,
    conversationId: conversation.id,
    leadId: conversation.leadId ?? null,
    direction: 'INBOUND',
    messageType: 'TEXT',
    content: params.textBody,
    waMessageId: params.waMessageId,
    deliveryStatus: 'DELIVERED',
    aiGenerated: false,
    createdAt: nowIso,
  };
  await msgRef.set(message);

  return { conversation, message };
}

/**
 * Outbound WhatsApp Sender Service.
 * Enforces:
 * 1. Opt-out guard (`optInStatus !== 'OPTED_OUT'`).
 * 2. Meta 24-hour customer-service window guard (free-form text blocked outside 24h;
 *    requires `TEMPLATE` message type).
 * 3. Human approval gate for AI-generated drafts by default (`DRAFT_PENDING_APPROVAL`
 *    unless `organization.whatsappAutoSendAi === true`).
 * 4. Honest live dispatch via Meta Graph API when `WHATSAPP_ACCESS_TOKEN` is set;
 *    otherwise keeps status `QUEUED` with explicit credential notice.
 */
export async function sendOutboundWhatsappService(
  db: Firestore,
  actor: AuthenticatedActor,
  params: {
    orgId: string;
    conversationId: string;
    messageType: 'TEXT' | 'TEMPLATE' | 'DOCUMENT' | 'AI_DRAFT';
    content: string;
    templateName?: string;
    documentId?: string;
    quotationId?: string;
    aiGenerated?: boolean;
  }
): Promise<Message> {
  const [orgSnap, convSnap] = await Promise.all([
    db.collection('organizations').doc(params.orgId).get(),
    db.collection('conversations').doc(params.conversationId).get(),
  ]);

  if (!orgSnap.exists || !convSnap.exists || convSnap.data()?.orgId !== params.orgId) {
    throw new HttpsError('not-found', 'Organization or conversation not found.');
  }

  const org = orgSnap.data() as Organization;
  const conv = convSnap.data() as Conversation;

  if (conv.optInStatus === 'OPTED_OUT') {
    throw new HttpsError(
      'failed-precondition',
      'Recipient has opted out of WhatsApp messages (STOP received).'
    );
  }

  const isAi = Boolean(params.aiGenerated || params.messageType === 'AI_DRAFT');
  const nowIso = new Date().toISOString();

  // AI drafts require human approval by default
  if (isAi && !org.whatsappAutoSendAi) {
    const draftRef = db.collection('messages').doc();
    const draftMsg: Message = {
      id: draftRef.id,
      orgId: params.orgId,
      conversationId: conv.id,
      leadId: conv.leadId ?? null,
      direction: 'OUTBOUND',
      messageType: 'AI_DRAFT',
      content: params.content,
      deliveryStatus: 'DRAFT_PENDING_APPROVAL',
      aiGenerated: true,
      approvedByUid: null,
      sentByUid: null,
      createdAt: nowIso,
    };
    await draftRef.set(draftMsg);
    return draftMsg;
  }

  // Enforce Meta 24h customer-service window for non-template messages
  const windowOpen = isWithinMetaServiceWindow(conv.lastCustomerMessageAt);
  if (!windowOpen && params.messageType !== 'TEMPLATE') {
    throw new HttpsError(
      'failed-precondition',
      'Meta 24-hour customer-service window is closed. Select an approved WhatsApp Template to re-initiate conversation.'
    );
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  let deliveryStatus: Message['deliveryStatus'] = 'QUEUED';
  let waMessageId: string | undefined;
  let errorDetails: string | undefined;

  if (accessToken && phoneNumberId) {
    try {
      const toDigits = conv.customerPhone.replace(/\D/g, '');
      const bodyPayload =
        params.messageType === 'TEMPLATE'
          ? {
              messaging_product: 'whatsapp',
              to: toDigits,
              type: 'template',
              template: {
                name: params.templateName || 'hello_world',
                language: { code: 'en' },
              },
            }
          : {
              messaging_product: 'whatsapp',
              to: toDigits,
              type: 'text',
              text: { body: params.content },
            };

      const res = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        }
      );

      if (res.ok) {
        const json = (await res.json()) as { messages?: Array<{ id: string }> };
        waMessageId = json.messages?.[0]?.id;
        deliveryStatus = 'SENT';
      } else {
        deliveryStatus = 'FAILED';
        errorDetails = `Meta API HTTP ${res.status}`;
      }
    } catch (err) {
      deliveryStatus = 'FAILED';
      errorDetails = err instanceof Error ? err.message : 'Meta network error';
    }
  } else {
    deliveryStatus = 'QUEUED';
    errorDetails = 'WHATSAPP_ACCESS_TOKEN not configured; message recorded in queued state.';
  }

  const msgRef = db.collection('messages').doc();
  const msg: Message = {
    id: msgRef.id,
    orgId: params.orgId,
    conversationId: conv.id,
    leadId: conv.leadId ?? null,
    direction: 'OUTBOUND',
    messageType: params.messageType === 'AI_DRAFT' ? 'TEXT' : params.messageType,
    content: params.content,
    templateName: params.templateName,
    documentId: params.documentId,
    quotationId: params.quotationId,
    waMessageId,
    deliveryStatus,
    aiGenerated: isAi,
    approvedByUid: isAi ? actor.uid : null,
    sentByUid: actor.uid,
    errorDetails,
    createdAt: nowIso,
  };

  await msgRef.set(msg);
  await db.collection('conversations').doc(conv.id).update({
    lastMessagePreview: params.content.slice(0, 120),
    unreadCount: 0,
    updatedAt: nowIso,
  });

  await writeAuditEvent(db, {
    orgId: params.orgId,
    actorUid: actor.uid,
    action: 'WHATSAPP_MESSAGE_OUTBOUND',
    category: 'SYSTEM',
    entityType: 'message',
    entityId: msg.id,
    summary: `Outbound WhatsApp (${msg.messageType}, status=${msg.deliveryStatus}) to ${conv.customerPhone}.`,
  });

  return msg;
}

// --- Official Meta WhatsApp Cloud API Webhook (GET Challenge + POST Events) ---

export const whatsappWebhook = onRequest(async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && expectedToken && token === expectedToken) {
      res.status(200).send(String(challenge));
      return;
    }
    res.status(403).json({ error: 'Webhook verification failed.' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  const signature = req.header('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(req.rawBody, signature, appSecret)) {
    res.status(401).json({ error: 'Invalid X-Hub-Signature-256.' });
    return;
  }

  const body = req.body as any;
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Resolve tenant organization mapped to this WhatsApp phoneNumberId
      const intSnap = await adminDb
        .collection('integrations')
        .where('provider', '==', 'WHATSAPP_CLOUD')
        .where('publicMetadata.phoneNumberId', '==', String(phoneNumberId))
        .limit(1)
        .get();

      if (intSnap.empty) continue;
      const orgId = intSnap.docs[0]!.data().orgId as string;

      for (const inbound of value?.messages ?? []) {
        const contactName = value?.contacts?.[0]?.profile?.name ?? inbound.from;
        await processInboundWhatsappEventService(adminDb, {
          orgId,
          fromPhone: inbound.from,
          customerName: contactName,
          textBody: inbound?.text?.body ?? '[Media/Interactive Message]',
          waMessageId: inbound.id,
        });
      }

      // Delivery / Read status updates
      for (const st of value?.statuses ?? []) {
        const msgSnap = await adminDb
          .collection('messages')
          .where('orgId', '==', orgId)
          .where('waMessageId', '==', st.id)
          .limit(1)
          .get();
        if (!msgSnap.empty) {
          const mapStatus: Record<string, Message['deliveryStatus']> = {
            sent: 'SENT',
            delivered: 'DELIVERED',
            read: 'READ',
            failed: 'FAILED',
          };
          const mapped = mapStatus[String(st.status).toLowerCase()];
          if (mapped) {
            await msgSnap.docs[0]!.ref.update({ deliveryStatus: mapped });
          }
        }
      }
    }
  }

  res.status(200).json({ received: true });
});

// --- Cloud Functions v2 Callables ---

export const startOrGetWhatsappConversation = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    customerPhone: z.string().min(10),
    customerName: z.string().min(1),
    leadId: z.string().optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'whatsapp:send');
  const norm = normalizeIndianPhone(input.customerPhone);

  const existing = await adminDb
    .collection('conversations')
    .where('orgId', '==', input.orgId)
    .where('customerPhone', '==', norm)
    .where('channel', '==', 'WHATSAPP')
    .limit(1)
    .get();

  if (!existing.empty) {
    return existing.docs[0]!.data() as Conversation;
  }

  const nowIso = new Date().toISOString();
  const ref = adminDb.collection('conversations').doc();
  const conv: Conversation = {
    id: ref.id,
    orgId: input.orgId,
    leadId: input.leadId ?? null,
    customerPhone: norm,
    customerName: input.customerName.trim(),
    channel: 'WHATSAPP',
    assignedAgentUid: actor.uid,
    status: 'OPEN',
    lastCustomerMessageAt: null, // Requires approved template to initiate
    optInStatus: 'OPTED_IN',
    unreadCount: 0,
    updatedAt: nowIso,
    createdAt: nowIso,
  };
  await ref.set(conv);
  return conv;
});

export const sendWhatsappMessage = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    conversationId: z.string().min(1),
    messageType: z.enum(['TEXT', 'TEMPLATE', 'DOCUMENT', 'AI_DRAFT']),
    content: z.string().min(1).max(4000),
    templateName: z.string().optional(),
    documentId: z.string().optional(),
    quotationId: z.string().optional(),
    aiGenerated: z.boolean().optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(request, input.orgId, 'whatsapp:send');
  return sendOutboundWhatsappService(adminDb, actor, input);
});

export const approveAiWhatsappDraft = onCall(async (request) => {
  const schema = z.object({
    orgId: z.string().min(1),
    messageId: z.string().min(1),
    editedContent: z.string().min(1).max(4000).optional(),
  });
  const input = schema.parse(request.data);
  const { actor } = await requireOrgPermission(
    request,
    input.orgId,
    'whatsapp:approve_ai_reply'
  );

  const msgRef = adminDb.collection('messages').doc(input.messageId);
  const snap = await msgRef.get();
  if (!snap.exists || snap.data()?.orgId !== input.orgId) {
    throw new HttpsError('not-found', 'Draft message not found.');
  }
  const draft = snap.data() as Message;
  if (draft.deliveryStatus !== 'DRAFT_PENDING_APPROVAL') {
    throw new HttpsError('failed-precondition', 'Message is not pending human approval.');
  }

  await msgRef.delete();
  return sendOutboundWhatsappService(adminDb, actor, {
    orgId: input.orgId,
    conversationId: draft.conversationId,
    messageType: 'TEXT',
    content: input.editedContent ?? draft.content,
    aiGenerated: false,
  });
});
