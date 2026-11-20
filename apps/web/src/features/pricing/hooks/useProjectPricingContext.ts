import * as React from 'react';
import type { ParkingSlot, PricingScopeOverride } from '@bharat-makaan/shared';
import { subscribeTenantCollection } from '@/lib/firestore-sync';
import { useTenantStore } from '@/state/useTenantStore';

export function useProjectPricingContext(projectId: string | null) {
  const activeOrgId = useTenantStore((state) => state.activeOrgId);
  const [parkingSlots, setParkingSlots] = React.useState<ParkingSlot[]>([]);
  const [pricingOverrides, setPricingOverrides] = React.useState<PricingScopeOverride[]>([]);
  React.useEffect(() => {
    setParkingSlots([]);
    setPricingOverrides([]);
    if (!activeOrgId || !projectId) return;
    const stopParking = subscribeTenantCollection<ParkingSlot>({
      orgId: activeOrgId, projectId, collectionName: 'parking_slots', onData: setParkingSlots,
    });
    const stopOverrides = subscribeTenantCollection<PricingScopeOverride>({
      orgId: activeOrgId, collectionName: 'pricing_overrides',
      filter: (rule) => !rule.projectId || rule.projectId === projectId,
      onData: setPricingOverrides,
    });
    return () => { stopParking(); stopOverrides(); };
  }, [activeOrgId, projectId]);
  return { parkingSlots, pricingOverrides };
}
