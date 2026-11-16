import * as React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { DEFAULT_SAAS_PLANS } from '@bharat-makaan/config';
import { formatInr, type AuditEvent, type Organization, type Subscription } from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function SuperAdminConsolePage() {
  const { isSuperAdmin } = useTenantStore();
  const [data, setData] = React.useState<{
    organizations: Organization[];
    subscriptions: Subscription[];
    supportTickets: Array<Record<string, any>>;
    recentAudits: AuditEvent[];
    systemHealth: Record<string, any>;
  } | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);

  const loadOverview = React.useCallback(async () => {
    try {
      const res = await callBackendFunction<Record<string, never>, any>(
        'superAdminGetPlatformOverview',
        {}
      );
      setData(res);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Super Admin authorization required.');
    }
  }, []);

  React.useEffect(() => {
    if (isSuperAdmin) {
      loadOverview();
    }
  }, [isSuperAdmin, loadOverview]);

  const handleToggleSuspend = async (org: Organization) => {
    const nextStatus = org.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await callBackendFunction('superAdminUpdateTenant', {
        orgId: org.id,
        status: nextStatus,
        reason: `Super Admin set tenant status to ${nextStatus}`,
      });
      await loadOverview();
      setBanner(`Updated "${org.name}" to ${nextStatus}.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to update tenant.');
    }
  };

  const handleGrantEnterprise = async (org: Organization) => {
    try {
      await callBackendFunction('superAdminUpdateTenant', {
        orgId: org.id,
        planCode: 'ENTERPRISE',
        customMaxProjects: -1,
        customMaxUsers: -1,
        customAiCredits: 50000,
        customWhatsappQuota: 100000,
        reason: 'Provisioned Enterprise custom subscription',
      });
      await loadOverview();
      setBanner(`Upgraded "${org.name}" to ENTERPRISE unlimited entitlements.`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Failed to upgrade plan.');
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-14 space-y-6">
        <EmptyState
          icon={ShieldCheck}
          title="Platform Super Admin Authorization Required"
          description="Sign in with the provisioned Platform Super Admin account (prateek.parts@gmail.com) with MFA to access global governance."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <PageHeader
        eyebrow="Global SaaS Governance"
        title="Bharat Makaan — Platform Super Admin"
        description="Manage builder organizations, SaaS subscriptions, plans, AI/WhatsApp usage, support tickets, system health, and global audit trails."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/dashboard">Return to Builder Console</Link>
          </Button>
        }
      />

      {banner && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs">
          {banner}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">System Health</CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-bold text-emerald-700">
                {data.systemHealth.status}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">Builder Tenants</CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-bold">
                {data.systemHealth.totalOrganizations}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">AI Tokens Sampled</CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-bold">
                {data.systemHealth.totalAiTokensSampled.toLocaleString('en-IN')}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">Open Support Tickets</CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-bold">
                {data.systemHealth.openSupportTickets}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="tenants">
            <TabsList>
              <TabsTrigger value="tenants">Builder Organizations ({data.organizations.length})</TabsTrigger>
              <TabsTrigger value="plans">SaaS Plan Catalog</TabsTrigger>
              <TabsTrigger value="support">Support Requests ({data.supportTickets.length})</TabsTrigger>
              <TabsTrigger value="audit">Global Audit Trail ({data.recentAudits.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="tenants">
              <DataTable
                data={data.organizations}
                emptyMessage="No builder organizations provisioned yet."
                columns={[
                  { accessorKey: 'name', header: 'Builder Name' },
                  { accessorKey: 'headquartersCity', header: 'HQ City' },
                  { accessorKey: 'subscriptionPlanId', header: 'Plan' },
                  {
                    accessorKey: 'status',
                    header: 'Status',
                    cell: ({ row }) => <StatusBadge status={row.original.status} />,
                  },
                  {
                    id: 'actions',
                    header: 'Governance',
                    cell: ({ row }) => (
                      <div className="flex gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleGrantEnterprise(row.original)}
                        >
                          Grant Enterprise
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleSuspend(row.original)}
                        >
                          {row.original.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="plans">
              <div className="grid gap-4 md:grid-cols-4">
                {Object.values(DEFAULT_SAAS_PLANS).map((plan) => (
                  <Card key={plan.code}>
                    <CardHeader>
                      <CardTitle className="text-sm">{plan.name}</CardTitle>
                      <div className="text-lg font-bold text-primary">
                        {plan.monthlyPriceInr ? `${formatInr(plan.monthlyPriceInr)}/mo` : 'Custom'}
                      </div>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground space-y-1">
                      <div>Onboarding Fee: {formatInr(plan.onboardingFeeInr)}</div>
                      <div>Max Projects: {plan.entitlements.maxProjects}</div>
                      <div>Max Users: {plan.entitlements.maxUsers}</div>
                      <div>AI Credits: {plan.entitlements.monthlyAiCredits}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="support">
              <DataTable
                data={data.supportTickets}
                emptyMessage="No support requests submitted."
                columns={[
                  { accessorKey: 'name', header: 'Requester' },
                  { accessorKey: 'email', header: 'Email' },
                  { accessorKey: 'subject', header: 'Subject' },
                  {
                    accessorKey: 'status',
                    header: 'Status',
                    cell: ({ row }) => <StatusBadge status={row.original.status} />,
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="audit">
              <DataTable
                data={data.recentAudits}
                emptyMessage="No audit records yet."
                columns={[
                  {
                    accessorKey: 'createdAt',
                    header: 'Timestamp',
                    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
                  },
                  { accessorKey: 'orgId', header: 'Tenant' },
                  { accessorKey: 'category', header: 'Category' },
                  { accessorKey: 'action', header: 'Action' },
                  { accessorKey: 'summary', header: 'Summary' },
                ]}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
