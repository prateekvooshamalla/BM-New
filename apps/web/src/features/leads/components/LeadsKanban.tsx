import * as React from 'react';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { formatInrCompact, LEAD_PIPELINE_ORDER, type Lead, type LeadStage } from '@bharat-makaan/shared';
import { cn } from '@/lib/utils';

export const LEAD_STAGES: LeadStage[] = [...LEAD_PIPELINE_ORDER, 'LOST', 'UNQUALIFIED'];

export function stageLabel(value: string) {
  return value.toLowerCase().replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function isCustomer(lead: Lead) {
  return Boolean(lead.isCustomer || lead.stage === 'BOOKED' || lead.stage === 'CLOSED');
}

function LeadCardBody({ lead }: { lead: Lead }) {
  const customer = isCustomer(lead);
  return (
    <>
      <div className="flex items-center justify-between gap-1.5">
        <div className="truncate text-sm font-semibold">{lead.customerName}</div>
        {customer ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ⭐ Customer
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
            Prospect
          </span>
        )}
      </div>
      <div className="truncate text-xs text-muted-foreground">{lead.normalizedPhone || lead.phone}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{stageLabel(lead.source)}</span>
        {lead.budgetMaxInr ? <span>· {formatInrCompact(lead.budgetMaxInr)}</span> : null}
      </div>
    </>
  );
}

function LeadCard({ lead, draggable, pending, onOpen }: {
  lead: Lead; draggable: boolean; pending: boolean; onOpen: (lead: Lead) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: lead.id, disabled: !draggable || pending,
  });

  return <article ref={setNodeRef} className={cn('flex rounded-lg border border-border bg-card shadow-xs', isDragging && 'opacity-35')}>
    <button type="button" onClick={() => onOpen(lead)} className="min-w-0 flex-1 rounded-lg p-3 text-left hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
      <LeadCardBody lead={lead} />
      {pending && <span className="mt-2 block text-xs text-muted-foreground">Saving stage…</span>}
    </button>
    {draggable && <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1}
      aria-label={`Drag ${lead.customerName}`} disabled={pending}
      className="touch-none cursor-grab self-start rounded-md p-2 text-muted-foreground hover:bg-accent active:cursor-grabbing disabled:cursor-wait">
      <GripVertical className="size-4" />
    </button>}
  </article>;
}

function StageColumn({ stage, leads, moving, children }: {
  stage: LeadStage; leads: Lead[]; moving: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return <section ref={setNodeRef} aria-label={stageLabel(stage)}
    className={cn('flex min-h-52 w-64 max-w-[82vw] shrink-0 flex-col rounded-xl border border-border bg-secondary/40 p-3 transition-colors',
      isOver && moving && 'border-primary bg-primary/10 ring-1 ring-primary/40')}>
    <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
      <h2 className="text-sm font-semibold">{stageLabel(stage)}</h2>
      <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium tabular-nums">{leads.length}</span>
    </div>
    <div className="flex-1 space-y-2">
      {children}
      {leads.length === 0 && <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
        {isOver && moving ? 'Drop here to move' : 'No leads in this stage'}
      </p>}
    </div>
  </section>;
}

export function LeadsKanban({ stages, leads, pending, canMove, onOpen, onMove }: {
  stages: LeadStage[]; leads: Lead[]; pending: string | null;
  canMove: (lead: Lead) => boolean; onOpen: (lead: Lead) => void; onMove: (lead: Lead, stage: LeadStage) => void;
}) {
  const [dragged, setDragged] = React.useState<Lead | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  return <DndContext sensors={sensors} collisionDetection={pointerWithin}
    onDragStart={({ active }) => setDragged(leads.find((lead) => lead.id === active.id) ?? null)}
    onDragCancel={() => setDragged(null)}
    onDragEnd={({ active, over }) => {
      setDragged(null);
      const lead = leads.find((item) => item.id === active.id);
      const stage = stages.find((item) => item === over?.id);
      if (lead && stage && lead.stage !== stage && canMove(lead)) onMove(lead, stage);
    }}>
    <div aria-label="Lead pipeline" className="flex min-w-0 max-w-full gap-3 overflow-x-auto p-1 pb-4">
      {stages.map((stage) => {
        const stageLeads = leads.filter((lead) => lead.stage === stage);
        return <StageColumn key={stage} stage={stage} leads={stageLeads} moving={Boolean(dragged && dragged.stage !== stage)}>
          {stageLeads.map((lead) => <LeadCard key={lead.id} lead={lead}
            draggable={stages.length > 1 && canMove(lead)} pending={pending === lead.id} onOpen={onOpen} />)}
        </StageColumn>;
      })}
    </div>
    <DragOverlay dropAnimation={null}>{dragged && <div className="w-60 rounded-lg border border-primary/40 bg-card p-3 shadow-lg">
      <LeadCardBody lead={dragged} />
    </div>}</DragOverlay>
  </DndContext>;
}
