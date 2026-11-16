import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createOrganizationSchema } from '@bharat-makaan/validation';
import type { Organization, OrganizationMember } from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CreateOrgFormValues = z.infer<typeof createOrganizationSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrganizationDialog({ open, onOpenChange }: Props) {
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const { organizations, memberships, setOrganizationsAndMemberships, selectOrganization } =
    useTenantStore();

  const {
    register,
    handleSubmit,
    reset,
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
      email: '',
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
      reset();
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create organization.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Builder Organization</DialogTitle>
          <DialogDescription>
            Provision an isolated enterprise tenant for your real estate development company.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMessage}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Brand Name *</Label>
              <Input id="org-name" placeholder="e.g., Prestige Skyline Group" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-legal">Registered Legal Entity *</Label>
              <Input
                id="org-legal"
                placeholder="Registered Pvt. Ltd. / LLP Name"
                {...register('legalName')}
              />
              {errors.legalName && (
                <p className="text-xs text-destructive">{errors.legalName.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-city">Headquarters City *</Label>
              <Input id="org-city" placeholder="e.g., Bengaluru, Mumbai, Hyderabad" {...register('headquartersCity')} />
              {errors.headquartersCity && (
                <p className="text-xs text-destructive">{errors.headquartersCity.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-rera">Corporate RERA Registration</Label>
              <Input id="org-rera" placeholder="Optional corporate RERA ID" {...register('reraNumber')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-gstin">GSTIN</Label>
              <Input id="org-gstin" placeholder="29ABCDE1234F1Z5" {...register('gstin')} />
              {errors.gstin && <p className="text-xs text-destructive">{errors.gstin.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-pan">Corporate PAN</Label>
              <Input id="org-pan" placeholder="ABCDE1234F" {...register('pan')} />
              {errors.pan && <p className="text-xs text-destructive">{errors.pan.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-email">Official Email</Label>
              <Input id="org-email" type="email" placeholder="ops@company.com" {...register('email')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-protection">Partner Lead Protection (Days)</Label>
              <Input id="org-protection" type="number" min={1} max={365} {...register('leadProtectionDays')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-address">Corporate Address</Label>
            <Input id="org-address" placeholder="Registered office address" {...register('address')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Provisioning...' : 'Create Organization'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
