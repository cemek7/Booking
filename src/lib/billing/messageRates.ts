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
const DEFAULT_HANDOFF_REARM_HOURS = 24;
const DEFAULT_HANDOFF_HUMAN_MINUTES = 60;

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

/**
 * How long a wallet-exhaustion handoff keeps a conversation reserved for a
 * human before the assistant may take it back.
 *
 * Deliberately much shorter than the 24-hour handoff re-arm. The two clocks
 * answer different questions: the re-arm bounds how often a customer is TOLD a
 * human is coming, while this bounds how long the AI stays out. If the owner
 * tops up ten minutes later, the assistant should resume promptly rather than
 * sit silent for a day — and while the wallet is still empty the AI cannot send
 * anyway, so a short window costs nothing.
 */
export function getHandoffHumanHandlingMinutes(): number {
  return positiveNumber(process.env.BOOKA_HANDOFF_HUMAN_MINUTES, DEFAULT_HANDOFF_HUMAN_MINUTES);
}

/**
 * How long a wallet-exhausted handoff keeps one conversation silent before the
 * customer may be handed off again. Bounds the "topped up and re-exhausted"
 * case; see triggerWalletHandoff, which also re-arms on a wallet credit.
 */
export function getHandoffRearmHours(): number {
  return positiveNumber(process.env.BOOKA_WALLET_HANDOFF_REARM_HOURS, DEFAULT_HANDOFF_REARM_HOURS);
}

export function getReconcileDriftPct(): number {
  return positiveNumber(process.env.BOOKA_MESSAGE_RECONCILE_DRIFT_PCT, DEFAULT_DRIFT_PCT);
}
