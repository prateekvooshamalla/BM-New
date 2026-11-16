import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Building2, CheckCircle2 } from 'lucide-react';
import { DEFAULT_SAAS_PLANS } from '@bharat-makaan/config';
import { createOrganizationSchema } from '@bharat-makaan/validation';
import { formatInr, type Organization, type OrganizationMember } from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CreateOrgFormValues = z.infer<typeof createOrganizationSchema>;

export function BuilderOnboardingPage() {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [targetPackage, setTargetPackage] = React.useState<'SINGLE_PROJECT' | 'MULTI_PROJECT'>(
    'SINGLE_PROJECT'
  );
  const {
    email,
    organizations,
    memberships,
    setOrganizationsAndMemberships,
    selectOrganization,
  } = useTenantStore();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgFormValues>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: {
      name: '',
      legalName: '',
      gstin: '',
      pan: '',
      reraNumber: '',
      headquartersCity: '',
      address: '',
      phone: '',
      email: email ?? '',
      leadProtectionDays: 60,
    },
  });

  const onSubmit = async (values: CreateOrgFormValues) => {
    setErrorMessage(null);
    try {
      const res = await callBackendFunction<
        CreateOrgFormValues,
        { organization: Organization; membership: OrganizationMember }
      >('createOrganization', values);

      const nextOrgs = [...organizations, res.organization];
      const nextMembers = [...memberships, res.membership];
      setOrganizationsAndMemberships(nextOrgs, nextMembers);
      selectOrganization(res.organization.id);

      if (targetPackage === 'MULTI_PROJECT') {
        navigate('/builder/billing');
      } else {
        navigate('/builder/dashboard');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create organization.');
    }
  };

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Builder Workspace Provisioning
            </p>
            <h1 className="text-2xl font-bold text-foreground">
              Register Your Real Estate Builder Organization
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Provision an isolated enterprise tenant for your projects, inventory, cost sheets,
              channel partners, and team.
            </p>
          </div>
          {organizations.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/builder/dashboard">Open Existing Workspace</Link>
            </Button>
          )}
        </div>

        {/* Package Selection Intent */}
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setTargetPackage('SINGLE_PROJECT')}
            className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
              targetPackage === 'SINGLE_PROJECT'
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:bg-secondary/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{DEFAULT_SAAS_PLANS.SINGLE_PROJECT.name}</span>
              {targetPackage === 'SINGLE_PROJECT' && (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="mt-1 text-lg font-bold text-primary">
              {formatInr(DEFAULT_SAAS_PLANS.SINGLE_PROJECT.monthlyPriceInr)} / month + GST
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              1 Active Project hard limit • Self-service onboarding free (₹0)
            </p>
          </button>

          <button
            type="button"
            onClick={() => setTargetPackage('MULTI_PROJECT')}
            className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
              targetPackage === 'MULTI_PROJECT'
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:bg-secondary/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{DEFAULT_SAAS_PLANS.MULTI_PROJECT.name}</span>
              {targetPackage === 'MULTI_PROJECT' && (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="mt-1 text-lg font-bold text-primary">
              {formatInr(DEFAULT_SAAS_PLANS.MULTI_PROJECT.perProjectMonthlyInr)} / project / month +
              GST
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Minimum 2 Active Projects ({formatInr(9998)}/mo) • Scale slots in Billing Console
            </p>
          </button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Corporate &amp; RERA Details
            </CardTitle>
            <CardDescription>
              Used across authoritative cost sheets, customer quotations, and RERA compliance
              records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {errorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {errorMessage}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="onb-name">Brand Name *</Label>
                  <Input
                    id="onb-name"
                    placeholder="e.g., Skyline Realty Group"
                    {...register('name')}
                  />
                  {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="onb-legal">Registered Legal Entity *</Label>
                  <Input
                    id="onb-legal"
                    placeholder="Registered Pvt. Ltd. / LLP Name"
                    {...register('legalName')}
                  />
                  {errors.legalName && (
                    <p className="text-xs text-destructive">{errors.legalName.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="onb-city">Headquarters City *</Label>
                  <Input
                    id="onb-city"
                    placeholder="e.g., Bengaluru, Mumbai, Hyderabad"
                    {...register('headquartersCity')}
                  />
                  {errors.headquartersCity && (
                    <p className="text-xs text-destructive">{errors.headquartersCity.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="onb-rera">Corporate RERA Registration</Label>
                  <Input
                    id="onb-rera"
                    placeholder="Optional corporate RERA ID"
                    {...register('reraNumber')}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="onb-phone">Corporate Contact Phone *</Label>
                  <Input id="onb-phone" placeholder="+919876543210" {...register('phone')} />
                  {errors.phone && (
                    <p className="text-xs text-destructive">{errors.phone.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="onb-email">Corporate Contact Email *</Label>
                  <Input id="onb-email" type="email" {...register('email')} />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="onb-address">Registered Office Address *</Label>
                  <Input
                    id="onb-address"
                    placeholder="Full registered address"
                    {...register('address')}
                  />
                  {errors.address && (
                    <p className="text-xs text-destructive">{errors.address.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" type="button" asChild>
                  <Link to="/">Cancel</Link>
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? 'Provisioning Builder Organization...'
                    : targetPackage === 'MULTI_PROJECT'
                      ? 'Create Organization & Configure Project Slots'
                      : 'Create Organization & Enter Dashboard'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
