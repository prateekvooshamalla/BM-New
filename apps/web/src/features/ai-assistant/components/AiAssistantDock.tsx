import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import {
  Bot,
  ExternalLink,
  FileUp,
  GripVertical,
  History,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type {
  AiAssistantSession,
  AiInventoryDraft,
  DocumentRecord,
} from '@bharat-makaan/shared';
import { formatAreaSqft, formatInr, hasPermission } from '@bharat-makaan/shared';
import { callBackendFunction, db, storage } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AiDraftReviewPanel } from './AiDraftReviewPanel';

interface AiAssistantDockProps {
  partnerContext?: {
    partnerOrgId: string;
    builderOrgId: string;
    projectId: string | null;
  };
}

const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = res.indexOf(',');
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Failed to read local file'));
    reader.readAsDataURL(file);
  });
}

export function AiAssistantDock({ partnerContext }: AiAssistantDockProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  const {
    uid,
    activeOrgId,
    activeOrganization,
    activeMember,
    isSuperAdmin,
    projects,
    activeProjectId,
    activeProject,
    selectedContextTowerId,
    selectedContextUnitId,
    aiDrawerOpen,
    aiDrawerWidth,
    activeAiSessionId,
    setAiDrawerOpen,
    setAiDrawerWidth,
    setActiveAiSessionId,
    consumeAiInitialPrompt,
    selectProject,
  } = useTenantStore();

  const effectiveOrgId = partnerContext?.builderOrgId || activeOrgId;
  const effectiveProjectId = partnerContext
    ? partnerContext.projectId
    : activeProjectId;
  const effectivePartnerOrgId = partnerContext?.partnerOrgId ?? null;

  const [tab, setTab] = React.useState<'chat' | 'history'>('chat');
  const [session, setSession] = React.useState<AiAssistantSession | null>(null);
  const [draft, setDraft] = React.useState<AiInventoryDraft | null>(null);
  const [historySessions, setHistorySessions] = React.useState<AiAssistantSession[]>([]);
  const [messageInput, setMessageInput] = React.useState('');
  const [quickFloorsInput, setQuickFloorsInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [latestQueryResult, setLatestQueryResult] = React.useState<Record<string, any> | null>(
    null
  );

  const canUploadFloorPlans = React.useMemo(() => {
    if (partnerContext) return false;
    if (isSuperAdmin) return true;
    if (!activeMember) return false;
    return hasPermission(
      {
        status: activeMember.status,
        role: activeMember.role,
        permissions: activeMember.permissions,
        assignedProjectIds: activeMember.assignedProjectIds,
      },
      'inventory:manage',
      effectiveProjectId ?? undefined
    );
  }, [activeMember, effectiveProjectId, isSuperAdmin, partnerContext]);

  // Subscribe to active AI session
  React.useEffect(() => {
    if (!activeAiSessionId) {
      setSession(null);
      setDraft(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'ai_sessions', activeAiSessionId),
      (snap) => {
        if (snap.exists()) {
          setSession(snap.data() as AiAssistantSession);
        }
      },
      () => {
        // Ignore transient snapshot errors
      }
    );
    return () => unsub();
  }, [activeAiSessionId]);

  // Subscribe to staged inventory draft when session has draftId
  React.useEffect(() => {
    const draftId = session?.draftId;
    if (!draftId) {
      setDraft(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'ai_inventory_drafts', draftId),
      (snap) => {
        if (snap.exists()) {
          setDraft(snap.data() as AiInventoryDraft);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [session?.draftId]);

  // Load recent session history when History tab is opened
  React.useEffect(() => {
    if (!aiDrawerOpen || tab !== 'history' || !effectiveOrgId || !uid) return;
    const q = query(
      collection(db, 'ai_sessions'),
      where('orgId', '==', effectiveOrgId),
      where('uid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(20)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setHistorySessions(snap.docs.map((d) => d.data() as AiAssistantSession));
      },
      () => setHistorySessions([])
    );
    return () => unsub();
  }, [aiDrawerOpen, effectiveOrgId, tab, uid]);

  // Ensure a session exists when drawer opens
  const ensureSession = React.useCallback(async (): Promise<string | null> => {
    if (!effectiveOrgId) return null;
    if (activeAiSessionId) return activeAiSessionId;

    const created = await callBackendFunction<any, AiAssistantSession>(
      'createAiAssistantSession',
      {
        orgId: effectiveOrgId,
        projectId: effectiveProjectId ?? null,
        partnerOrgId: effectivePartnerOrgId,
        contextSnapshot: {
          currentRoute: location.pathname,
          activeProjectId: effectiveProjectId ?? null,
          selectedTowerId: selectedContextTowerId,
          selectedUnitId: selectedContextUnitId,
        },
      }
    );
    setSession(created);
    setActiveAiSessionId(created.id);
    return created.id;
  }, [
    activeAiSessionId,
    effectiveOrgId,
    effectivePartnerOrgId,
    effectiveProjectId,
    location.pathname,
    selectedContextTowerId,
    selectedContextUnitId,
    setActiveAiSessionId,
  ]);

  const handleSendText = React.useCallback(
    async (
      rawText: string,
      structuredAnswerPatch?: Record<string, unknown>
    ) => {
      const trimmed = rawText.trim();
      if (!trimmed || !effectiveOrgId) return;

      setSending(true);
      setErrorMsg(null);
      try {
        const sid = await ensureSession();
        if (!sid) return;

        const res = await callBackendFunction<
          any,
          {
            session: AiAssistantSession;
            draft: AiInventoryDraft | null;
            queryResult?: Record<string, unknown>;
          }
        >('sendAiAssistantMessage', {
          orgId: effectiveOrgId,
          sessionId: sid,
          partnerOrgId: effectivePartnerOrgId,
          message: trimmed,
          contextSnapshot: {
            currentRoute: location.pathname,
            activeProjectId: effectiveProjectId ?? null,
            selectedTowerId: selectedContextTowerId,
            selectedUnitId: selectedContextUnitId,
          },
          structuredAnswerPatch,
        });

        setSession(res.session);
        if (res.draft) {
          setDraft(res.draft);
        }
        if (res.queryResult) {
          setLatestQueryResult(res.queryResult);
        }
        setMessageInput('');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'AI Assistant request failed.');
      } finally {
        setSending(false);
      }
    },
    [
      effectiveOrgId,
      effectivePartnerOrgId,
      effectiveProjectId,
      ensureSession,
      location.pathname,
      selectedContextTowerId,
      selectedContextUnitId,
    ]
  );

  // Consume initial prompt passed from any page button (e.g. "Create with AI")
  React.useEffect(() => {
    if (!aiDrawerOpen || !effectiveOrgId) return;
    const initial = consumeAiInitialPrompt();
    if (initial) {
      void handleSendText(initial);
    }
  }, [aiDrawerOpen, consumeAiInitialPrompt, effectiveOrgId, handleSendText]);

  // Auto-scroll messages
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, draft?.updatedAt]);

  // Desktop left-edge resize handler
  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = aiDrawerWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setAiDrawerWidth(startW + delta);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleNewSession = async () => {
    if (!effectiveOrgId) return;
    setSending(true);
    setErrorMsg(null);
    setLatestQueryResult(null);
    try {
      const created = await callBackendFunction<any, AiAssistantSession>(
        'createAiAssistantSession',
        {
          orgId: effectiveOrgId,
          projectId: effectiveProjectId ?? null,
          partnerOrgId: effectivePartnerOrgId,
          contextSnapshot: {
            currentRoute: location.pathname,
            activeProjectId: effectiveProjectId ?? null,
            selectedTowerId: selectedContextTowerId,
            selectedUnitId: selectedContextUnitId,
          },
        }
      );
      setSession(created);
      setDraft(null);
      setActiveAiSessionId(created.id);
      setTab('chat');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start new AI session.');
    } finally {
      setSending(false);
    }
  };

  const handleUploadFloorPlanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !effectiveOrgId) return;

    const targetProjectId = session?.projectId ?? effectiveProjectId;
    if (!targetProjectId) {
      setErrorMsg('Please select a target project before uploading a floor-plan PDF or image.');
      return;
    }

    if (!ACCEPTED_MIME_TYPES.includes(file.type as any)) {
      setErrorMsg('Unsupported file format. Upload PDF, PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setErrorMsg('File exceeds 25 MB limit.');
      return;
    }

    setErrorMsg(null);
    setUploadPct(5);
    try {
      const sid = await ensureSession();
      if (!sid) return;

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `organizations/${effectiveOrgId}/projects/${targetProjectId}/ai-floorplans/${Date.now()}_${safeName}`;

      // Upload to tenant-isolated Firebase Storage with progress tracking
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef(storage, storagePath), file, {
          contentType: file.type,
        });
        task.on(
          'state_changed',
          (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 80);
            setUploadPct(Math.max(10, pct));
          },
          (err) => reject(err),
          () => resolve()
        );
      });

      const base64Content = await readFileAsBase64(file);
      setUploadPct(88);

      // Register in controlled documents repository
      const registeredDoc = await callBackendFunction<any, DocumentRecord>('registerDocument', {
        orgId: effectiveOrgId,
        projectId: targetProjectId,
        category: 'FLOOR_PLAN',
        title: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        storagePath,
        visibility: 'INTERNAL',
        watermarkEnabled: true,
      });

      setUploadPct(94);

      const analysis = await callBackendFunction<
        any,
        { draft: AiInventoryDraft; summaryMessage: string }
      >('analyzeAiFloorPlanDocuments', {
        orgId: effectiveOrgId,
        projectId: targetProjectId,
        sessionId: sid,
        documents: [
          {
            documentId: registeredDoc.id,
            title: registeredDoc.title,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            storagePath,
            base64Content,
          },
        ],
      });

      setDraft(analysis.draft);
      setUploadPct(null);
    } catch (err) {
      setUploadPct(null);
      setErrorMsg(err instanceof Error ? err.message : 'Floor-plan extraction failed.');
    }
  };

  const quickPrompts = partnerContext
    ? [
        'Show available 3 BHK apartments in this project',
        'How many units are currently available?',
        'Find east-facing units above floor 5',
      ]
    : [
        'Add Tower 1',
        'Show all available 3 BHK units',
        'Which units are missing floor plans?',
        'Show units whose price changed this month',
        'Create draft price book',
        'Summarize leads for this project',
      ];

  if (!effectiveOrgId) {
    return null;
  }

  return (
    <>
      {/* Floating Corner Launcher when closed */}
      {!aiDrawerOpen && (
        <button
          type="button"
          onClick={() => setAiDrawerOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
          aria-label="Open Bharat Makaan AI Assistant"
        >
          <Sparkles className="h-4 w-4" />
          <span>AI Assistant</span>
        </button>
      )}

      {/* Resizable Right-Side Assistant Panel (Full-Screen on Mobile) */}
      {aiDrawerOpen && (
        <aside
          style={{ ['--ai-drawer-w' as any]: `${aiDrawerWidth}px` }}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-2xl sm:w-[var(--ai-drawer-w)]"
          aria-label="Bharat Makaan Internal AI Assistant"
        >
          {/* Desktop Left Resize Handle */}
          <div
            onMouseDown={handleStartResize}
            title="Drag to resize AI panel"
            className="absolute inset-y-0 left-0 hidden w-2 -translate-x-1 cursor-col-resize items-center justify-center hover:bg-primary/20 sm:flex"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground/60" />
          </div>

          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-foreground">
                    Bharat Makaan AI Assistant
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {partnerContext
                      ? 'Authorized Partner Scope'
                      : `${activeOrganization?.name ?? 'Organization'} • ${
                          activeProject?.name ?? 'All Projects'
                        }`}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="New conversation"
                onClick={handleNewSession}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={tab === 'history' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                title="Session history"
                onClick={() => setTab((t) => (t === 'chat' ? 'history' : 'chat'))}
              >
                <History className="h-4 w-4" />
              </Button>
              {!partnerContext && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Open Split-Screen Floor-Plan Studio"
                  onClick={() => {
                    setAiDrawerOpen(false);
                    navigate('/app/ai-studio');
                  }}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Close AI Assistant"
                onClick={() => setAiDrawerOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Context Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-1.5 text-[11px] text-muted-foreground">
            <span>
              Role:{' '}
              <strong className="text-foreground">
                {partnerContext
                  ? 'CHANNEL PARTNER'
                  : (activeMember?.role.replace(/_/g, ' ') ??
                    (isSuperAdmin ? 'SUPER ADMIN' : 'MEMBER'))}
              </strong>
            </span>
            <span>Screen: {location.pathname}</span>
          </div>

          {tab === 'history' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <div className="text-xs font-semibold text-foreground">
                Recent AI Sessions ({historySessions.length})
              </div>
              {historySessions.length === 0 ? (
                <div className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
                  No previous sessions yet. Start a conversation or tower wizard!
                </div>
              ) : (
                historySessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setActiveAiSessionId(s.id);
                      setTab('chat');
                    }}
                    className={`w-full rounded-lg border p-3 text-left transition cursor-pointer ${
                      s.id === activeAiSessionId
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                      <span className="truncate">{s.title}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {s.status}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {s.messages.length} messages • Updated{' '}
                      {new Date(s.updatedAt).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              {/* Scrollable Conversation & Review Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {(!session || session.messages.length === 0) && (
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="text-xs font-semibold text-foreground">
                      Conversational CRM &amp; Intelligent Inventory Wizards
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Configure towers, floors, numbering, and BHK layouts step-by-step, upload
                      architectural floor-plan PDFs for structured extraction, or query live CRM
                      availability and quotations within your role permissions.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {quickPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => void handleSendText(prompt)}
                          className="rounded-md border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-secondary cursor-pointer"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages */}
                {session?.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'USER' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'USER'
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border bg-card text-foreground'
                      }`}
                    >
                      {msg.content}
                    </div>
                    {msg.modelUsed && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <Wrench className="h-2.5 w-2.5" />
                          {msg.modelUsed}
                        </span>
                      </div>
                    )}
                    {msg.deepLinks && msg.deepLinks.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {msg.deepLinks.map((lnk, idx) => (
                          <Button
                            key={`${msg.id}_dl_${idx}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => navigate(lnk.route)}
                          >
                            {lnk.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Structured Question Cards for Active Wizard Missing Fields */}
                {session && session.missingFields.length > 0 && !partnerContext && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                      Guided Wizard Input
                    </div>

                    {session.missingFields.includes('projectId') && projects.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-foreground">
                          Select Target Project:
                        </div>
                        <Select
                          value={session.projectId ?? ''}
                          onValueChange={(projId) => {
                            const proj = projects.find((p) => p.id === projId);
                            selectProject(projId);
                            if (proj) {
                              void handleSendText(proj.name, { projectId: proj.id });
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs bg-background">
                            <SelectValue placeholder="Choose authorized project..." />
                          </SelectTrigger>
                          <SelectContent>
                            {projects.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} ({p.code}) — {p.city}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {session.missingFields.includes('totalFloors') && (
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="e.g., 25 floors, skip 13, refuge 8 and 16"
                          className="h-8 text-xs bg-background"
                          value={quickFloorsInput}
                          onChange={(e) => setQuickFloorsInput(e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs shrink-0"
                          disabled={sending || !quickFloorsInput.trim()}
                          onClick={() => {
                            const txt = quickFloorsInput;
                            setQuickFloorsInput('');
                            void handleSendText(txt);
                          }}
                        >
                          Apply
                        </Button>
                      </div>
                    )}

                    {session.missingFields.includes('numberingPattern') && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-foreground">
                          Unit Numbering Format:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              void handleSendText('Use 101–104 floor numbering', {
                                numberingPattern: 'FLOOR_INDEX_3DIGIT',
                              })
                            }
                          >
                            101–104, 201–204
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              void handleSendText('Use Tower-prefixed T1-101 numbering', {
                                numberingPattern: 'TOWER_FLOOR_INDEX',
                              })
                            }
                          >
                            T1-101, T1-201
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              void handleSendText('Use sequential numbering 1, 2, 3...', {
                                numberingPattern: 'SEQUENTIAL_GROUND',
                              })
                            }
                          >
                            Sequential (Plots/Villas)
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Query Results Card (Units / Missing Plans / Quotation Preview / Leads) */}
                {latestQueryResult && Array.isArray(latestQueryResult.units) && (
                  <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>Matched Units ({latestQueryResult.units.length})</span>
                      {!partnerContext && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px]"
                          onClick={() => navigate('/app/inventory')}
                        >
                          View in Matrix <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-border text-xs">
                      {latestQueryResult.units.slice(0, 15).map((u: any) => (
                        <div
                          key={u.id}
                          className="flex items-center justify-between py-1.5 gap-2"
                        >
                          <div>
                            <span className="font-semibold">{u.unitNumber}</span> • {u.bhk} •{' '}
                            {formatAreaSqft(u.saleableAreaSqft)} • {u.facing}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {u.calculatedTotalPrice > 0
                                ? formatInr(u.calculatedTotalPrice)
                                : 'Price Book Pending'}
                            </span>
                            {!partnerContext && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[10px]"
                                onClick={() => navigate(`/app/quotations?unitId=${u.id}`)}
                              >
                                Quote
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Embedded Staged Inventory Draft Review */}
                {draft && (
                  <AiDraftReviewPanel
                    draft={draft}
                    sessionId={session?.id}
                    compact
                    onDraftMutated={(updated) => setDraft(updated)}
                  />
                )}

                {/* Upload Progress */}
                {uploadPct !== null && (
                  <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between font-medium">
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        Uploading &amp; analyzing floor-plan document...
                      </span>
                      <span>{uploadPct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${uploadPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {errorMsg}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Composer Footer */}
              <div className="border-t border-border bg-card p-3 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleUploadFloorPlanFile}
                />

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendText(messageInput);
                  }}
                  className="flex items-center gap-2"
                >
                  {canUploadFloorPlans && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      title="Upload Floor-Plan PDF or Image (Max 25 MB)"
                      disabled={sending || uploadPct !== null}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileUp className="h-4 w-4" />
                    </Button>
                  )}

                  <Input
                    placeholder={
                      partnerContext
                        ? 'Ask about permitted units or availability...'
                        : 'Ask AI or configure towers, floors, units, pricing...'
                    }
                    value={messageInput}
                    disabled={sending}
                    onChange={(e) => setMessageInput(e.target.value)}
                    className="h-9 text-xs"
                  />

                  <Button
                    type="submit"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={sending || !messageInput.trim()}
                    aria-label="Send message"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </>
          )}
        </aside>
      )}
    </>
  );
}
