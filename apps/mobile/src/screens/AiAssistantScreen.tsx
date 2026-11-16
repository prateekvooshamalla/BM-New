import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { DESIGN_TOKENS } from '@bharat-makaan/config';
import {
  hasPermission,
  type AiAssistantSession,
  type AiImportJob,
  type AiInventoryDraft,
  type DocumentRecord,
} from '@bharat-makaan/shared';
import {
  callMobileBackend,
  mobileDb,
  pickAndUploadFloorPlanPdf,
  pickAndUploadSitePhoto,
} from '../services/firebase';
import { useMobileStore } from '../state/useMobileStore';
import {
  NativeButton,
  NativeCard,
  NativeEmptyState,
  NativeInput,
  NativeStatusPill,
} from '../components/NativePrimitives';

const palette = DESIGN_TOKENS.colors.light;

export function AiAssistantScreen() {
  const {
    activeOrgId,
    activeProjectId,
    activeMember,
    isSuperAdmin,
    projects,
    selectProject,
  } = useMobileStore();

  const effectiveProjectId = activeProjectId ?? projects[0]?.id ?? null;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<AiAssistantSession | null>(null);
  const [draft, setDraft] = useState<AiInventoryDraft | null>(null);
  const [messageText, setMessageText] = useState('');
  const [floorRangeInput, setFloorRangeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canManageInventory =
    isSuperAdmin ||
    hasPermission(
      activeMember
        ? {
            status: activeMember.status,
            role: activeMember.role,
            permissions: activeMember.permissions,
            assignedProjectIds: activeMember.assignedProjectIds,
          }
        : null,
      'inventory:manage',
      effectiveProjectId
    );

  // Subscribe to live session & draft
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(
      doc(mobileDb, 'ai_sessions', sessionId),
      (snap) => {
        if (snap.exists()) {
          setSession(snap.data() as AiAssistantSession);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [sessionId]);

  useEffect(() => {
    if (!session?.draftId) {
      setDraft(null);
      return;
    }
    const unsub = onSnapshot(
      doc(mobileDb, 'ai_inventory_drafts', session.draftId),
      (snap) => {
        if (snap.exists()) {
          setDraft(snap.data() as AiInventoryDraft);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [session?.draftId]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (!activeOrgId) return null;
    if (sessionId) return sessionId;

    const created = await callMobileBackend<any, AiAssistantSession>(
      'createAiAssistantSession',
      {
        orgId: activeOrgId,
        projectId: effectiveProjectId,
        title: 'Mobile AI Assistant Session',
        contextSnapshot: {
          currentRoute: 'mobile://More/AiAssistant',
          activeProjectId: effectiveProjectId,
        },
      }
    );
    setSession(created);
    setSessionId(created.id);
    return created.id;
  }, [activeOrgId, effectiveProjectId, sessionId]);

  const handleSend = async (explicitPrompt?: string) => {
    const text = (explicitPrompt ?? messageText).trim();
    if (!text || !activeOrgId) return;
    setBusy(true);
    setNotice(null);
    try {
      const sid = await ensureSession();
      if (!sid) return;
      const res = await callMobileBackend<
        any,
        { session: AiAssistantSession; draft: AiInventoryDraft | null }
      >('sendAiAssistantMessage', {
        orgId: activeOrgId,
        sessionId: sid,
        message: text,
        contextSnapshot: {
          currentRoute: 'mobile://More/AiAssistant',
          activeProjectId: effectiveProjectId,
        },
      });
      setSession(res.session);
      if (res.draft) setDraft(res.draft);
      if (!explicitPrompt) setMessageText('');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setBusy(false);
    }
  };

  const handlePickAndAnalyzeFloorPlan = async (mode: 'PDF' | 'PHOTO') => {
    if (!activeOrgId || !effectiveProjectId) {
      setNotice('Select a project first before uploading a floor-plan PDF or photo.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const sid = await ensureSession();
      if (!sid) return;

      const uploaded = (
        mode === 'PDF'
          ? await pickAndUploadFloorPlanPdf(activeOrgId, effectiveProjectId)
          : await pickAndUploadSitePhoto(activeOrgId, effectiveProjectId)
      ) as DocumentRecord | null;

      if (!uploaded) {
        setBusy(false);
        return;
      }

      const res = await callMobileBackend<
        any,
        { draft: AiInventoryDraft; summaryMessage: string }
      >('analyzeAiFloorPlanDocuments', {
        orgId: activeOrgId,
        projectId: effectiveProjectId,
        sessionId: sid,
        documents: [
          {
            documentId: uploaded.id,
            title: uploaded.title,
            fileName: uploaded.fileName,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
            storagePath: uploaded.storagePath,
          },
        ],
      });
      setDraft(res.draft);
      setNotice(res.summaryMessage);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Document extraction failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmFloorRange = async () => {
    if (!activeOrgId || !draft || !floorRangeInput.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const floors: number[] = [];
      for (const token of floorRangeInput.split(',')) {
        const t = token.trim();
        const m = t.match(/^(\d+)\s*[-–]\s*(\d+)$/);
        if (m) {
          const lo = Math.min(Number(m[1]), Number(m[2]));
          const hi = Math.max(Number(m[1]), Number(m[2]));
          for (let f = lo; f <= hi && f <= 200; f += 1) floors.push(f);
        } else if (/^\d+$/.test(t)) {
          floors.push(Number(t));
        }
      }
      if (floors.length === 0) return;

      const updated = await callMobileBackend<any, AiInventoryDraft>(
        'updateAiInventoryDraft',
        {
          orgId: activeOrgId,
          draftId: draft.id,
          floorTemplatesPatch: draft.floorTemplates.map((tpl) => ({
            ...tpl,
            applicableFloors: tpl.isTypicalUnbounded ? floors : tpl.applicableFloors,
            isTypicalUnbounded: false,
          })),
        }
      );
      setDraft(updated);
      setFloorRangeInput('');
      setNotice('Confirmed floor range and regenerated unit preview.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to update floor range.');
    } finally {
      setBusy(false);
    }
  };

  const handleCommitDraft = async () => {
    if (!activeOrgId || !draft || !canManageInventory) return;
    setBusy(true);
    setNotice(null);
    try {
      const idempotencyKey = `mob_commit_${draft.id}_${draft.updatedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;
      const res = await callMobileBackend<any, { job: AiImportJob }>(
        'confirmAndCommitAiDraft',
        {
          orgId: activeOrgId,
          sessionId: session?.id,
          draftId: draft.id,
          idempotencyKey,
          confirmationNote: 'Approved from Bharat Makaan Mobile App',
        }
      );
      setNotice(
        `Committed ${res.job.completedOperations}/${res.job.totalOperations} inventory records.`
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Commit failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelDraft = async () => {
    if (!activeOrgId || !draft) return;
    setBusy(true);
    setNotice(null);
    try {
      await callMobileBackend('cancelAiInventoryDraft', {
        orgId: activeOrgId,
        sessionId: session?.id,
        draftId: draft.id,
        reason: 'Cancelled from Mobile AI Assistant',
      });
      setNotice('Draft cancelled cleanly with zero unintended writes.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <NativeEmptyState
        title="Select an Organization"
        description="Switch or create an organization in Settings to use the AI Assistant."
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Active Project Selector Strip */}
      {projects.length > 0 && (
        <NativeCard>
          <Text style={styles.sectionTitle}>Project Scope</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {projects.map((p) => (
                <NativeButton
                  key={p.id}
                  variant={p.id === effectiveProjectId ? 'primary' : 'outline'}
                  label={`${p.name} (${p.code})`}
                  onPress={() => selectProject(p.id)}
                />
              ))}
            </View>
          </ScrollView>
        </NativeCard>
      )}

      {/* Quick Prompts */}
      <NativeCard>
        <Text style={styles.sectionTitle}>Quick AI Actions</Text>
        <View style={styles.chipWrap}>
          <NativeButton
            variant="outline"
            label="Add Tower 1"
            disabled={busy}
            onPress={() => handleSend('Add Tower 1')}
          />
          <NativeButton
            variant="outline"
            label="Available 3 BHKs"
            disabled={busy}
            onPress={() => handleSend('Show all available 3 BHK apartments')}
          />
          <NativeButton
            variant="outline"
            label="Missing Plans"
            disabled={busy}
            onPress={() => handleSend('Which units are missing floor plans?')}
          />
        </View>
        {canManageInventory && (
          <View style={[styles.chipWrap, { marginTop: 8 }]}>
            <NativeButton
              variant="outline"
              label="Upload Floor-Plan PDF"
              disabled={busy}
              onPress={() => handlePickAndAnalyzeFloorPlan('PDF')}
            />
            <NativeButton
              variant="outline"
              label="Upload Plan Photo"
              disabled={busy}
              onPress={() => handlePickAndAnalyzeFloorPlan('PHOTO')}
            />
          </View>
        )}
      </NativeCard>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {/* Conversation Stream */}
      <NativeCard>
        <Text style={styles.sectionTitle}>Conversation</Text>
        {!session || session.messages.length === 0 ? (
          <Text style={styles.subtle}>
            Ask about unit availability, leads, or configure towers, floors, and numbering in
            natural language.
          </Text>
        ) : (
          session.messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                m.role === 'USER' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text
                style={
                  m.role === 'USER' ? styles.userBubbleText : styles.assistantBubbleText
                }
              >
                {m.content}
              </Text>
            </View>
          ))
        )}

        <View style={{ marginTop: 10 }}>
          <NativeInput
            placeholder="Message Bharat Makaan AI..."
            value={messageText}
            onChangeText={setMessageText}
          />
          <NativeButton
            label="Send Message"
            loading={busy}
            disabled={!messageText.trim()}
            onPress={() => handleSend()}
          />
        </View>
      </NativeCard>

      {/* Staged Draft Review Card */}
      {draft && (
        <NativeCard>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>
              Staged Draft: {draft.towerSpec.name ?? 'Inventory Structure'}
            </Text>
            <NativeStatusPill status={draft.status} />
          </View>

          <Text style={styles.subtle}>
            Towers: {draft.changeSummary.towersToCreate} • Floors:{' '}
            {draft.changeSummary.floorsToCreate} • Units to create:{' '}
            {draft.changeSummary.unitsToCreate} • Conflicts:{' '}
            {draft.changeSummary.conflictsCount}
          </Text>

          {draft.floorTemplates.some((t) => t.isTypicalUnbounded) && (
            <View style={{ marginTop: 10 }}>
              <NativeInput
                label="Confirm Applicable Floor Range for Typical Plan"
                placeholder="e.g. 1-24"
                value={floorRangeInput}
                onChangeText={setFloorRangeInput}
              />
              <NativeButton
                variant="outline"
                label="Confirm Floor Range"
                loading={busy}
                onPress={handleConfirmFloorRange}
              />
            </View>
          )}

          {draft.conflicts.map((c, idx) => (
            <Text key={idx} style={styles.conflictText}>
              [{c.severity}] {c.message}
            </Text>
          ))}

          {draft.status !== 'COMMITTED' && draft.status !== 'CANCELLED' && (
            <View style={[styles.chipWrap, { marginTop: 12 }]}>
              {canManageInventory && (
                <NativeButton
                  label="Approve & Create Inventory"
                  loading={busy}
                  disabled={!draft.changeSummary.readyToCommit}
                  onPress={handleCommitDraft}
                />
              )}
              <NativeButton
                variant="danger"
                label="Cancel Draft"
                disabled={busy}
                onPress={handleCancelDraft}
              />
            </View>
          )}
        </NativeCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.foreground,
    marginBottom: 6,
  },
  subtle: {
    fontSize: 12,
    color: palette.mutedForeground,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  bubble: {
    borderRadius: 10,
    padding: 10,
    marginVertical: 4,
  },
  userBubble: {
    backgroundColor: palette.primary,
    alignSelf: 'flex-end',
    maxWidth: '88%',
  },
  assistantBubble: {
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    alignSelf: 'flex-start',
    maxWidth: '94%',
  },
  userBubbleText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 17,
  },
  assistantBubbleText: {
    color: palette.foreground,
    fontSize: 12,
    lineHeight: 17,
  },
  notice: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: palette.surfaceMuted,
    color: palette.foreground,
    fontSize: 12,
  },
  conflictText: {
    marginTop: 4,
    fontSize: 11,
    color: palette.danger,
  },
});
