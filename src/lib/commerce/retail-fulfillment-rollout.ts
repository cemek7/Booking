import { defaultLogger } from '@/lib/logger';

export type RetailFulfillmentRolloutMode = 'off' | 'shadow' | 'live';
export type RetailFulfillmentMetricSurface = 'payment_link' | 'payment_webhook';
export type RetailFulfillmentMetricStatus = 'ready' | 'awaiting_customer' | 'awaiting_human';
export type RetailFulfillmentMetricReason =
  | 'none'
  | 'fulfillment_not_configured'
  | 'fulfillment_method_required'
  | 'delivery_address_required'
  | 'delivery_fee_requires_human'
  | 'third_party_arrangement_required';
export type RetailFulfillmentMetricProvider = 'none' | 'bolt' | 'indrive' | 'other';

export type RetailFulfillmentMetricLabels = {
  mode: RetailFulfillmentRolloutMode;
  surface: RetailFulfillmentMetricSurface;
  status: RetailFulfillmentMetricStatus;
  reason: RetailFulfillmentMetricReason;
  provider: RetailFulfillmentMetricProvider;
};

export function buildRetailFulfillmentMetricLabels(input: {
  mode: RetailFulfillmentRolloutMode;
  surface: RetailFulfillmentMetricSurface;
  status: RetailFulfillmentMetricStatus;
  reasonCode: Exclude<RetailFulfillmentMetricReason, 'none'> | null;
  provider: Exclude<RetailFulfillmentMetricProvider, 'none'> | null;
}): RetailFulfillmentMetricLabels {
  return {
    mode: input.mode,
    surface: input.surface,
    status: input.status,
    reason: input.reasonCode ?? 'none',
    provider: input.provider ?? 'none',
  };
}

export async function recordRetailFulfillmentDecision(input: Parameters<typeof buildRetailFulfillmentMetricLabels>[0]) {
  const labels = buildRetailFulfillmentMetricLabels(input);
  try {
    const { observability } = await import('@/lib/observability');
    await observability.recordBusinessMetric('retail_fulfillment_decision_total', 1, labels);
  } catch {
    // Metrics must never block checkout or webhook processing. Keep the fallback
    // log to the same fixed label set: no address, phone, notes or payment data.
    defaultLogger.warn('Retail fulfillment metric could not be recorded', labels);
  }
}

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
