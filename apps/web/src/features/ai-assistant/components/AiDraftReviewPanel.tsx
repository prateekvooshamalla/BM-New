import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileCheck2,
  Layers,
  ListTree,
  RefreshCw,
  Save,
  ShieldAlert,
  Table2,
  XCircle,
} from 'lucide-react';
import type {
  AiImportJob,
  AiInventoryDraft,
  AiProposedUnitRecord,
  FacingDirection,
  FloorCategory,
  UnitNumberingPattern,
} from '@bharat-makaan/shared';
import { hasPermission } from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FACING_OPTIONS: FacingDirection[] = [
  'EAST',
  'WEST',
  'NORTH',
  'SOUTH',
  'NORTH_EAST',
  'NORTH_WEST',
  'SOUTH_EAST',
  'SOUTH_WEST',
];

function parseFloorCsvOrRanges(raw: string): number[] {
  const result = new Set<number>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*[-–to]+\s*(\d+)$/i);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let f = lo; f <= hi && f <= 200; f += 1) {
        result.add(f);
      }
    } else if (/^\d+$/.test(trimmed)) {
      result.add(Number(trimmed));
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

interface AiDraftReviewPanelProps {
  draft: AiInventoryDraft;
  sessionId?: string;
  compact?: boolean;
  onDraftMutated?: (updated: AiInventoryDraft) => void;
}

export function AiDraftReviewPanel({
  draft,
  sessionId,
  compact = false,
  onDraftMutated,
}: AiDraftReviewPanelProps) {
  const navigate = useNavigate();
  const { activeOrgId, activeMember, isSuperAdmin } = useTenantStore();

  const [viewTab, setViewTab] = React.useState<'tree' | 'table'>('tree');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [importJob, setImportJob] = React.useState<AiImportJob | null>(null);

  // Structural Controls State
  const [towerName, setTowerName] = React.useState(draft.towerSpec?.name ?? '');
  const [towerCode, setTowerCode] = React.useState(draft.towerSpec?.code ?? '');
  const [totalFloors, setTotalFloors] = React.useState(
    String(draft.towerSpec?.totalFloors ?? '')
  );
  const [refugeCsv, setRefugeCsv] = React.useState(
    (draft.towerSpec?.refugeFloors ?? []).join(', ')
  );
  const [excludedCsv, setExcludedCsv] = React.useState(
    (draft.towerSpec?.excludedFloors ?? []).join(', ')
  );
  const [numberingPattern, setNumberingPattern] = React.useState<UnitNumberingPattern>(
    draft.floorTemplates[0]?.numberingPattern ?? 'FLOOR_INDEX_3DIGIT'
  );
  const [unboundedRangeInputs, setUnboundedRangeInputs] = React.useState<Record<string, string>>(
    {}
  );

  // Local Unit Row Edits
  const [editedRows, setEditedRows] = React.useState<
    Record<
      string,
      Partial<{
        operation: 'CREATE' | 'UPDATE' | 'SKIP';
        unitNumber: string;
        bhk: string;
        saleableAreaSqft: number;
        carpetAreaSqft: number;
        facing: FacingDirection;
      }>
    >
  >({});

  React.useEffect(() => {
    setTowerName(draft.towerSpec?.name ?? '');
    setTowerCode(draft.towerSpec?.code ?? '');
    setTotalFloors(String(draft.towerSpec?.totalFloors ?? ''));
    setRefugeCsv((draft.towerSpec?.refugeFloors ?? []).join(', '));
    setExcludedCsv((draft.towerSpec?.excludedFloors ?? []).join(', '));
    if (draft.floorTemplates[0]?.numberingPattern) {
      setNumberingPattern(draft.floorTemplates[0].numberingPattern);
    }
    setEditedRows({});
  }, [
    draft.id,
    draft.updatedAt,
    draft.towerSpec?.name,
    draft.towerSpec?.code,
    draft.towerSpec?.totalFloors,
    draft.towerSpec?.refugeFloors,
    draft.towerSpec?.excludedFloors,
    draft.floorTemplates,
  ]);

  // Subscribe to live ai_import_jobs progress if job exists
  React.useEffect(() => {
    if (!draft.committedJobId) {
      setImportJob(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'ai_import_jobs', draft.committedJobId),
      (snap) => {
        if (snap.exists()) {
          setImportJob(snap.data() as AiImportJob);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [draft.committedJobId]);

  const canManageInventory = React.useMemo(() => {
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
      draft.projectId
    );
  }, [activeMember, draft.projectId, isSuperAdmin]);

  const blockingErrors = draft.conflicts.filter((i) => i.severity === 'ERROR');
  const warnings = draft.conflicts.filter((i) => i.severity === 'WARNING');
  const unboundedTemplates = draft.floorTemplates.filter((t) => t.isTypicalUnbounded);

  const isCommitted = draft.status === 'COMMITTED';
  const isCancelled = draft.status === 'CANCELLED';
  const isReadOnly = isCommitted || isCancelled || !canManageInventory;

  // Group proposed units + refuge floors by floor descending
  const floorsGrouped = React.useMemo(() => {
    const floorMap = new Map<
      number,
      { label: string; floorCategory: FloorCategory; units: AiProposedUnitRecord[] }
    >();

    for (const rf of draft.towerSpec?.refugeFloors ?? []) {
      if ((draft.towerSpec?.excludedFloors ?? []).includes(rf)) continue;
      floorMap.set(rf, {
        label: `Refuge Floor ${rf}`,
        floorCategory: 'REFUGE',
        units: [],
      });
    }

    for (const u of draft.proposedUnits) {
      const existing = floorMap.get(u.floorNumber) ?? {
        label: u.floorLabel,
        floorCategory: u.floorCategory,
        units: [],
      };
      existing.units.push(u);
      floorMap.set(u.floorNumber, existing);
    }

    return Array.from(floorMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([floorNumber, entry]) => ({
        floorNumber,
        label: entry.label,
        floorCategory: entry.floorCategory,
        units: entry.units.sort((a, b) =>
          a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })
        ),
      }));
  }, [draft.proposedUnits, draft.towerSpec?.excludedFloors, draft.towerSpec?.refugeFloors]);

  const handleApplyStructureChanges = async () => {
    if (!activeOrgId || isReadOnly) return;
    setBusy(true);
    setFeedback(null);
    try {
      const parsedTotal = Number(totalFloors);
      const nextRefuge = parseFloorCsvOrRanges(refugeCsv);
      const nextExcluded = parseFloorCsvOrRanges(excludedCsv);

      const updatedTemplates = draft.floorTemplates.map((tpl) => {
        const rangeInput = unboundedRangeInputs[tpl.id];
        const explicitFloors = rangeInput ? parseFloorCsvOrRanges(rangeInput) : null;
        return {
          ...tpl,
          numberingPattern,
          ...(explicitFloors && explicitFloors.length > 0
            ? {
                applicableFloors: explicitFloors,
                isTypicalUnbounded: false,
              }
            : {}),
        };
      });

      const updated = await callBackendFunction<any, AiInventoryDraft>(
        'updateAiInventoryDraft',
        {
          orgId: activeOrgId,
          draftId: draft.id,
          projectId: draft.projectId,
          towerSpecPatch: draft.towerSpec
            ? {
                name: towerName.trim() || draft.towerSpec.name,
                code: towerCode.trim() || draft.towerSpec.code,
                totalFloors:
                  Number.isFinite(parsedTotal) && parsedTotal >= 0
                    ? parsedTotal
                    : draft.towerSpec.totalFloors,
                residentialEndFloor:
                  Number.isFinite(parsedTotal) && parsedTotal > 0
                    ? parsedTotal
                    : draft.towerSpec.residentialEndFloor,
                refugeFloors: nextRefuge,
                excludedFloors: nextExcluded,
              }
            : undefined,
          floorTemplatesPatch:
            updatedTemplates.length > 0 ? updatedTemplates : undefined,
        }
      );

      onDraftMutated?.(updated);
      setFeedback('Updated tower structure, numbering, and conflict checks.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to update draft structure.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveUnitEdits = async () => {
    if (!activeOrgId || isReadOnly) return;
    const entries = Object.entries(editedRows);
    if (entries.length === 0) return;

    setBusy(true);
    setFeedback(null);
    try {
      const unitEdits = entries.map(([tempId, patch]) => ({
        tempId,
        ...patch,
      }));
      const updated = await callBackendFunction<any, AiInventoryDraft>(
        'updateAiInventoryDraft',
        {
          orgId: activeOrgId,
          draftId: draft.id,
          unitEdits,
        }
      );
      setEditedRows({});
      onDraftMutated?.(updated);
      setFeedback(`Saved ${unitEdits.length} unit correction(s) with CORRECTED review status.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to save unit edits.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmAndCommit = async () => {
    if (!activeOrgId || isReadOnly) return;
    setBusy(true);
    setFeedback(null);
    try {
      const idempotencyKey = `commit_${draft.id}_${draft.updatedAt.replace(/[^0-9]/g, '').slice(0, 14) || 'v1'}`;
      const res = await callBackendFunction<
        any,
        { job: AiImportJob; createdTowerId?: string | null }
      >('confirmAndCommitAiDraft', {
        orgId: activeOrgId,
        sessionId,
        draftId: draft.id,
        idempotencyKey,
        confirmationNote: 'Reviewed and approved in Bharat Makaan AI Review Panel',
      });
      setImportJob(res.job);
      setFeedback(
        `Inventory committed (${res.job.completedOperations}/${res.job.totalOperations} operations).`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Inventory import failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelDraft = async () => {
    if (!activeOrgId || isCommitted || isCancelled) return;
    setBusy(true);
    setFeedback(null);
    try {
      await callBackendFunction('cancelAiInventoryDraft', {
        orgId: activeOrgId,
        sessionId,
        draftId: draft.id,
        reason: 'Cancelled by reviewer before commit',
      });
      setFeedback('Draft cancelled cleanly. Zero unintended inventory records were created.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to cancel draft.');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryJob = async () => {
    if (!activeOrgId || !importJob) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await callBackendFunction<any, { job: AiImportJob }>('retryAiImportJob', {
        orgId: activeOrgId,
        jobId: importJob.id,
      });
      setImportJob(res.job);
      setFeedback('Retried remaining import chunks idempotently without duplicates.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setBusy(false);
    }
  };

  const summaryItems = [
    { label: 'Towers to create', value: draft.changeSummary.towersToCreate },
    { label: 'Floors to create', value: draft.changeSummary.floorsToCreate },
    { label: 'Units to create', value: draft.changeSummary.unitsToCreate },
    { label: 'Units to update', value: draft.changeSummary.unitsToUpdate },
    { label: 'Duplicate records', value: draft.changeSummary.duplicateRecordsDetected },
    { label: 'Missing info', value: draft.changeSummary.missingInfoCount },
    { label: 'Documents to link', value: draft.changeSummary.documentsToLink },
    { label: 'Conflicts', value: draft.changeSummary.conflictsCount },
  ];

  return (
    <Card className="border-primary/25 shadow-sm">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">
              Staged Inventory Draft — {draft.towerSpec?.name ?? 'Untitled Structure'}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                ({draft.status.replace(/_/g, ' ')})
              </span>
            </CardTitle>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant={viewTab === 'tree' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewTab('tree')}
            >
              <ListTree className="h-3.5 w-3.5" />
              Hierarchy
            </Button>
            <Button
              type="button"
              variant={viewTab === 'table' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewTab('table')}
            >
              <Table2 className="h-3.5 w-3.5" />
              Edit Units ({draft.proposedUnits.length})
            </Button>
          </div>
        </div>

        {/* Change Summary Grid */}
        <div
          className={`grid gap-2 ${
            compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-8'
          }`}
        >
          {summaryItems.map((item) => {
            const isWarningMetric =
              (item.label === 'Conflicts' ||
                item.label === 'Duplicate records' ||
                item.label === 'Missing info') &&
              item.value > 0;
            return (
              <div
                key={item.label}
                className={`rounded-md border px-2.5 py-1.5 ${
                  isWarningMetric
                    ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/40'
                    : 'border-border bg-secondary/40'
                }`}
              >
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </div>
                <div className="text-sm font-bold text-foreground">{item.value}</div>
              </div>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {feedback && (
          <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground">
            {feedback}
          </div>
        )}

        {/* Unbounded Typical Floor Explicit Confirmation Card */}
        {unboundedTemplates.length > 0 && !isCommitted && !isCancelled && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100">
            <div className="flex items-start gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Floor Range Confirmation Required — Bharat Makaan never extrapolates unbounded
                &ldquo;Typical Floor&rdquo; PDFs without explicit confirmation.
              </span>
            </div>
            {unboundedTemplates.map((tpl) => (
              <div key={tpl.id} className="grid gap-2 sm:grid-cols-12 items-end">
                <div className="sm:col-span-8 space-y-1">
                  <Label className="text-xs">
                    Applicable floors for &ldquo;{tpl.label}&rdquo; ({tpl.unitsPerFloor} units/floor)
                  </Label>
                  <Input
                    placeholder="e.g., 1-24 or 2-12, 14-25"
                    value={unboundedRangeInputs[tpl.id] ?? ''}
                    onChange={(e) =>
                      setUnboundedRangeInputs((prev) => ({
                        ...prev,
                        [tpl.id]: e.target.value,
                      }))
                    }
                    className="h-8 text-xs bg-background"
                  />
                </div>
                <div className="sm:col-span-4">
                  <Button
                    type="button"
                    size="sm"
                    className="w-full h-8 text-xs"
                    disabled={busy || !unboundedRangeInputs[tpl.id]}
                    onClick={handleApplyStructureChanges}
                  >
                    Confirm Floor Range
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Blocking Errors & Warnings */}
        {(blockingErrors.length > 0 || warnings.length > 0) && (
          <div className="space-y-1.5">
            {blockingErrors.map((issue, idx) => (
              <div
                key={`err_${idx}`}
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold">[{issue.code}]</strong> {issue.message}
                </div>
              </div>
            ))}
            {warnings.map((issue, idx) => (
              <div
                key={`warn_${idx}`}
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold">[{issue.code}]</strong> {issue.message}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Interactive Structural & Numbering Controls */}
        {draft.towerSpec && !isReadOnly && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-primary" />
              Structure, Floor Exclusions &amp; Numbering Controls
            </div>
            <div
              className={`grid gap-2.5 ${
                compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
              }`}
            >
              <div className="space-y-1">
                <Label className="text-[11px]">Tower / Sector Name</Label>
                <Input
                  className="h-8 text-xs"
                  value={towerName}
                  onChange={(e) => setTowerName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Code</Label>
                <Input
                  className="h-8 text-xs"
                  value={towerCode}
                  onChange={(e) => setTowerCode(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Total Floors</Label>
                <Input
                  type="number"
                  min={0}
                  max={200}
                  className="h-8 text-xs"
                  value={totalFloors}
                  onChange={(e) => setTotalFloors(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Refuge Floors</Label>
                <Input
                  placeholder="e.g., 8, 16"
                  className="h-8 text-xs"
                  value={refugeCsv}
                  onChange={(e) => setRefugeCsv(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Skipped Floors</Label>
                <Input
                  placeholder="e.g., 13"
                  className="h-8 text-xs"
                  value={excludedCsv}
                  onChange={(e) => setExcludedCsv(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Numbering Pattern</Label>
                <Select
                  value={numberingPattern}
                  onValueChange={(v) => setNumberingPattern(v as UnitNumberingPattern)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLOOR_INDEX_3DIGIT">101–104 / 1201–1204</SelectItem>
                    <SelectItem value="TOWER_FLOOR_INDEX">T1-101 / T1-1201</SelectItem>
                    <SelectItem value="SEQUENTIAL_GROUND">Sequential (1, 2, 3...)</SelectItem>
                    <SelectItem value="CUSTOM_PREFIX">Custom Prefix</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                disabled={busy}
                onClick={handleApplyStructureChanges}
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate Preview
              </Button>
            </div>
          </div>
        )}

        {/* View 1: Inventory Hierarchy Tree */}
        {viewTab === 'tree' && (
          <div className="max-h-[380px] overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {floorsGrouped.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">
                No floors generated yet. Answer remaining questions or confirm floor ranges above.
              </div>
            ) : (
              floorsGrouped.map((floorEntry) => (
                <div key={floorEntry.floorNumber} className="p-2.5 space-y-1.5 bg-card/60">
                  <div className="flex items-center justify-between text-xs">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      <span>{floorEntry.label}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {floorEntry.floorCategory}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {floorEntry.floorCategory === 'REFUGE'
                        ? 'Refuge / Safety Level (0 saleable units)'
                        : `${floorEntry.units.filter((u) => u.operation !== 'SKIP').length} unit(s)`}
                    </span>
                  </div>
                  {floorEntry.units.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {floorEntry.units.map((u) => (
                        <div
                          key={u.tempId}
                          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
                            u.operation === 'SKIP'
                              ? 'border-dashed border-muted-foreground/40 text-muted-foreground line-through'
                              : u.operation === 'UPDATE'
                                ? 'border-blue-300 bg-blue-50/70 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100'
                                : 'border-emerald-300 bg-emerald-50/70 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                          }`}
                        >
                          <span className="font-semibold">{u.unitNumber}</span>
                          <span>• {u.bhk}</span>
                          {u.saleableAreaSqft ? <span>• {u.saleableAreaSqft} sqft</span> : null}
                          {u.facing ? <span>• {u.facing}</span> : null}
                          {u.floorPlanDocumentId ? (
                            <FileCheck2
                              className="h-3 w-3 text-primary"
                              aria-label="Floor plan linked"
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* View 2: Editable Unit Extraction Table with Provenance */}
        {viewTab === 'table' && (
          <div className="space-y-2">
            <div className="max-h-[380px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-secondary text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2">Action</th>
                    <th className="px-2.5 py-2">Floor</th>
                    <th className="px-2.5 py-2">Unit #</th>
                    <th className="px-2.5 py-2">BHK / Config</th>
                    <th className="px-2.5 py-2">Saleable</th>
                    <th className="px-2.5 py-2">Carpet</th>
                    <th className="px-2.5 py-2">Facing</th>
                    <th className="px-2.5 py-2">Provenance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {draft.proposedUnits.map((u) => {
                    const patch = editedRows[u.tempId] ?? {};
                    const op = patch.operation ?? u.operation;
                    const unitNo = patch.unitNumber ?? u.unitNumber;
                    const bhkVal = patch.bhk ?? u.bhk;
                    const saleableVal = patch.saleableAreaSqft ?? u.saleableAreaSqft ?? '';
                    const carpetVal = patch.carpetAreaSqft ?? u.carpetAreaSqft ?? '';
                    const facingVal = patch.facing ?? u.facing ?? 'EAST';

                    return (
                      <tr key={u.tempId} className={op === 'SKIP' ? 'opacity-50' : ''}>
                        <td className="px-2 py-1.5">
                          <select
                            disabled={isReadOnly}
                            value={op}
                            onChange={(e) =>
                              setEditedRows((prev) => ({
                                ...prev,
                                [u.tempId]: {
                                  ...prev[u.tempId],
                                  operation: e.target.value as 'CREATE' | 'UPDATE' | 'SKIP',
                                },
                              }))
                            }
                            className="rounded border border-border bg-background px-1.5 py-1 text-[11px]"
                          >
                            <option value="CREATE">CREATE</option>
                            {u.existingUnitId && <option value="UPDATE">UPDATE</option>}
                            <option value="SKIP">SKIP</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5 font-medium">{u.floorNumber}</td>
                        <td className="px-2 py-1.5">
                          <Input
                            disabled={isReadOnly}
                            className="h-7 w-24 text-xs"
                            value={unitNo}
                            onChange={(e) =>
                              setEditedRows((prev) => ({
                                ...prev,
                                [u.tempId]: { ...prev[u.tempId], unitNumber: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            disabled={isReadOnly}
                            className="h-7 w-24 text-xs"
                            value={bhkVal}
                            onChange={(e) =>
                              setEditedRows((prev) => ({
                                ...prev,
                                [u.tempId]: { ...prev[u.tempId], bhk: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            disabled={isReadOnly}
                            type="number"
                            className="h-7 w-20 text-xs"
                            value={saleableVal}
                            onChange={(e) =>
                              setEditedRows((prev) => ({
                                ...prev,
                                [u.tempId]: {
                                  ...prev[u.tempId],
                                  saleableAreaSqft: Number(e.target.value) || undefined,
                                },
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            disabled={isReadOnly}
                            type="number"
                            className="h-7 w-20 text-xs"
                            value={carpetVal}
                            onChange={(e) =>
                              setEditedRows((prev) => ({
                                ...prev,
                                [u.tempId]: {
                                  ...prev[u.tempId],
                                  carpetAreaSqft: Number(e.target.value) || undefined,
                                },
                              }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            disabled={isReadOnly}
                            value={facingVal}
                            onChange={(e) =>
                              setEditedRows((prev) => ({
                                ...prev,
                                [u.tempId]: {
                                  ...prev[u.tempId],
                                  facing: e.target.value as FacingDirection,
                                },
                              }))
                            }
                            className="rounded border border-border bg-background px-1.5 py-1 text-[11px]"
                          >
                            {FACING_OPTIONS.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                          {u.reviewStatus === 'CORRECTED'
                            ? 'USER_CORRECTED'
                            : `${u.sourcePage ? `Pg ${u.sourcePage} • ` : ''}${Math.round(
                                u.confidence * 100
                              )}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {Object.keys(editedRows).length > 0 && !isReadOnly && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={handleSaveUnitEdits}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save {Object.keys(editedRows).length} Unit Edit(s)
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Live Chunked Import Job Progress */}
        {importJob && (
          <div className="rounded-md border border-border bg-secondary/50 p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between font-medium">
              <span>
                Import Job: {importJob.status} ({importJob.completedOperations}/
                {importJob.totalOperations} records)
              </span>
              <span>
                {importJob.totalOperations > 0
                  ? Math.round(
                      (importJob.completedOperations / importJob.totalOperations) * 100
                    )
                  : 100}
                %
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${
                    importJob.totalOperations > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (importJob.completedOperations / importJob.totalOperations) * 100
                          )
                        )
                      : 100
                  }%`,
                }}
              />
            </div>
            {(importJob.status === 'PARTIAL_FAILURE_RECOVERABLE' ||
              importJob.status === 'ROLLED_BACK') &&
              canManageInventory && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-destructive">{importJob.errorMessage}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={handleRetryJob}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry Remaining Chunks
                  </Button>
                </div>
              )}
          </div>
        )}

        {/* Action Footer */}
        {isCommitted ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3 space-y-2.5 dark:border-emerald-800 dark:bg-emerald-950/40">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-100">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Inventory created and linked to project records. What would you like to configure next?
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate('/app/inventory')}
              >
                Open Visual Inventory
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate('/app/pricing')}
              >
                Configure Price Book
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate('/app/parking')}
              >
                Configure Parking Slots
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate('/app/documents')}
              >
                Floor Plan Mappings
              </Button>
            </div>
          </div>
        ) : !isCancelled ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            {!canManageInventory ? (
              <span className="text-xs text-muted-foreground">
                Read-only preview: `inventory:manage` permission is required to commit records.
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                New units are created as unpublished internal inventory (`AVAILABLE`) with no
                fabricated prices.
              </span>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={busy}
                onClick={handleCancelDraft}
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel Draft
              </Button>
              {canManageInventory && (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={
                    busy ||
                    !draft.changeSummary.readyToCommit ||
                    blockingErrors.length > 0 ||
                    unboundedTemplates.length > 0 ||
                    draft.missingQuestions.length > 0 ||
                    Object.keys(editedRows).length > 0
                  }
                  onClick={handleConfirmAndCommit}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve &amp; Create Inventory
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
