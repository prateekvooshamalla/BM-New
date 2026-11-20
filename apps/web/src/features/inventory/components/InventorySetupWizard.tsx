import * as React from 'react';
import { Building2, Check, FileImage, Loader2, MapPin, UploadCloud } from 'lucide-react';
import { ref, uploadBytes } from 'firebase/storage';
import { createProjectSchema } from '@bharat-makaan/validation';
import { formatInr, hasPermission, type DocumentRecord, type Project, type Tower, type Unit } from '@bharat-makaan/shared';
import { callBackendFunction, storage } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AmenityPicker, SetupField, SetupSelect, UnitDetailsFields, UnitPricingFields, UnitRoomFields } from './InventorySetupFields';
import { createUnitDraft, PLAN_FILE_TYPES, PROJECT_AMENITIES, roomFieldsSchema, roomPayload, unitPayload, validatePlanFile, validateUnitDraft } from './inventory-setup';

function PlanUpload({ label, file, onChange, imageOnly = false }: {
  label: string; file: File | null; onChange: (file: File | null) => void; imageOnly?: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <section className="space-y-3">
    <SetupField label={label} hint={imageOnly ? 'JPG, PNG, or WebP. Up to 10 MB.' : 'PDF, JPG, PNG, or WebP. Up to 25 MB. You can also upload the plan later from Documents.'}>
      <Input type="file" accept={(imageOnly ? PLAN_FILE_TYPES.slice(1) : PLAN_FILE_TYPES).join(',')} onChange={(event) => {
        const selected = event.target.files?.[0] ?? null;
        const message = selected ? (imageOnly && !selected.type.startsWith('image/') ? 'Choose a JPG, PNG, or WebP image.' : validatePlanFile(selected, imageOnly ? 10 : 25)) : null;
        setError(message); onChange(message ? null : selected);
        if (message) event.target.value = '';
      }} />
    </SetupField>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {file ? <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-3"><FileImage className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p></div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Remove</Button></div>
      {preview && <img src={preview} alt="Selected plan preview" className="mt-3 max-h-52 w-full rounded-md bg-background object-contain" />}
    </div> : <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-5 text-xs text-muted-foreground"><UploadCloud className="h-6 w-6 shrink-0" /><span>{imageOnly ? 'Attach a layout image for this unit.' : 'Attach the site layout or master plan for the entire project.'}</span></div>}
  </section>;
}
export function InventorySetupWizard({ mode, project, towers = [], onClose, onComplete }: {
  mode: 'project' | 'edit' | 'unit'; project?: Project; towers?: Tower[]; onClose: () => void; onComplete: (project: Project, unit?: Unit) => void;
}) {
  const { activeOrgId, activeOrganization, activeMember, isSuperAdmin } = useTenantStore();
  const can = (permission: 'inventory:manage' | 'documents:upload') => isSuperAdmin || hasPermission(activeMember ? {
    status: activeMember.status, role: activeMember.role, permissions: activeMember.permissions, assignedProjectIds: activeMember.assignedProjectIds,
  } : null, permission, project?.id);
  const canUpload = can('documents:upload'), canAddUnit = can('inventory:manage');
  const [basics, setBasics] = React.useState({
    builderName: project?.builderName ?? activeOrganization?.name ?? '', name: project?.name ?? '', code: project?.code ?? '', projectType: project?.projectType ?? ('APARTMENT' as Project['projectType']),
    reraNumber: project?.reraNumber ?? '', constructionStatus: project?.constructionStatus ?? ('UNDER_CONSTRUCTION' as Project['constructionStatus']),
    possessionDate: project?.possessionDate?.slice(0, 10) ?? '', landAreaAcres: project?.landAreaAcres?.toString() ?? '',
    configurations: project?.configurations?.join(', ') ?? '', description: project?.description ?? '', published: project?.isPublicPublished ?? false,
  });
  const [location, setLocation] = React.useState({
    countryCode: project?.countryCode ?? activeOrganization?.countryCode ?? 'IN',
    stateOrRegion: project?.stateOrRegion ?? activeOrganization?.stateOrRegion ?? '',
    city: project?.city ?? '', locality: project?.locality ?? '', address: project?.address ?? '',
    postalCode: project?.postalCode ?? '', landmark: project?.landmark ?? '',
    lat: project?.coordinates?.lat.toString() ?? '', lng: project?.coordinates?.lng.toString() ?? '',
  });
  const [amenities, setAmenities] = React.useState<string[]>(project?.amenities ?? []);
  const [plan, setPlan] = React.useState<File | null>(null);
  const [floorPlan, setFloorPlan] = React.useState<File | null>(null);
  const [addUnit, setAddUnit] = React.useState(mode === 'unit' || (mode === 'project' && canAddUnit));
  const [unit, setUnit] = React.useState(() => createUnitDraft(project));
  const [createTower, setCreateTower] = React.useState(false);
  const [tower, setTower] = React.useState({ name: '', code: '', floors: '' });
  const [stepIndex, setStepIndex] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [savedProject, setSavedProject] = React.useState<Project | null>(null);
  const saved = React.useRef<{ project?: Project; tower?: Tower; unit?: Unit; planDone?: boolean; floorUploaded?: boolean; unitDocumentDone?: boolean }>({});
  const tokens = React.useRef({ project: crypto.randomUUID(), tower: crypto.randomUUID(), unit: crypto.randomUUID(), plan: crypto.randomUUID(), layout: crypto.randomUUID() });
  const form = React.useRef<HTMLFormElement>(null);
  const steps = mode !== 'unit' ? [
    ['project', 'Project'], ['location', 'Location'], ['amenities', 'Amenities'], ['plans', 'Project Plan'],
    ...(mode === 'project' ? [['inventory', 'Inventory']] : []),
    ...(addUnit ? [['rooms', 'Rooms & Pricing']] : []), ['review', 'Review'],
  ] : [['inventory', 'Unit Details'], ['rooms', 'Rooms & Pricing'], ['review', 'Review']];
  const step = steps[stepIndex]![0], last = stepIndex === steps.length - 1;
  const setBasic = <K extends keyof typeof basics>(key: K, value: typeof basics[K]) => setBasics((current) => ({ ...current, [key]: value }));
  const setLoc = (key: keyof typeof location, value: string) => setLocation((current) => ({ ...current, [key]: value }));
  const projectInput = () => ({ orgId: activeOrgId ?? '', requestId: tokens.current.project,
    ...basics, isPublicPublished: basics.published, code: basics.code.trim().toUpperCase(),
    configurations: Array.from(new Set(basics.configurations.split(',').map((item) => item.trim()).filter(Boolean))), amenities,
    landAreaAcres: basics.landAreaAcres ? Number(basics.landAreaAcres) : undefined,
    ...location, coordinates: location.lat !== '' && location.lng !== '' ? { lat: Number(location.lat), lng: Number(location.lng) } : undefined,
  });
  const finish = async () => {
    if (!activeOrgId || (mode !== 'project' && !project)) return;
    setError(null);
    const parsedProject = mode !== 'unit' ? createProjectSchema.safeParse(projectInput()) : null;
    if (parsedProject && !parsedProject.success) { setError(parsedProject.error.issues[0]?.message ?? 'Check the project details.'); return; }
    if (addUnit) {
      const parsed = validateUnitDraft(unit, activeOrgId, project?.id ?? 'new-project');
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the unit details.'); return; }
      if (createTower && !['PLOT', 'VILLA'].includes(unit.type) && Number(unit.floor) > Number(tower.floors)) {
        setError('The unit floor cannot be higher than the tower’s total floors.'); return;
      }
    }
    setBusy(true);
    try {
      let target = saved.current.project ?? project;
      if (mode === 'edit' && project && !saved.current.project) {
        setStage('Saving project details…');
        const draft = projectInput();
        target = await callBackendFunction<unknown, Project>('updateProjectDetails', {
          ...draft, projectId: project.id, coordinates: draft.coordinates ?? null, landAreaAcres: draft.landAreaAcres ?? null,
        });
        saved.current.project = target;
        setSavedProject(target);
      }
      if (!target) {
        setStage('Saving project details…');
        target = await callBackendFunction<unknown, Project>('createProject', parsedProject && parsedProject.success ? parsedProject.data : projectInput());
        saved.current.project = target; setSavedProject(target);
      }
      if (plan && !saved.current.planDone) {
        setStage('Uploading project plan…');
        const path = `organizations/${activeOrgId}/projects/${target.id}/plans/${tokens.current.plan}`;
        await uploadBytes(ref(storage, path), plan, { contentType: plan.type });
        const document = await callBackendFunction<unknown, DocumentRecord>('registerDocument', {
          requestId: tokens.current.plan, orgId: activeOrgId, projectId: target.id, category: 'MASTER_PLAN',
          title: `${target.name} — Project Plan`, fileName: plan.name, mimeType: plan.type, sizeBytes: plan.size,
          storagePath: path, visibility: 'INTERNAL', watermarkEnabled: false,
        });
        target = { ...target, masterPlanDocumentId: document.id };
        saved.current.project = target; saved.current.planDone = true;
      }
      let createdUnit: Unit | undefined;
      if (addUnit) {
        let towerId = unit.towerId;
        if (createTower && mode === 'project') {
          setStage('Creating tower / sector…');
          if (!saved.current.tower) saved.current.tower = await callBackendFunction<unknown, Tower>('createTower', {
            requestId: tokens.current.tower, orgId: activeOrgId, projectId: target.id, name: tower.name, code: tower.code,
            towerType: basics.projectType === 'PLOTTED' ? 'SECTOR' : basics.projectType === 'VILLA' ? 'VILLA_CLUSTER' : 'TOWER',
            totalFloors: Number(tower.floors || 0), basementLevels: 0, podiumLevels: 0, unitsPerFloorTypical: 1,
          });
          towerId = saved.current.tower.id;
        }
        const layoutPath = floorPlan ? `organizations/${activeOrgId}/projects/${target.id}/floorplans/${tokens.current.layout}` : undefined;
        if (floorPlan && layoutPath && !saved.current.floorUploaded) {
          setStage('Uploading unit floor plan…');
          await uploadBytes(ref(storage, layoutPath), floorPlan, { contentType: floorPlan.type }); saved.current.floorUploaded = true;
        }
        setStage('Adding unit and room details…');
        if (!saved.current.unit) saved.current.unit = await callBackendFunction<unknown, Unit>('createUnit', {
          ...unitPayload({ ...unit, towerId }, activeOrgId, target.id, tokens.current.unit),
          towerName: saved.current.tower?.name ?? towers.find((item) => item.id === towerId)?.name,
          ...(layoutPath ? { floorPlanStoragePath: layoutPath } : {}),
        });
        createdUnit = saved.current.unit;
        if (floorPlan && layoutPath && !saved.current.unitDocumentDone) {
          await callBackendFunction('registerDocument', {
            requestId: tokens.current.layout, orgId: activeOrgId, projectId: target.id, unitId: createdUnit.id,
            category: 'UNIT_LAYOUT', title: `Unit ${createdUnit.unitNumber} — Floor Plan`, fileName: floorPlan.name,
            mimeType: floorPlan.type, sizeBytes: floorPlan.size, storagePath: layoutPath, visibility: 'INTERNAL', watermarkEnabled: false,
          });
          saved.current.unitDocumentDone = true;
        }
      }
      onComplete(target, createdUnit);
    } catch (failure) {
      setError(`${saved.current.project ? 'Your project is saved. Retry to finish the remaining setup. ' : ''}${failure instanceof Error ? failure.message : 'Unable to complete setup.'}`);
    } finally { setBusy(false); setStage(''); }
  };
  const next = (event: React.FormEvent) => {
    event.preventDefault(); setError(null);
    if (!form.current?.reportValidity()) return;
    if (step === 'location') {
      if ((location.lat === '') !== (location.lng === '')) { setError('Enter both latitude and longitude, or leave both blank.'); return; }
    }
    if (step === 'inventory' && addUnit && Number(unit.carpet) > Number(unit.saleable)) { setError('Carpet area cannot exceed saleable area.'); return; }
    if (step === 'rooms') {
      const result = roomFieldsSchema.safeParse(roomPayload(unit));
      if (!result.success) { setError(result.error.issues[0]?.message ?? 'Check the room details.'); return; }
    }
    if (last) void finish(); else setStepIndex((index) => index + 1);
  };
  const close = () => { if (busy) return; if (saved.current.project) onComplete(saved.current.project, saved.current.unit); else onClose(); };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="w-[calc(100%-1.5rem)] max-w-4xl gap-0 p-0" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()}>
      <DialogHeader className="border-b border-border p-5 pr-12">
        <DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" />{mode === 'edit' ? 'Edit Project' : mode === 'project' ? 'Set Up Project & Inventory' : `Add Inventory · ${project?.name}`}</DialogTitle>
        <DialogDescription className="pt-1">Add the details in order, review them, and save when you’re ready.</DialogDescription>
      </DialogHeader>
      <ol className="flex gap-1 overflow-x-auto border-b border-border bg-secondary/30 px-4 py-3" aria-label="Setup progress">
        {steps.map(([id, title], index) => <li key={id} className="min-w-0 flex-1">
          <button type="button" disabled={index > stepIndex || busy || Boolean(savedProject)} onClick={() => { setError(null); setStepIndex(index); }}
            aria-current={index === stepIndex ? 'step' : undefined} className="flex w-full flex-col items-center gap-1 px-1 text-center">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${index <= stepIndex ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-muted-foreground'}`}>{index < stepIndex ? <Check className="h-4 w-4" /> : index + 1}</span>
            <span className={`hidden text-[10px] sm:block ${index === stepIndex ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{title}</span>
          </button>
        </li>)}
      </ol>
      <form ref={form} onSubmit={next}>
        <div className="space-y-5 p-5 sm:p-6">
          <div><p className="text-[11px] font-medium uppercase tracking-wide text-primary">Step {stepIndex + 1} of {steps.length}</p><h3 className="mt-1 text-base font-semibold">{steps[stepIndex]![1]}</h3></div>
          <fieldset disabled={busy || Boolean(savedProject)} className="min-w-0 space-y-5">
          {step === 'project' && <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SetupField label="Project name *"><Input required minLength={2} maxLength={120} value={basics.name} onChange={(event) => setBasic('name', event.target.value)} placeholder="Emerald Heights" /></SetupField>
              <SetupField label="Project code *"><Input required minLength={2} maxLength={20} disabled={mode === 'edit'} pattern="[A-Za-z0-9_\-]+" value={basics.code} onChange={(event) => setBasic('code', event.target.value.toUpperCase())} placeholder="EMH" /></SetupField>
              <SetupField label="Builder / brand name *"><Input required minLength={2} maxLength={120} value={basics.builderName} onChange={(event) => setBasic('builderName', event.target.value)} /></SetupField>
              <SetupField label="Project type"><SetupSelect disabled={mode === 'edit'} value={basics.projectType} options={[['APARTMENT', 'Apartments'], ['VILLA', 'Villas'], ['PLOTTED', 'Plotted development'], ['COMMERCIAL', 'Commercial'], ['MIXED', 'Mixed use']]} onChange={(value) => { setBasic('projectType', value as Project['projectType']); setUnit((current) => ({ ...current, type: value === 'PLOTTED' ? 'PLOT' : value === 'VILLA' ? 'VILLA' : value === 'COMMERCIAL' ? 'OFFICE' : 'APARTMENT' })); }} /></SetupField>
              <SetupField label="RERA / registration number *"><Input required minLength={2} maxLength={100} value={basics.reraNumber} onChange={(event) => setBasic('reraNumber', event.target.value)} /></SetupField>
              <SetupField label="Construction status"><SetupSelect value={basics.constructionStatus} options={[['PRE_LAUNCH', 'Pre-launch'], ['NEW_LAUNCH', 'New launch'], ['UNDER_CONSTRUCTION', 'Under construction'], ['NEARING_POSSESSION', 'Nearing possession'], ['READY_TO_MOVE', 'Ready to move']]} onChange={(value) => setBasic('constructionStatus', value as Project['constructionStatus'])} /></SetupField>
              <SetupField label="Expected possession date"><Input type="date" value={basics.possessionDate} onChange={(event) => setBasic('possessionDate', event.target.value)} /></SetupField>
              <SetupField label="Land area (acres)"><Input type="number" min="0.01" step="any" value={basics.landAreaAcres} onChange={(event) => setBasic('landAreaAcres', event.target.value)} /></SetupField>
              <SetupField label="Configurations *" hint="Separate multiple layouts with commas."><Input required maxLength={500} placeholder="2 BHK, 3 BHK" value={basics.configurations} onChange={(event) => setBasic('configurations', event.target.value)} /></SetupField>
            </div>
            <SetupField label="Project description"><Textarea maxLength={2000} rows={3} value={basics.description} onChange={(event) => setBasic('description', event.target.value)} placeholder="Describe the development, homes, and surroundings." /></SetupField>
          </>}
          {step === 'location' && <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SetupField label="Country code *"><Input required minLength={2} maxLength={3} value={location.countryCode} onChange={(event) => setLoc('countryCode', event.target.value.toUpperCase())} /></SetupField>
              <SetupField label="State / region"><Input maxLength={80} value={location.stateOrRegion} onChange={(event) => setLoc('stateOrRegion', event.target.value)} /></SetupField>
              <SetupField label="City *"><Input required minLength={2} maxLength={80} value={location.city} onChange={(event) => setLoc('city', event.target.value)} /></SetupField>
              <SetupField label="Locality / neighbourhood *"><Input required minLength={2} maxLength={120} value={location.locality} onChange={(event) => setLoc('locality', event.target.value)} /></SetupField>
              <SetupField label="Postal / PIN code"><Input maxLength={20} value={location.postalCode} onChange={(event) => setLoc('postalCode', event.target.value)} /></SetupField>
              <SetupField label="Nearby landmark"><Input maxLength={150} value={location.landmark} onChange={(event) => setLoc('landmark', event.target.value)} /></SetupField>
            </div>
            <SetupField label="Full site address *"><Textarea required minLength={5} maxLength={300} rows={2} value={location.address} onChange={(event) => setLoc('address', event.target.value)} /></SetupField>
            <div className="grid gap-4 rounded-lg border border-border bg-secondary/20 p-4 sm:grid-cols-2">
              <SetupField label="Latitude (optional)"><Input type="number" min={-90} max={90} step="any" value={location.lat} onChange={(event) => setLoc('lat', event.target.value)} /></SetupField>
              <SetupField label="Longitude (optional)"><Input type="number" min={-180} max={180} step="any" value={location.lng} onChange={(event) => setLoc('lng', event.target.value)} /></SetupField>
              <a className="flex items-center gap-2 text-xs font-medium text-primary hover:underline sm:col-span-2" target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.lat && location.lng ? `${location.lat},${location.lng}` : [location.address, location.locality, location.city, location.stateOrRegion].filter(Boolean).join(', '))}`}>
                <MapPin className="h-4 w-4" />Check this location on Maps
              </a>
            </div>
          </>}
          {step === 'amenities' && <><p className="text-sm text-muted-foreground">Select the facilities available across this project. Unit-specific features come later.</p><AmenityPicker options={PROJECT_AMENITIES} selected={amenities} onChange={setAmenities} /><p className="text-xs text-muted-foreground">{amenities.length} amenities selected</p></>}
          {step === 'plans' && (canUpload ? <PlanUpload label="Project master plan / site layout (optional)" file={plan} onChange={setPlan} /> : <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">A team member with document upload access can add the project plan in Documents after setup.</p>)}
          {step === 'inventory' && <>
            {mode === 'project' && <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-secondary/20 p-4"><span><span className="block text-sm font-semibold">Add your first unit now</span><span className="text-xs text-muted-foreground">You can add more units or use bulk inventory later.</span></span><Switch disabled={!canAddUnit} checked={addUnit} onCheckedChange={setAddUnit} /></label>}
            {addUnit && <>
              {mode === 'project' && <div className="space-y-3 rounded-lg border border-border p-4">
                <label className="flex items-center justify-between gap-4 text-sm"><span>Add a tower / sector for this unit</span><Switch checked={createTower} onCheckedChange={setCreateTower} /></label>
                {createTower && <div className="grid gap-3 sm:grid-cols-3">
                  <SetupField label="Tower / sector name *"><Input required maxLength={80} value={tower.name} onChange={(event) => setTower({ ...tower, name: event.target.value })} /></SetupField>
                  <SetupField label="Tower / sector code *"><Input required maxLength={20} value={tower.code} onChange={(event) => setTower({ ...tower, code: event.target.value.toUpperCase() })} /></SetupField>
                  <SetupField label="Total floors *"><Input required type="number" min={0} max={200} value={tower.floors} onChange={(event) => setTower({ ...tower, floors: event.target.value })} /></SetupField>
                </div>}
              </div>}
              <UnitDetailsFields draft={unit} onChange={setUnit} towers={towers} />
            </>}
          </>}
          {step === 'rooms' && <><UnitRoomFields draft={unit} onChange={setUnit} /><div className="border-t border-border pt-5"><h4 className="mb-4 text-sm font-semibold">Pricing & availability</h4><UnitPricingFields draft={unit} onChange={setUnit} /></div>
            {canUpload && <PlanUpload label="Unit floor plan (optional)" file={floorPlan} onChange={setFloorPlan} imageOnly />}
          </>}
          {step === 'review' && <div className="space-y-4">
            <div className="rounded-lg border border-border p-4"><h4 className="text-sm font-semibold">{mode !== 'unit' ? basics.name : project?.name}</h4>
              {mode !== 'unit' && <><p className="mt-1 text-xs text-muted-foreground">{basics.code} · {basics.projectType.replace(/_/g, ' ')} · {basics.reraNumber}</p><p className="mt-3 text-sm">{[location.address, location.locality, location.city, location.stateOrRegion, location.postalCode].filter(Boolean).join(', ')}</p>
              <p className="mt-2 text-xs text-muted-foreground">{amenities.length ? amenities.join(' · ') : 'No project amenities selected'}</p><p className="mt-3 text-xs"><strong>Project plan:</strong> {plan?.name ?? (project?.masterPlanDocumentId ? 'Existing plan retained' : 'Add later')}</p></>}
            </div>
            {addUnit ? <div className="rounded-lg border border-border p-4"><h4 className="text-sm font-semibold">{unit.number} · {unit.bhk}</h4><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <span>Area: {unit.saleable} sq. ft. / Carpet: {unit.carpet} sq. ft.</span><span>Facing: {unit.facing.replace(/_/g, ' ')}</span>
              <span>Bedrooms: {unit.bedrooms || 'Not specified'} · Bathrooms: {unit.bathrooms || 'Not specified'}</span><span>Balconies: {unit.balconies} · Parking: {unit.parking}</span>
              <span>Base rate: {formatInr(Number(unit.rate))}/sq. ft.</span><span>{unit.rooms.length} room details · {unit.amenities.length} unit features</span>
              <span>Unit floor plan: {floorPlan?.name ?? 'Add later'}</span>
            </div>{unit.rooms.length > 0 && <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">{unit.rooms.map((room) => <li key={room.id}>{room.name}{room.length && room.width ? ` — ${room.length} × ${room.width} ft` : ''}</li>)}</ul>}</div> : mode === 'project' && <p className="text-sm text-muted-foreground">Add inventory whenever you’re ready.</p>}
            {mode !== 'unit' && <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-4 text-sm"><span>Publish project on the property portal</span><Switch checked={basics.published} onCheckedChange={(value) => setBasic('published', value)} /></label>}
          </div>}
          </fieldset>
          {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          {busy && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin" />{stage}</p>}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>{savedProject ? 'Finish Later' : 'Cancel'}</Button>
          <div className="flex gap-2">
            {stepIndex > 0 && <Button type="button" variant="outline" disabled={busy || Boolean(savedProject)} onClick={() => { setError(null); setStepIndex((index) => index - 1); }}>Back</Button>}
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : last ? savedProject ? 'Retry Remaining Steps' : mode === 'edit' ? 'Save Project Changes' : mode === 'project' ? addUnit ? 'Create Project & Inventory' : 'Create Project' : 'Add Unit to Inventory' : 'Continue'}</Button>
          </div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
