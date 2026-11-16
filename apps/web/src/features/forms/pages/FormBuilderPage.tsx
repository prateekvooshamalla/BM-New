import * as React from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { QRCodeSVG } from 'qrcode.react';
import { Code2, ExternalLink, GripVertical, Plus, QrCode, Trash2 } from 'lucide-react';
import type {
  FormFieldDefinition,
  FormFieldType,
  FormSubmission,
  LeadCaptureForm,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FIELD_TYPES: FormFieldType[] = [
  'TEXT',
  'PHONE',
  'EMAIL',
  'NUMBER',
  'DROPDOWN',
  'CHECKBOX',
  'RADIO',
  'DATE',
  'BUDGET',
  'PROPERTY_INTEREST',
  'PROJECT_SELECTOR',
  'BHK',
];

function SortableFieldCard({
  field,
  allFields,
  onUpdate,
  onRemove,
}: {
  field: FormFieldDefinition;
  allFields: FormFieldDefinition[];
  onUpdate: (patch: Partial<FormFieldDefinition>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: field.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-2xs"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground hover:text-foreground"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <Input
          className="h-8 flex-1 text-xs font-medium"
          value={field.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Field Label"
        />

        <Select value={field.type} onValueChange={(v: any) => onUpdate({ type: v })}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((ft) => (
              <SelectItem key={ft} value={ft}>
                {ft.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-1.5 text-[11px]">
          <Switch
            checked={field.required}
            onCheckedChange={(v) => onUpdate({ required: v })}
          />
          Req
        </label>

        <button
          type="button"
          onClick={onRemove}
          className="text-destructive p-1 cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {(field.type === 'DROPDOWN' || field.type === 'RADIO' || field.type === 'BHK') && (
        <Input
          className="h-7 text-xs"
          placeholder="Comma-separated options (e.g. 2 BHK, 3 BHK, 4 BHK)"
          value={(field.options ?? []).join(', ')}
          onChange={(e) =>
            onUpdate({
              options: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      )}

      {/* Conditional Visibility Rule */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Show only if:</span>
        <Select
          value={field.condition?.dependsOnFieldId || '__ALWAYS__'}
          onValueChange={(v) =>
            onUpdate({
              condition:
                v === '__ALWAYS__'
                  ? undefined
                  : { dependsOnFieldId: v, equalsValue: field.condition?.equalsValue ?? '' },
            })
          }
        >
          <SelectTrigger className="h-7 w-40 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__ALWAYS__">Always Visible</SelectItem>
            {allFields
              .filter((f) => f.id !== field.id)
              .map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {field.condition && (
          <Input
            className="h-7 w-36 text-[11px]"
            placeholder="Equals value..."
            value={field.condition.equalsValue}
            onChange={(e) =>
              onUpdate({
                condition: {
                  dependsOnFieldId: field.condition!.dependsOnFieldId,
                  equalsValue: e.target.value,
                },
              })
            }
          />
        )}
      </div>
    </div>
  );
}

export function FormBuilderPage() {
  const { activeOrgId, projects } = useTenantStore();
  const [forms, setForms] = React.useState<LeadCaptureForm[]>([]);
  const [submissions, setSubmissions] = React.useState<FormSubmission[]>([]);
  const [selectedForm, setSelectedForm] = React.useState<LeadCaptureForm | null>(null);

  // Designer State
  const [formName, setFormName] = React.useState('Website Project Enquiry Form');
  const [formSlug, setFormSlug] = React.useState(() => `enquiry-${Date.now().toString().slice(-5)}`);
  const [projectId, setProjectId] = React.useState<string>('');
  const [headline, setHeadline] = React.useState('Register Your Interest & Download Brochure');
  const [description, setDescription] = React.useState('Our relationship manager will share approved floor plans and pricing.');
  const [consentText, setConsentText] = React.useState(
    'I authorize the builder team to contact me via Phone, WhatsApp, or Email regarding this project.'
  );
  const [successMsg, setSuccessMsg] = React.useState(
    'Thank you! Your enquiry has been registered and assigned to a dedicated advisor.'
  );
  const [fields, setFields] = React.useState<FormFieldDefinition[]>([
    { id: 'f-name', type: 'TEXT', label: 'Full Name', required: true, order: 0 },
    { id: 'f-phone', type: 'PHONE', label: 'Mobile Number', required: true, order: 1 },
    { id: 'f-email', type: 'EMAIL', label: 'Email Address', required: false, order: 2 },
    { id: 'f-bhk', type: 'BHK', label: 'Preferred Configuration', required: false, options: ['2 BHK', '3 BHK', '4 BHK'], order: 3 },
    { id: 'f-budget', type: 'BUDGET', label: 'Approximate Budget (INR)', required: false, order: 4 },
  ]);

  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const sensors = useSensors(useSensor(PointerSensor));

  React.useEffect(() => {
    if (!activeOrgId) return;

    const uForms = onSnapshot(
      query(collection(db, 'forms'), where('orgId', '==', activeOrgId)),
      (s) => {
        const list = s.docs.map((d) => d.data() as LeadCaptureForm);
        setForms(list);
        if (!selectedForm && list[0]) setSelectedForm(list[0]);
      }
    );

    const uSubs = onSnapshot(
      query(collection(db, 'form_submissions'), where('orgId', '==', activeOrgId)),
      (s) => setSubmissions(s.docs.map((d) => d.data() as FormSubmission)),
      () => setSubmissions([])
    );

    return () => {
      uForms();
      uSubs();
    };
  }, [activeOrgId]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFields((items) => {
      const oldIdx = items.findIndex((i) => i.id === active.id);
      const newIdx = items.findIndex((i) => i.id === over.id);
      return arrayMove(items, oldIdx, newIdx).map((f, idx) => ({ ...f, order: idx }));
    });
  };

  const handleAddField = () => {
    const id = `f-${Date.now()}`;
    setFields((prev) => [
      ...prev,
      { id, type: 'TEXT', label: 'Custom Question', required: false, order: prev.length },
    ]);
  };

  const handlePublishForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const saved = await callBackendFunction<any, LeadCaptureForm>('upsertLeadForm', {
        orgId: activeOrgId,
        projectId: projectId || null,
        name: formName,
        slug: formSlug,
        status: 'PUBLISHED',
        fields,
        branding: {
          headline,
          description,
          accentColor: '#0F265C',
        },
        consentText,
        successMessage: successMsg,
        honeypotEnabled: true,
        rateLimitPerHour: 120,
      });
      setSelectedForm(saved);
      setBanner(`Published hosted form at /f/${saved.slug}!`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to publish form.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={QrCode}
        title="No builder organization selected."
        description="Select a builder organization to design hosted & embedded lead capture forms."
      />
    );
  }

  const hostedUrl = selectedForm
    ? `${window.location.origin}/f/${selectedForm.slug}`
    : '';
  const iframeEmbed = selectedForm
    ? `<iframe src="${hostedUrl}" width="100%" height="640" style="border:0;border-radius:12px;" title="${selectedForm.name}"></iframe>`
    : '';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Universal Lead Capture"
        title="Visual Drag-and-Drop Form Builder"
        description="Design conditional lead forms with honeypot/rate-limit protection, QR codes, hosted URLs, and iframe embeds."
      />

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
          {banner}
        </div>
      )}

      <Tabs defaultValue="designer">
        <TabsList>
          <TabsTrigger value="designer">Visual Designer</TabsTrigger>
          <TabsTrigger value="published">Published Forms & QR ({forms.length})</TabsTrigger>
          <TabsTrigger value="submissions">Submission History ({submissions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="designer">
          <form onSubmit={handlePublishForm} className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Drag-and-Drop Fields ({fields.length})</CardTitle>
                  <CardDescription>
                    Reorder fields by dragging the handle; configure conditional visibility per field.
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleAddField}>
                  <Plus className="h-3.5 w-3.5" /> Add Field
                </Button>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={fields.map((f) => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {fields.map((field, idx) => (
                      <SortableFieldCard
                        key={field.id}
                        field={field}
                        allFields={fields}
                        onUpdate={(patch) =>
                          setFields((prev) =>
                            prev.map((f, i) => (i === idx ? { ...f, ...patch } : f))
                          )
                        }
                        onRemove={() =>
                          setFields((prev) => prev.filter((_, i) => i !== idx))
                        }
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </CardContent>
            </Card>

            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-sm">Branding, Attribution & Spam Protection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Internal Form Name *</Label>
                  <Input required value={formName} onChange={(e) => setFormName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label>URL Slug *</Label>
                    <Input required value={formSlug} onChange={(e) => setFormSlug(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Link to Project</Label>
                    <Select value={projectId || '__NONE__'} onValueChange={(v) => setProjectId(v === '__NONE__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NONE__">Organization-Wide</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Public Headline *</Label>
                  <Input required value={headline} onChange={(e) => setHeadline(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Mandatory Consent Checkbox Text *</Label>
                  <Input required value={consentText} onChange={(e) => setConsentText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Post-Submission Message *</Label>
                  <Input required value={successMsg} onChange={(e) => setSuccessMsg(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Publishing...' : 'Save & Publish Form'}
                </Button>
              </CardContent>
            </Card>
          </form>
        </TabsContent>

        <TabsContent value="published">
          {forms.length === 0 ? (
            <EmptyState
              icon={QrCode}
              title="No published forms yet."
              description="Publish a form in the Visual Designer tab to generate hosted URLs, QR codes, and iframe embed snippets."
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-6 space-y-2.5">
                {forms.map((f) => (
                  <div
                    key={f.id}
                    onClick={() => setSelectedForm(f)}
                    className={`rounded-lg border p-4 cursor-pointer ${
                      selectedForm?.id === f.id ? 'border-primary bg-accent/40' : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{f.name}</span>
                      <StatusBadge status={f.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      /f/{f.slug} • {f.submissionsCount} submissions
                    </div>
                  </div>
                ))}
              </div>

              {selectedForm && (
                <Card className="lg:col-span-6">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Share, Embed & QR Code — {selectedForm.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-xs">
                    <div className="flex items-center gap-4">
                      <div className="rounded-lg border border-border bg-white p-3">
                        <QRCodeSVG value={hostedUrl} size={112} />
                      </div>
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="font-semibold">Hosted Form URL</div>
                        <div className="truncate rounded border border-border bg-secondary p-2 font-mono">
                          {hostedUrl}
                        </div>
                        <Button variant="outline" size="sm" asChild>
                          <a href={hostedUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" /> Open Hosted Form
                          </a>
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <Code2 className="h-3.5 w-3.5" /> iframe Embed Code
                      </div>
                      <pre className="overflow-x-auto rounded border border-border bg-secondary p-2.5 font-mono text-[11px]">
                        {iframeEmbed}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="submissions">
          <DataTable
            data={submissions}
            emptyMessage="No form submissions captured yet."
            columns={[
              { accessorKey: 'formId', header: 'Form ID' },
              { accessorKey: 'resultingLeadId', header: 'Linked Lead ID' },
              {
                accessorKey: 'isDuplicate',
                header: 'Dedup Status',
                cell: ({ row }) => (row.original.isDuplicate ? 'Merged Existing' : 'Net New Lead'),
              },
              {
                accessorKey: 'submittedAt',
                header: 'Submitted At',
                cell: ({ row }) => new Date(row.original.submittedAt).toLocaleString(),
              },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
