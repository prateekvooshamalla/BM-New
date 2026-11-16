import * as React from 'react';
import { PDFDocument } from 'pdf-lib';
import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  FileText,
  FileUp,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';
import type {
  AiAssistantSession,
  AiInventoryDraft,
  DocumentRecord,
} from '@bharat-makaan/shared';
import { callBackendFunction, db, storage } from '@/lib/firebase';
import { sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AiDraftReviewPanel } from '../components/AiDraftReviewPanel';

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = res.indexOf(',');
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function AiInventoryStudioPage() {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const {
    activeOrgId,
    projects,
    activeProjectId,
    selectProject,
    activeAiSessionId,
    setActiveAiSessionId,
  } = useTenantStore();

  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;

  const [session, setSession] = React.useState<AiAssistantSession | null>(null);
  const [draft, setDraft] = React.useState<AiInventoryDraft | null>(null);
  const [projectDocs, setProjectDocs] = React.useState<DocumentRecord[]>([]);

  // Document viewer state
  const [selectedDocId, setSelectedDocId] = React.useState<string>('');
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewMime, setPreviewMime] = React.useState<string>('application/pdf');
  const [pageCount, setPageCount] = React.useState<number>(1);
  const [currentPage, setCurrentPage] = React.useState<number>(1);
  const [pageDimensions, setPageDimensions] = React.useState<string | null>(null);

  const [chatInput, setChatInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);

  // Subscribe to project floor-plan documents
  React.useEffect(() => {
    if (!activeOrgId || !currentProjectId) {
      setProjectDocs([]);
      return;
    }
    return subscribeTenantCollection<DocumentRecord>({
      orgId: activeOrgId,
      collectionName: 'documents',
      projectId: currentProjectId,
      filter: (d) =>
        ['FLOOR_PLAN', 'TOWER_PLAN', 'UNIT_LAYOUT', 'MASTER_PLAN', 'BROCHURE'].includes(
          d.category
        ),
      sort: sortDescByIso<DocumentRecord>('createdAt'),
      onData: setProjectDocs,
    });
  }, [activeOrgId, currentProjectId]);

  // Subscribe to active AI session & staged draft
  React.useEffect(() => {
    if (!activeAiSessionId) return;
    const unsub = onSnapshot(doc(db, 'ai_sessions', activeAiSessionId), (snap) => {
      if (snap.exists()) {
        setSession(snap.data() as AiAssistantSession);
      }
    });
    return () => unsub();
  }, [activeAiSessionId]);

  React.useEffect(() => {
    if (!session?.draftId) {
      setDraft(null);
      return;
    }
    const unsub = onSnapshot(doc(db, 'ai_inventory_drafts', session.draftId), (snap) => {
      if (snap.exists()) {
        setDraft(snap.data() as AiInventoryDraft);
      }
    });
    return () => unsub();
  }, [session?.draftId]);

  const ensureStudioSession = React.useCallback(async (): Promise<string | null> => {
    if (!activeOrgId) return null;
    if (activeAiSessionId) return activeAiSessionId;

    const created = await callBackendFunction<any, AiAssistantSession>(
      'createAiAssistantSession',
      {
        orgId: activeOrgId,
        projectId: currentProjectId,
        title: 'Floor-Plan Extraction & Inventory Studio',
        contextSnapshot: {
          currentRoute: '/app/ai-studio',
          activeProjectId: currentProjectId,
        },
      }
    );
    setSession(created);
    setActiveAiSessionId(created.id);
    return created.id;
  }, [activeAiSessionId, activeOrgId, currentProjectId, setActiveAiSessionId]);

  const handleLoadExistingDocPreview = async (docRec: DocumentRecord) => {
    setSelectedDocId(docRec.id);
    setPreviewMime(docRec.mimeType);
    setCurrentPage(1);
    setPageDimensions(null);
    try {
      const url = await getDownloadURL(storageRef(storage, docRec.storagePath));
      setPreviewUrl(url);
    } catch {
      setBanner('Preview URL unavailable in current storage environment.');
    }
  };

  const handleUploadAndAnalyze = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeOrgId || !currentProjectId) return;

    if (
      !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    ) {
      setBanner('Unsupported format. Please upload PDF, PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setBanner('File exceeds 25 MB limit.');
      return;
    }

    setBanner(null);
    setUploadPct(10);

    try {
      // Immediate local preview + client-side PDF page count inspection
      const localBlobUrl = URL.createObjectURL(file);
      setPreviewUrl(localBlobUrl);
      setPreviewMime(file.type);
      setCurrentPage(1);

      if (file.type === 'application/pdf') {
        const ab = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
        setPageCount(pdfDoc.getPageCount());
        const firstPg = pdfDoc.getPage(0);
        const { width, height } = firstPg.getSize();
        setPageDimensions(`${Math.round(width)} × ${Math.round(height)} pt`);
      } else {
        setPageCount(1);
        setPageDimensions('Raster Floor-Plan Image');
      }

      const sid = await ensureStudioSession();
      if (!sid) return;

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `organizations/${activeOrgId}/projects/${currentProjectId}/ai-floorplans/${Date.now()}_${safeName}`;

      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef(storage, storagePath), file, {
          contentType: file.type,
        });
        task.on(
          'state_changed',
          (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 75);
            setUploadPct(Math.max(15, pct));
          },
          (err) => reject(err),
          () => resolve()
        );
      });

      const base64Content = await readFileAsBase64(file);
      setUploadPct(88);

      const registeredDoc = await callBackendFunction<any, DocumentRecord>('registerDocument', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        category: 'FLOOR_PLAN',
        title: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        storagePath,
        visibility: 'INTERNAL',
        watermarkEnabled: true,
      });

      setSelectedDocId(registeredDoc.id);
      setUploadPct(95);

      const res = await callBackendFunction<
        any,
        { draft: AiInventoryDraft; summaryMessage: string }
      >('analyzeAiFloorPlanDocuments', {
        orgId: activeOrgId,
        projectId: currentProjectId,
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

      setDraft(res.draft);
      setUploadPct(null);
      setBanner(res.summaryMessage);
    } catch (err) {
      setUploadPct(null);
      setBanner(err instanceof Error ? err.message : 'Floor-plan extraction failed.');
    }
  };

  const handleSendStudioMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || !activeOrgId) return;

    setBusy(true);
    setBanner(null);
    try {
      const sid = await ensureStudioSession();
      if (!sid) return;

      const res = await callBackendFunction<
        any,
        { session: AiAssistantSession; draft: AiInventoryDraft | null }
      >('sendAiAssistantMessage', {
        orgId: activeOrgId,
        sessionId: sid,
        message: trimmed,
        contextSnapshot: {
          currentRoute: '/app/ai-studio',
          activeProjectId: currentProjectId,
        },
      });
      setSession(res.session);
      if (res.draft) setDraft(res.draft);
      setChatInput('');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Message failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Select an Organization to Open AI Inventory Studio"
        description="Choose or create an organization from the left navigation sidebar."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Split-Screen Floor-Plan Extraction & Controlled Commit"
        title="AI Inventory & Floor-Plan Studio"
        description="Upload architectural floor-plan PDFs or images, inspect per-page provenance, refine unit numbering and floor exclusions, and commit validated inventory in chunked batches."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {projects.length > 0 && (
              <Select
                value={currentProjectId ?? ''}
                onValueChange={(val) => selectProject(val)}
              >
                <SelectTrigger className="h-9 w-56 text-xs">
                  <SelectValue placeholder="Select Target Project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleUploadAndAnalyze}
            />
            <Button
              size="sm"
              disabled={!currentProjectId || uploadPct !== null}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadPct !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              {uploadPct !== null
                ? `Analyzing (${uploadPct}%)...`
                : 'Upload Floor-Plan PDF / Image'}
            </Button>
          </div>
        }
      />

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs text-foreground">
          {banner}
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No projects exist in this organization yet."
          description="Create a project first in Projects & Inventory or tell the AI Assistant in the right pane to configure a project."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-12 items-start">
          {/* LEFT PANE: PDF / Image Viewer + Provenance Evidence */}
          <Card className="lg:col-span-4">
            <CardHeader className="pb-3 space-y-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Source Plan Viewer
                </CardTitle>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1 text-xs">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span>
                      Pg {currentPage}/{pageCount}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      disabled={currentPage >= pageCount}
                      onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {projectDocs.length > 0 && (
                <Select
                  value={selectedDocId}
                  onValueChange={(id) => {
                    const found = projectDocs.find((d) => d.id === id);
                    if (found) void handleLoadExistingDocPreview(found);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select uploaded project floor plan..." />
                  </SelectTrigger>
                  <SelectContent>
                    {projectDocs.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.title} ({d.fileName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardHeader>

            <CardContent className="space-y-3">
              {previewUrl ? (
                <div className="overflow-hidden rounded-lg border border-border bg-secondary/30">
                  {previewMime === 'application/pdf' ? (
                    <iframe
                      key={`${previewUrl}_p${currentPage}`}
                      src={`${previewUrl}#page=${currentPage}`}
                      title="Floor Plan PDF Preview"
                      className="h-[420px] w-full"
                    />
                  ) : (
                    <img
                      src={previewUrl}
                      alt="Floor plan layout preview"
                      className="max-h-[420px] w-full object-contain"
                    />
                  )}
                </div>
              ) : (
                <div className="flex h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  <FileUp className="mb-2 h-7 w-7 text-muted-foreground/60" />
                  <p className="font-medium text-foreground">No floor plan loaded</p>
                  <p className="mt-1">
                    Upload a multi-page architectural PDF or PNG/JPEG layout above to extract
                    towers, typical floor templates, BHKs, and areas with page provenance.
                  </p>
                </div>
              )}

              {pageDimensions && (
                <div className="text-[11px] text-muted-foreground">
                  Inspected Geometry: <strong className="text-foreground">{pageDimensions}</strong>{' '}
                  • Total Pages: <strong className="text-foreground">{pageCount}</strong>
                </div>
              )}

              {/* Provenance Evidence List */}
              {draft && draft.extractedEvidence.length > 0 && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <div className="text-xs font-semibold text-foreground">
                    Field Provenance &amp; Confidence ({draft.extractedEvidence.length})
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-border rounded border border-border text-[11px]">
                    {draft.extractedEvidence.map((ev, i) => (
                      <div key={i} className="flex items-center justify-between px-2.5 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{ev.fieldPath}</div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {ev.sourceFileName ?? 'Wizard'}
                            {ev.sourcePage ? ` • Page ${ev.sourcePage}` : ''}
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">
                          {Math.round(ev.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* MIDDLE PANE: Inventory Hierarchy & Editable Extraction Table */}
          <div className="lg:col-span-5 space-y-4">
            {draft ? (
              <AiDraftReviewPanel
                draft={draft}
                sessionId={session?.id}
                onDraftMutated={(updated) => setDraft(updated)}
              />
            ) : (
              <Card>
                <CardContent className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center space-y-3">
                  <Sparkles className="h-8 w-8 text-primary/70" />
                  <div className="text-sm font-semibold text-foreground">
                    No Staged Inventory Draft Yet
                  </div>
                  <p className="max-w-md text-xs text-muted-foreground leading-relaxed">
                    Upload a floor-plan PDF on the left OR instruct the AI Co-Pilot on the right
                    (for example: &ldquo;Add Tower 1 with 25 floors, 4 apartments per floor, three
                    3 BHK and one 4 BHK, numbering 101–104&rdquo;) to generate a reviewable draft.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT PANE: Conversational AI Co-Pilot */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                AI Co-Pilot &amp; Clarifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-[420px] overflow-y-auto space-y-2.5 rounded-lg border border-border bg-secondary/20 p-3">
                {(!session || session.messages.length === 0) && (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p>Try saying:</p>
                    <button
                      type="button"
                      onClick={() =>
                        setChatInput(
                          'Add Tower 1 with 25 floors, 4 units per floor (three 3 BHK, one 4 BHK), numbering 101-104'
                        )
                      }
                      className="w-full rounded border border-border bg-card p-2 text-left text-[11px] hover:bg-secondary cursor-pointer"
                    >
                      &ldquo;Add Tower 1 with 25 floors, 4 units per floor (three 3 BHK, one 4 BHK),
                      numbering 101–104&rdquo;
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setChatInput('Skip floor 13 and mark floors 8 and 16 as refuge floors')
                      }
                      className="w-full rounded border border-border bg-card p-2 text-left text-[11px] hover:bg-secondary cursor-pointer"
                    >
                      &ldquo;Skip floor 13 and mark floors 8 and 16 as refuge floors&rdquo;
                    </button>
                  </div>
                )}

                {session?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                      m.role === 'USER'
                        ? 'ml-4 bg-primary text-primary-foreground'
                        : 'mr-2 border border-border bg-card text-foreground'
                    }`}
                  >
                    {m.content}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendStudioMessage} className="flex items-center gap-2">
                <Input
                  placeholder="Refine floors, BHKs, numbering..."
                  value={chatInput}
                  disabled={busy}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="h-9 text-xs"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={busy || !chatInput.trim()}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
