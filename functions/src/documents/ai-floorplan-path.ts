export function isAiFloorPlanStoragePath(input: {
  orgId: string;
  projectId?: string | null;
  category: string;
  storagePath: string;
}): boolean {
  if (input.category !== 'FLOOR_PLAN' || !input.projectId) return false;

  const prefix = `organizations/${input.orgId}/projects/${input.projectId}/ai-floorplans/`;
  const fileName = input.storagePath.startsWith(prefix)
    ? input.storagePath.slice(prefix.length)
    : '';
  return fileName.length > 0 && !fileName.includes('/');
}
