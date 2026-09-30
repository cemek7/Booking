export type RetailFulfillmentRolloutMode = 'off' | 'shadow' | 'live';

function tenantIsSelected(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  const rollouts = (settings as Record<string, unknown>).rollouts;
  if (!rollouts || typeof rollouts !== 'object' || Array.isArray(rollouts)) return false;
  return (rollouts as Record<string, unknown>).retailFulfillment === 'live';
}

export function resolveRetailFulfillmentRollout(input: {
  globalMode: string | null | undefined;
  tenantSettings: unknown;
}): RetailFulfillmentRolloutMode {
  if (input.globalMode === 'off') return 'off';
  if (input.globalMode !== 'shadow' && input.globalMode !== 'live') return 'off';
  return tenantIsSelected(input.tenantSettings) ? 'live' : 'shadow';
}
