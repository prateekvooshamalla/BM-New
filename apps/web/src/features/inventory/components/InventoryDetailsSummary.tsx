import * as React from 'react';
import { FileImage, MapPin } from 'lucide-react';
import { getDownloadURL, ref } from 'firebase/storage';
import type { DocumentRecord, Project, Unit } from '@bharat-makaan/shared';
import { storage } from '@/lib/firebase';
import { subscribeTenantCollection } from '@/lib/firestore-sync';

export function ProjectDetailsSummary({ project, actions }: { project: Project; actions?: React.ReactNode }) {
  const [planUrl, setPlanUrl] = React.useState<string | null>(null);
  const [planError, setPlanError] = React.useState(false);
  React.useEffect(() => {
    setPlanUrl(null); setPlanError(false);
    if (!project.masterPlanDocumentId) return;
    let disposed = false;
    const stop = subscribeTenantCollection<DocumentRecord>({
      orgId: project.orgId, projectId: project.id, collectionName: 'documents',
      onData: (documents) => {
        const plan = documents.find((document) => document.id === project.masterPlanDocumentId);
        if (plan) getDownloadURL(ref(storage, plan.storagePath))
          .then((url) => { if (!disposed) setPlanUrl(url); })
          .catch(() => { if (!disposed) setPlanError(true); });
      },
    });
    return () => { disposed = true; stop(); };
  }, [project.id, project.orgId, project.masterPlanDocumentId]);
  const address = [project.address, project.locality, project.city, project.stateOrRegion, project.postalCode].filter(Boolean).join(', ');
  const mapQuery = project.coordinates ? `${project.coordinates.lat},${project.coordinates.lng}` : address;
  return <section className="space-y-3 rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold">Project Details</h3>
        <p className="text-xs text-muted-foreground">{address}</p>
        {project.landmark && <p className="text-xs text-muted-foreground">Landmark: {project.landmark}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-primary">
        {actions}
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline"><MapPin className="h-4 w-4" />View Location</a>
        {planUrl && <a href={planUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline"><FileImage className="h-4 w-4" />View Project Plan</a>}
        {project.masterPlanDocumentId && !planUrl && <span className="text-muted-foreground">{planError ? 'Open project plan from Documents' : 'Loading project plan…'}</span>}
      </div>
    </div>
    {project.description && <p className="text-xs leading-relaxed text-muted-foreground">{project.description}</p>}
    {(project.amenities ?? []).length > 0 && <div className="flex flex-wrap gap-1.5">{project.amenities.map((amenity) => <span key={amenity} className="rounded-full bg-secondary px-2.5 py-1 text-[11px]">{amenity}</span>)}</div>}
  </section>;
}
export function UnitRoomSummary({ unit }: { unit: Unit }) {
  if (unit.bedroomsCount === undefined && unit.bathroomsCount === undefined && !unit.roomDetails?.length && !unit.unitAmenities?.length && !unit.furnishing) return null;
  return <section className="space-y-3 rounded-lg border border-border p-3">
    <h4 className="text-xs font-semibold">Rooms & Features</h4>
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {unit.bedroomsCount !== undefined && <span>{unit.bedroomsCount} Bedrooms</span>}
      {unit.bathroomsCount !== undefined && <span>{unit.bathroomsCount} Bathrooms</span>}
      {unit.furnishing && <span>{unit.furnishing.replace(/_/g, ' ').toLowerCase()}</span>}
    </div>
    {!!unit.roomDetails?.length && <div className="space-y-2">{unit.roomDetails.map((room, index) => <div key={index} className="flex flex-wrap justify-between gap-1 text-xs">
      <span>{room.name} <span className="text-muted-foreground">({room.type.toLowerCase()})</span></span>
      <span className="font-medium">{room.lengthFt && room.widthFt ? `${room.lengthFt} × ${room.widthFt} ft · ${Number((room.lengthFt * room.widthFt).toFixed(2))} sq. ft.` : 'Dimensions not recorded'}</span>
    </div>)}</div>}
    {!!unit.unitAmenities?.length && <p className="text-xs text-muted-foreground">{unit.unitAmenities.join(' · ')}</p>}
  </section>;
}
