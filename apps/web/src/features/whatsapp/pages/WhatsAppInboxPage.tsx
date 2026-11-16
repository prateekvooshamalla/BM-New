import * as React from 'react';
import { where } from 'firebase/firestore';
import { Check, Clock, MessageSquareText, Send, Sparkles } from 'lucide-react';
import {
  isWithinMetaServiceWindow,
  type Conversation,
  type IntegrationConfig,
  type Message,
} from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { sortAscByIso, sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const APPROVED_TEMPLATES = [
  { name: 'project_brochure_intro', label: 'Project Brochure & Introduction', preview: 'Namaste! Thank you for your interest in our project. Sharing the official brochure & floor plans.' },
  { name: 'site_visit_confirmation', label: 'Site Visit Confirmation', preview: 'Your site visit has been scheduled. Our relationship manager looks forward to hosting you.' },
  { name: 'cost_sheet_followup', label: 'Quotation Follow-Up', preview: 'Following up on the customized cost sheet shared earlier. Let us know if you would like to discuss payment milestones.' },
];

export function WhatsAppInboxPage() {
  const { activeOrgId } = useTenantStore();
  const [waIntegration, setWaIntegration] = React.useState<IntegrationConfig | null>(null);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);

  const [textInput, setTextInput] = React.useState('');
  const [selectedTemplate, setSelectedTemplate] = React.useState(APPROVED_TEMPLATES[0]!.name);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!activeOrgId) return;

    const uInt = subscribeTenantCollection<IntegrationConfig>({
      orgId: activeOrgId,
      collectionName: 'integrations',
      extraConstraints: [where('provider', '==', 'WHATSAPP_CLOUD')],
      filter: (i) => i.provider === 'WHATSAPP_CLOUD',
      onData: (list) => setWaIntegration(list[0] ?? null),
    });

    const uConv = subscribeTenantCollection<Conversation>({
      orgId: activeOrgId,
      collectionName: 'conversations',
      sort: sortDescByIso<Conversation>('updatedAt'),
      onData: (list) => {
        setConversations(list);
        if (!selectedConvId && list[0]) setSelectedConvId(list[0].id);
      },
    });

    return () => {
      uInt();
      uConv();
    };
  }, [activeOrgId, selectedConvId]);

  React.useEffect(() => {
    if (!activeOrgId || !selectedConvId) {
      setMessages([]);
      return;
    }
    return subscribeTenantCollection<Message>({
      orgId: activeOrgId,
      collectionName: 'messages',
      extraConstraints: [where('conversationId', '==', selectedConvId)],
      filter: (m) => m.conversationId === selectedConvId,
      sort: sortAscByIso<Message>('createdAt'),
      onData: setMessages,
    });
  }, [activeOrgId, selectedConvId]);

  const activeConv = conversations.find((c) => c.id === selectedConvId) ?? null;
  const serviceWindowOpen = isWithinMetaServiceWindow(activeConv?.lastCustomerMessageAt);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !activeConv || !textInput.trim()) return;
    setBusy(true);
    setBanner(null);
    try {
      await callBackendFunction('sendWhatsappMessage', {
        orgId: activeOrgId,
        conversationId: activeConv.id,
        messageType: 'TEXT',
        content: textInput.trim(),
      });
      setTextInput('');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Message send blocked.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendTemplate = async () => {
    if (!activeOrgId || !activeConv) return;
    const tpl = APPROVED_TEMPLATES.find((t) => t.name === selectedTemplate);
    if (!tpl) return;
    setBusy(true);
    try {
      await callBackendFunction('sendWhatsappMessage', {
        orgId: activeOrgId,
        conversationId: activeConv.id,
        messageType: 'TEMPLATE',
        templateName: tpl.name,
        content: `[Template: ${tpl.label}] ${tpl.preview}`,
      });
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Template dispatch failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateAiReplyDraft = async () => {
    if (!activeOrgId || !activeConv) return;
    setBusy(true);
    try {
      const aiRes = await callBackendFunction<any, { text: string }>('runAiAssistant', {
        orgId: activeOrgId,
        feature: 'WHATSAPP_REPLY_DRAFT',
        context: {
          customerName: activeConv.customerName,
          recentMessages: messages.slice(-5).map((m) => `${m.direction}: ${m.content}`),
        },
      });
      await callBackendFunction('sendWhatsappMessage', {
        orgId: activeOrgId,
        conversationId: activeConv.id,
        messageType: 'AI_DRAFT',
        content: aiRes.text,
        aiGenerated: true,
      });
    } catch (err) {
      setBanner(
        err instanceof Error
          ? err.message
          : 'OpenAI API key not configured (`OPENAI_API_KEY`).'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleApproveDraft = async (msgId: string) => {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      await callBackendFunction('approveAiWhatsappDraft', {
        orgId: activeOrgId,
        messageId: msgId,
      });
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Approval send failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="No WhatsApp account connected."
        description="Select a builder organization first to configure Meta WhatsApp Cloud API."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Official Meta WhatsApp Cloud API"
        title="Shared WhatsApp Inbox"
        description="Multi-agent customer conversations enforcing the 24-hour Meta service window, opt-in compliance, and human-approved AI replies."
      />

      {(!waIntegration || waIntegration.status !== 'VERIFIED_ACTIVE') && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>No WhatsApp account connected.</strong> Configure{' '}
          <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code>, and{' '}
          <code>WHATSAPP_APP_SECRET</code> in Cloud Functions secrets to activate live Meta dispatch.
        </div>
      )}

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
          {banner}
        </div>
      )}

      {conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="No WhatsApp account connected."
          description="Once your Meta WhatsApp Cloud API webhook is active—or when you initiate a thread from Leads & CRM—conversations appear here."
        />
      ) : (
        <Card className="grid min-h-[540px] grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* Thread List */}
          <div className="border-r border-border md:col-span-4 overflow-y-auto">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => setSelectedConvId(conv.id)}
                className={`w-full border-b border-border p-3.5 text-left transition-colors cursor-pointer ${
                  conv.id === selectedConvId ? 'bg-accent/50' : 'hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{conv.customerName}</span>
                  <StatusBadge status={conv.optInStatus} />
                </div>
                <div className="text-[11px] text-muted-foreground">{conv.customerPhone}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {conv.lastMessagePreview || 'No messages yet'}
                </div>
              </button>
            ))}
          </div>

          {/* Active Conversation Pane */}
          <div className="flex flex-col md:col-span-8">
            {activeConv ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div>
                    <div className="font-semibold text-sm">{activeConv.customerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {activeConv.customerPhone} •{' '}
                      <Clock className="inline h-3 w-3" />{' '}
                      {serviceWindowOpen
                        ? '24h Customer-Service Window OPEN (Free-form text permitted)'
                        : '24h Window CLOSED (Approved Templates required)'}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={handleGenerateAiReplyDraft}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Draft AI Reply
                  </Button>
                </div>

                <div className="flex-1 space-y-2.5 overflow-y-auto p-4 bg-background/50">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[80%] rounded-lg border p-3 text-xs ${
                        m.direction === 'INBOUND'
                          ? 'mr-auto border-border bg-card'
                          : m.deliveryStatus === 'DRAFT_PENDING_APPROVAL'
                            ? 'ml-auto border-amber-300 bg-amber-50 text-amber-950'
                            : 'ml-auto border-primary/20 bg-primary text-primary-foreground'
                      }`}
                    >
                      <div>{m.content}</div>
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] opacity-75">
                        <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                        <span>{m.deliveryStatus}</span>
                      </div>
                      {m.deliveryStatus === 'DRAFT_PENDING_APPROVAL' && (
                        <div className="mt-2 pt-2 border-t border-amber-200 flex justify-end">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={busy}
                            onClick={() => handleApproveDraft(m.id)}
                          >
                            <Check className="h-3 w-3" /> Approve & Send AI Reply
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Composer */}
                <div className="border-t border-border p-3 space-y-2 bg-card">
                  <div className="flex items-center gap-2">
                    <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPROVED_TEMPLATES.map((t) => (
                          <SelectItem key={t.name} value={t.name}>
                            Template: {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={handleSendTemplate}>
                      Send Approved Template
                    </Button>
                  </div>

                  <form onSubmit={handleSendText} className="flex gap-2">
                    <Input
                      disabled={!serviceWindowOpen}
                      placeholder={
                        serviceWindowOpen
                          ? 'Write reply inside 24h customer-service window...'
                          : '24h window closed — send an approved template above first'
                      }
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                    />
                    <Button type="submit" disabled={!serviceWindowOpen || busy}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              </>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}
