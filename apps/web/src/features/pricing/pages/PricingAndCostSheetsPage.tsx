import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calculator } from 'lucide-react';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PriceBookManagerPanel } from '@/features/pricing/components/PriceBookManagerPanel';
import { CostSheetGeneratorPanel } from '@/features/quotations/components/CostSheetGeneratorPanel';

export function PricingAndCostSheetsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'quotations' ? 'quotations' : 'price-books';
  const { activeOrgId, projects, activeProjectId, selectProject } = useTenantStore();
  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;

  if (!activeOrgId || projects.length === 0 || !currentProjectId) {
    return (
      <EmptyState
        icon={Calculator}
        title="Create a project to set up pricing"
        description="Create your first project under Projects & Inventory to configure dynamic price books, custom charges, and AI-assisted cost sheets."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dynamic Pricing & Quotations"
        title="Pricing & Cost Sheets"
        description="Set project pricing, review charges, and generate customer cost sheets."
        actions={
          <Select value={currentProjectId} onValueChange={(v) => selectProject(v)}>
            <SelectTrigger className="w-full sm:w-60">
              <SelectValue placeholder="Select Project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('tab', v);
        return next;
      })}>
        <TabsList className="h-auto max-w-full flex-wrap">
          <TabsTrigger value="price-books">Price Books</TabsTrigger>
          <TabsTrigger value="quotations">Cost Sheets & Payment Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="price-books">
          <PriceBookManagerPanel key={`${activeOrgId}:${currentProjectId}`} projectId={currentProjectId} />
        </TabsContent>

        <TabsContent value="quotations">
          <CostSheetGeneratorPanel key={`${activeOrgId}:${currentProjectId}`} projectId={currentProjectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
