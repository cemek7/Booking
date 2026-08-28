export type MeteringMode = 'shadow' | 'live';

/**
 * Provisional Nigerian service-message cost, in credits (1 credit = NGN 1).
 * Meta publishes confirmed country rates on 2026-09-01; update
 * BOOKA_MESSAGE_RATE_CREDITS then. This constant is the last resort only.
 */
const PROVISIONAL_COST_CREDITS = 14;
const DEFAULT_MARKUP = 1.6;
const DEFAULT_GRACE_CREDITS = 100;
const DEFAULT_DRIFT_PCT = 2;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMeteringMode(): MeteringMode {
  return process.env.BOOKA_MESSAGE_METERING_MODE === 'live' ? 'live' : 'shadow';
}

export function isShadowMode(): boolean {
  return getMeteringMode() === 'shadow';
}

/** What Booka pays Meta per delivered message. */
export function resolveMessageCostCredits(): number {
  return positiveNumber(process.env.BOOKA_MESSAGE_RATE_CREDITS, PROVISIONAL_COST_CREDITS);
}

/** Resale multiplier covering FX drift, BSP and tax overhead, and margin. */
export function getMessageMarkup(): number {
  const parsed = Number(process.env.BOOKA_MESSAGE_MARKUP);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MARKUP;
}

/** What the tenant is charged per delivered message. */
export function resolveMessageSellCredits(tenantRate?: number | null): number {
  if (typeof tenantRate === 'number' && Number.isFinite(tenantRate) && tenantRate > 0) {
    return tenantRate;
  }
  return resolveMessageCostCredits() * getMessageMarkup();
}

export function getGraceOverdraftDefault(): number {
  return positiveNumber(process.env.BOOKA_MESSAGE_GRACE_CREDITS, DEFAULT_GRACE_CREDITS);
}

export function getReconcileDriftPct(): number {
  return positiveNumber(process.env.BOOKA_MESSAGE_RECONCILE_DRIFT_PCT, DEFAULT_DRIFT_PCT);
}
