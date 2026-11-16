import * as React from 'react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { FileText, Layers, Link2, Upload } from 'lucide-react';
import type {
  DocumentCategory,
  DocumentRecord,
  FloorCategory,
  FloorPlanVersion,
  Tower,
} from '@bharat-makaan/shared';
import { callBackendFunction, storage } from '@/lib/firebase';
import { sortDescByIso, subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PermissionGate } from '@/components/shared/PermissionGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DOC_CATEGORIES: DocumentCategory[] = [
  'MASTER_PLAN',
  'TOWER_PLAN',
  'FLOOR_PLAN',
  'UNIT_LAYOUT',
  'BROCHURE',
  'PRICE_SHEET',
  'RERA_DOC',
  'APPROVAL_FILE',
  'COST_SHEET',
  'BOOKING_DOC',
  'PAYMENT_RECEIPT',
];

export function DocumentsPage() {
  const { activeOrgId, projects, activeProjectId, selectProject } = useTenantStore();
  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;

  const [docs, setDocs] = React.useState<DocumentRecord[]>([]);
  const [floorPlans, setFloorPlans] = React.useState<FloorPlanVersion[]>([]);
  const [towers, setTowers] = React.useState<Tower[]>([]);

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [mapPlanDoc, setMapPlanDoc] = React.useState<DocumentRecord | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Upload Form
  const [title, setTitle] = React.useState('');
  const [category, setCategory] = React.useState<DocumentCategory>('FLOOR_PLAN');
  const [visibility, setVisibility] = React.useState<'INTERNAL' | 'PARTNER' | 'CUSTOMER' | 'PUBLIC'>('INTERNAL');
  const [watermark, setWatermark] = React.useState(true);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);

  // Floor Plan Mapper Form
  const [fpTowerId, setFpTowerId] = React.useState('');
  const [fpCategory, setFpCategory] = React.useState<FloorCategory>('TYPICAL');
  const [fpMinFloor, setFpMinFloor] = React.useState('3');
  const [fpMaxFloor, setFpMaxFloor] = React.useState('14');
  const [fpBhk, setFpBhk] = React.useState('3 BHK');
  const [fpSaleable, setFpSaleable] = React.useState('2200');
  const [fpCarpet, setFpCarpet] = React.useState('1540');

  React.useEffect(() => {
    if (!activeOrgId) return;

    const uDocs = subscribeTenantCollection<DocumentRecord>({
      orgId: activeOrgId,
      collectionName: 'documents',
      sort: sortDescByIso<DocumentRecord>('createdAt'),
      onData: setDocs,
    });

    let uFp = () => {};
    let uTw = () => {};
    if (currentProjectId) {
      uFp = subscribeTenantCollection<FloorPlanVersion>({
        orgId: activeOrgId,
        collectionName: 'floor_plan_versions',
        projectId: currentProjectId,
        onData: setFloorPlans,
      });
      uTw = subscribeTenantCollection<Tower>({
        orgId: activeOrgId,
        collectionName: 'towers',
        projectId: currentProjectId,
        onData: setTowers,
      });
    }

    return () => {
      uDocs();
      uFp();
      uTw();
    };
  }, [activeOrgId, currentProjectId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !selectedFile) return;
    setBusy(true);
    setBanner(null);
    try {
      const storagePath = `organizations/${activeOrgId}/projects/${currentProjectId ?? 'general'}/documents/${Date.now()}_${selectedFile.name}`;
      const fileRef = storageRef(storage, storagePath);
      await uploadBytes(fileRef, selectedFile, { contentType: selectedFile.type });

      await callBackendFunction('registerDocument', {
        orgId: activeOrgId,
        projectId: currentProjectId,
        category,
        title,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || 'application/pdf',
        sizeBytes: selectedFile.size,
        storagePath,
        visibility,
        watermarkEnabled: watermark,
      });

      setUploadOpen(false);
      setTitle('');
      setSelectedFile(null);
      setBanner(`Uploaded "${title}" (v1) to secure organization storage.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Document upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateShareLink = async (docRec: DocumentRecord) => {
    if (!activeOrgId) return;
    try {
      const res = await callBackendFunction<
        any,
        { tokenId: string; expiresAt: string }
      >('createDocumentShareLink', {
        orgId: activeOrgId,
        documentId: docRec.id,
        expiresInHours: 72,
      });
      const shareUrl = `${window.location.origin}/share/doc/${res.tokenId}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setBanner(`Expiring 72h share link copied: ${shareUrl}`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to create share link.');
    }
  };

  const handleDownload = async (docRec: DocumentRecord) => {
    try {
      const url = await getDownloadURL(storageRef(storage, docRec.storagePath));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Unable to fetch signed download URL.');
    }
  };

  const handleMapFloorPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !currentProjectId || !mapPlanDoc || !fpTowerId) return;
    setBusy(true);
    try {
      const res = await callBackendFunction<any, { matchedUnitsCount: number }>(
        'mapFloorPlanVersion',
        {
          orgId: activeOrgId,
          documentId: mapPlanDoc.id,
          projectId: currentProjectId,
          towerIds: [fpTowerId],
          floorCategory: fpCategory,
          minFloor: Number(fpMinFloor),
          maxFloor: Number(fpMaxFloor),
          applicableUnitTypes: ['APARTMENT'],
          applicableBhk: [fpBhk],
          carpetAreaSqft: Number(fpCarpet),
          saleableAreaSqft: Number(fpSaleable),
          storagePath: mapPlanDoc.storagePath,
          fileName: mapPlanDoc.fileName,
        }
      );
      setMapPlanDoc(null);
      setBanner(
        `Mapped ${fpCategory} floor plan (Floors ${fpMinFloor}–${fpMaxFloor}) to ${res.matchedUnitsCount} matching unit(s).`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Floor plan mapping failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) {
    return (
      <EmptyState
        icon={FileText}
        title="No builder organization selected."
        description="Select or create a builder organization to manage floor plans, brochures, RERA files, and booking documents."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Controlled Repository & Floor Plan Mapping"
        title="Documents & Floor Plans"
        description="Manage versioned PDF/image documents, watermark settings, expiring share links, and floor-range-specific floor plan mappings."
        actions={
          <div className="flex items-center gap-2">
            {projects.length > 0 && currentProjectId && (
              <Select value={currentProjectId} onValueChange={selectProject}>
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <PermissionGate permission="documents:upload" projectId={currentProjectId}>
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" />
                Upload Document / Floor Plan
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs break-all">
          {banner}
        </div>
      )}

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Documents ({docs.length})</TabsTrigger>
          <TabsTrigger value="floor-plans">
            Tower & Floor-Range Mappings ({floorPlans.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {docs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents uploaded yet. Upload floor plans, RERA certificates or brochures."
              description="Upload PDFs or images up to 25 MB, control visibility across Internal/Partner/Customer/Public scopes, and map floor plans accurately."
              actionLabel="Upload First Document"
              onAction={() => setUploadOpen(true)}
            />
          ) : (
            <DataTable
              data={docs}
              searchPlaceholder="Search document title, category or filename..."
              columns={[
                { accessorKey: 'title', header: 'Title' },
                {
                  accessorKey: 'category',
                  header: 'Category',
                  cell: ({ row }) => row.original.category.replace(/_/g, ' '),
                },
                {
                  accessorKey: 'currentVersion',
                  header: 'Version',
                  cell: ({ row }) => `v${row.original.currentVersion}`,
                },
                {
                  accessorKey: 'visibility',
                  header: 'Visibility',
                  cell: ({ row }) => <StatusBadge status={row.original.visibility} />,
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  cell: ({ row }) => {
                    const d = row.original;
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => handleDownload(d)}>
                          Preview / Download
                        </Button>
                        {(d.category === 'FLOOR_PLAN' || d.category === 'UNIT_LAYOUT') && (
                          <Button variant="secondary" size="sm" onClick={() => setMapPlanDoc(d)}>
                            <Layers className="h-3 w-3" /> Map Floors
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCreateShareLink(d)}
                        >
                          <Link2 className="h-3 w-3" /> Expiring Link
                        </Button>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </TabsContent>

        <TabsContent value="floor-plans">
          <DataTable
            data={floorPlans}
            searchPlaceholder="Search floor plan mappings..."
            emptyMessage="No floor plan mappings created yet. Upload a FLOOR_PLAN document and click 'Map Floors'."
            columns={[
              { accessorKey: 'fileName', header: 'Plan File' },
              { accessorKey: 'floorCategory', header: 'Floor Category' },
              {
                id: 'range',
                header: 'Floor Range',
                cell: ({ row }) => `Floors ${row.original.minFloor} – ${row.original.maxFloor}`,
              },
              {
                id: 'bhk',
                header: 'Applicable BHK',
                cell: ({ row }) => row.original.applicableBhk.join(', '),
              },
              {
                accessorKey: 'versionNumber',
                header: 'Version',
                cell: ({ row }) => `v${row.original.versionNumber}`,
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* Upload Modal */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Enterprise Document or Floor Plan</DialogTitle>
            <DialogDescription>
              Permitted formats: PDF, PNG, JPEG, WebP (Max 25 MB).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-3">
            <div className="space-y-1">
              <Label>Document Title *</Label>
              <Input
                required
                placeholder="e.g., Tower 1 Typical Floor Plan or Master Layout"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Category *</Label>
                <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Visibility *</Label>
                <Select value={visibility} onValueChange={(v: any) => setVisibility(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTERNAL">Internal Only</SelectItem>
                    <SelectItem value="PARTNER">Channel Partners</SelectItem>
                    <SelectItem value="CUSTOMER">Customer Portal</SelectItem>
                    <SelectItem value="PUBLIC">Public Listing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Select File *</Label>
              <Input
                type="file"
                required
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={watermark} onCheckedChange={setWatermark} />
              Apply Organization Watermark on External Previews
            </label>
            <DialogFooter>
              <Button type="submit" disabled={busy || !selectedFile}>
                {busy ? 'Uploading...' : 'Upload Document'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Floor Plan Mapper Modal */}
      <Dialog open={Boolean(mapPlanDoc)} onOpenChange={(o) => !o && setMapPlanDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map Floor Plan — {mapPlanDoc?.title}</DialogTitle>
            <DialogDescription>
              Explicitly scope floor range and floor category so typical upper-floor layouts do not
              apply to podium or lower residential levels.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleMapFloorPlan} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Target Tower *</Label>
                <Select value={fpTowerId} onValueChange={setFpTowerId}>
                  <SelectTrigger><SelectValue placeholder="Choose tower" /></SelectTrigger>
                  <SelectContent>
                    {towers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Floor Category *</Label>
                <Select value={fpCategory} onValueChange={(v: any) => setFpCategory(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TYPICAL">Typical Upper Floors</SelectItem>
                    <SelectItem value="PODIUM">Podium Level</SelectItem>
                    <SelectItem value="LOWER_RESIDENTIAL">Lower Residential</SelectItem>
                    <SelectItem value="PENTHOUSE">Penthouse / Duplex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Minimum Floor *</Label>
                <Input type="number" value={fpMinFloor} onChange={(e) => setFpMinFloor(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Maximum Floor *</Label>
                <Input type="number" value={fpMaxFloor} onChange={(e) => setFpMaxFloor(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Applicable BHK *</Label>
                <Input value={fpBhk} onChange={(e) => setFpBhk(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Saleable / Carpet (sq.ft.)</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  <Input type="number" value={fpSaleable} onChange={(e) => setFpSaleable(e.target.value)} />
                  <Input type="number" value={fpCarpet} onChange={(e) => setFpCarpet(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !fpTowerId}>
                Apply Floor Plan Mapping
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
