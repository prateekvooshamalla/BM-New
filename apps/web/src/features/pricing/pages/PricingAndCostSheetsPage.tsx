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

export function PricingAndCostSheetsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'price-books';
  const { activeOrgId, projects, activeProjectId, selectProject } = useTenantStore();
  const currentProjectId = activeProjectId ?? projects[0]?.id ?? null;

  if (!activeOrgId || projects.length === 0 || !currentProjectId) {
    return (
      <EmptyState
        icon={Calculator}
        title="No approved price book. Create your pricing rules."
        description="Create your first project under Projects & Inventory to configure dynamic price books, custom charges, and AI-assisted cost sheets."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dynamic Pricing & Quotations"
        title="Pricing Engine & Cost Sheets"
        description="Manage versioned price books, editable cost-sheet labels, construction-linked payment plans, and versioned PDF quotations."
        actions={
          <Select value={currentProjectId} onValueChange={(v) => selectProject(v)}>
            <SelectTrigger className="w-60">
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

      <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="price-books">Dynamic Price Books & History</TabsTrigger>
          <TabsTrigger value="quotations">Cost Sheet Generator & CLP Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="price-books">
          <PriceBookManagerPanel projectId={currentProjectId} />
        </TabsContent>

        <TabsContent value="quotations">
          <div id="cost-sheet-slot" className="text-xs text-muted-foreground">
            Select an approved price book to generate quotations.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
