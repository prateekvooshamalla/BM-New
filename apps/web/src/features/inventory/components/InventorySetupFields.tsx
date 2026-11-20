import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Tower } from '@bharat-makaan/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ROOM_TYPES, UNIT_AMENITIES, type UnitDraft } from './inventory-setup';

export function SetupField({ label, children, hint }: { label: string; children: React.ReactElement<{ id?: string }>; hint?: string }) {
  const id = React.useId();
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id}>{label}</Label>{React.cloneElement(children, { id })}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
}
export function SetupSelect({ value, onChange, options, id, disabled }: {
  value: string; onChange: (value: string) => void; options: Array<[string, string]>; id?: string; disabled?: boolean;
}) {
  return <select id={id} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}
    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
    {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
  </select>;
}
export function AmenityPicker({ options, selected, onChange, label = 'amenity' }: {
  options: string[]; selected: string[]; onChange: (items: string[]) => void; label?: string;
}) {
  const [custom, setCustom] = React.useState('');
  const all = Array.from(new Set([...options, ...selected]));
  const add = () => {
    const value = custom.trim();
    if (value && !selected.some((item) => item.toLowerCase() === value.toLowerCase())) onChange([...selected, value]);
    setCustom('');
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {all.map((item) => <button key={item} type="button" aria-pressed={selected.includes(item)}
        onClick={() => onChange(selected.includes(item) ? selected.filter((value) => value !== item) : [...selected, item])}
        className={`rounded-full border px-3 py-2 text-xs transition-colors ${selected.includes(item) ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}>
        {selected.includes(item) ? '✓ ' : '+ '}{item}
      </button>)}
    </div>
    <div className="flex gap-2">
      <Input aria-label={`Custom ${label}`} maxLength={100} placeholder={`Add a custom ${label}`} value={custom}
        onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" disabled={!custom.trim()} onClick={add}>Add</Button>
    </div>
  </div>;
}
export function UnitDetailsFields({ draft, onChange, towers = [] }: {
  draft: UnitDraft; onChange: (draft: UnitDraft) => void; towers?: Tower[];
}) {
  const set = <K extends keyof UnitDraft>(key: K, value: UnitDraft[K]) => onChange({ ...draft, [key]: value });
  const noFloor = ['PLOT', 'VILLA', 'INDEPENDENT_HOUSE'].includes(draft.type);
  return <div className="grid gap-4 sm:grid-cols-2">
    <SetupField label="Unit / villa / plot number *"><Input required maxLength={40} value={draft.number} placeholder="A-101, V-01, or PLOT-12" onChange={(event) => set('number', event.target.value)} /></SetupField>
    <SetupField label="Property type"><SetupSelect value={draft.type} onChange={(value) => set('type', value as UnitDraft['type'])}
      options={[['APARTMENT', 'Apartment'], ['PENTHOUSE', 'Penthouse'], ['VILLA', 'Villa'], ['PLOT', 'Plot'], ['SHOP', 'Shop'], ['OFFICE', 'Office']]} /></SetupField>
    {towers.length > 0 && <SetupField label="Tower / sector"><SetupSelect value={draft.towerId} onChange={(value) => set('towerId', value)}
      options={[['', 'Direct inventory — no tower'], ...towers.map((tower): [string, string] => [tower.id, tower.name])]} /></SetupField>}
    {!noFloor && <SetupField label="Floor number *"><Input required type="number" min={0} max={towers.find((tower) => tower.id === draft.towerId)?.totalFloors || 200} value={draft.floor} onChange={(event) => set('floor', event.target.value)} /></SetupField>}
    <SetupField label="Configuration / BHK *"><Input required maxLength={40} value={draft.bhk} placeholder={draft.type === 'PLOT' ? 'Residential plot' : '2 BHK'} onChange={(event) => set('bhk', event.target.value)} /></SetupField>
    <SetupField label="Series (optional)" hint="For example, 01 for matching flats on each floor."><Input maxLength={20} value={draft.series} placeholder="01" onChange={(event) => set('series', event.target.value)} /></SetupField>
    <SetupField label="Saleable / total area (sq. ft.) *"><Input required type="number" min="0.01" step="any" value={draft.saleable} onChange={(event) => set('saleable', event.target.value)} /></SetupField>
    <SetupField label="Carpet / usable area (sq. ft.) *" hint={draft.type === 'PLOT' ? 'For a plot, enter the plot area in both area fields.' : undefined}><Input required type="number" min="0.01" step="any" value={draft.carpet} onChange={(event) => set('carpet', event.target.value)} /></SetupField>
    <SetupField label="Facing"><SetupSelect value={draft.facing} onChange={(value) => set('facing', value as UnitDraft['facing'])}
      options={['EAST', 'WEST', 'NORTH', 'SOUTH', 'NORTH_EAST', 'NORTH_WEST', 'SOUTH_EAST', 'SOUTH_WEST'].map((value) => [value, value.replace(/_/g, ' ')])} /></SetupField>
    <label className="flex items-center gap-3 self-center text-sm"><Switch checked={draft.corner} onCheckedChange={(value) => set('corner', value)} />Corner unit</label>
  </div>;
}
export function UnitRoomFields({ draft, onChange }: { draft: UnitDraft; onChange: (draft: UnitDraft) => void }) {
  const set = <K extends keyof UnitDraft>(key: K, value: UnitDraft[K]) => onChange({ ...draft, [key]: value });
  const patchRoom = (index: number, patch: Partial<UnitDraft['rooms'][number]>) => set('rooms', draft.rooms.map((room, i) => i === index ? { ...room, ...patch } : room));
  const residential = !['PLOT', 'SHOP', 'OFFICE', 'RETAIL_SPACE', 'COMMERCIAL_UNIT'].includes(draft.type);
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-3">
      {residential && <SetupField label="Bedrooms"><Input type="number" min={0} max={50} value={draft.bedrooms} onChange={(event) => set('bedrooms', event.target.value)} /></SetupField>}
      {draft.type !== 'PLOT' && <SetupField label="Bathrooms"><Input type="number" min={0} max={50} value={draft.bathrooms} onChange={(event) => set('bathrooms', event.target.value)} /></SetupField>}
      {residential && <SetupField label="Balconies"><Input type="number" min={0} max={20} value={draft.balconies} onChange={(event) => set('balconies', event.target.value)} /></SetupField>}
      {draft.type !== 'PLOT' && <SetupField label="Furnishing"><SetupSelect value={draft.furnishing} onChange={(value) => set('furnishing', value as UnitDraft['furnishing'])}
        options={[['UNFURNISHED', 'Unfurnished'], ['SEMI_FURNISHED', 'Semi furnished'], ['FULLY_FURNISHED', 'Fully furnished']]} /></SetupField>}
    </div>
    {draft.type !== 'PLOT' && <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="text-sm font-semibold">Room details</h4><p className="text-xs text-muted-foreground">Add room names and optional dimensions in feet.</p></div>
        <Button type="button" size="sm" variant="outline" disabled={draft.rooms.length >= 100} onClick={() => set('rooms', [...draft.rooms, { id: crypto.randomUUID(), type: 'BEDROOM', name: '', length: '', width: '' }])}><Plus className="h-4 w-4" />Add Room</Button>
      </div>
      {draft.rooms.length === 0 && <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">No room dimensions added yet. You can record them now or leave them for later.</p>}
      {draft.rooms.map((room, index) => <div key={room.id} className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3 sm:grid-cols-2">
        <SetupField label={`Room ${index + 1} name *`}><Input required maxLength={80} value={room.name} placeholder="Master bedroom" onChange={(event) => patchRoom(index, { name: event.target.value })} /></SetupField>
        <SetupField label={`Room ${index + 1} type`}><SetupSelect value={room.type} options={ROOM_TYPES.map((type) => [type, type.charAt(0) + type.slice(1).toLowerCase()])} onChange={(type) => patchRoom(index, { type: type as typeof room.type })} /></SetupField>
        <div className="grid grid-cols-2 gap-2">
          <SetupField label="Length (ft)"><Input type="number" min="0.01" max={1000} step="any" value={room.length} onChange={(event) => patchRoom(index, { length: event.target.value })} /></SetupField>
          <SetupField label="Width (ft)"><Input type="number" min="0.01" max={1000} step="any" value={room.width} onChange={(event) => patchRoom(index, { width: event.target.value })} /></SetupField>
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="pb-2 text-xs text-muted-foreground">{room.length && room.width ? `${(Number(room.length) * Number(room.width)).toFixed(2)} sq. ft.` : 'Dimensions optional'}</span>
          <Button type="button" variant="ghost" size="sm" aria-label={`Remove room ${index + 1}`} onClick={() => set('rooms', draft.rooms.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>)}
    </section>}
    <section className="space-y-3"><h4 className="text-sm font-semibold">Unit features</h4>
      <AmenityPicker options={UNIT_AMENITIES} selected={draft.amenities} label="unit feature" onChange={(items) => set('amenities', items)} />
    </section>
  </div>;
}
export function UnitPricingFields({ draft, onChange }: { draft: UnitDraft; onChange: (draft: UnitDraft) => void }) {
  const set = <K extends keyof UnitDraft>(key: K, value: UnitDraft[K]) => onChange({ ...draft, [key]: value });
  return <div className="grid gap-4 sm:grid-cols-2">
    <SetupField label="Base rate per sq. ft. (INR) *"><Input required type="number" min={0} step="any" value={draft.rate} onChange={(event) => set('rate', event.target.value)} /></SetupField>
    <SetupField label="Parking entitlement (spaces)" hint="Physical parking spaces can be assigned later in Parking."><Input required type="number" min={0} max={50} value={draft.parking} onChange={(event) => set('parking', event.target.value)} /></SetupField>
    <SetupField label="Listing type"><SetupSelect value={draft.listingMode} options={[['BUY', 'For sale'], ['RENT', 'For rent'], ['LEASE', 'For lease']]} onChange={(value) => set('listingMode', value as UnitDraft['listingMode'])} /></SetupField>
    {draft.listingMode !== 'BUY' && <SetupField label="Monthly rent (INR)"><Input type="number" min={0} step="any" value={draft.monthlyRent} onChange={(event) => set('monthlyRent', event.target.value)} /></SetupField>}
    <label className="flex items-center gap-3 text-sm sm:col-span-2"><Switch checked={draft.published} onCheckedChange={(value) => set('published', value)} />Publish unit on the property portal</label>
  </div>;
}
