export type MeteringMode = 'shadow' | 'live';

/**
 * Nigerian per-message costs, in credits (1 credit = NGN 1).
 *
 * Meta's published rates as of 2026-09: service/utility $0.0101 (~NGN 14 at
 * ~NGN 1,340/$), marketing $0.062 (~NGN 84). Both move with the exchange rate,
 * so both are env-overridable and these constants are the last resort only.
 *
 * MARKETING IS SIX TIMES THE PRICE. Charging one flat rate meant a marketing
 * message cost Booka NGN 84 and billed the tenant NGN 22.40 — a NGN 61.60 loss
 * on every one. Anything that fans out to a customer list is marketing.
 */
const PROVISIONAL_COST_CREDITS = 14;
const PROVISIONAL_MARKETING_COST_CREDITS = 84;
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

/**
 * Meta's pricing categories. `service` is a free-form reply inside the 24-hour
 * customer-service window; the rest are template categories.
 */
export type MessageCategory = 'service' | 'utility' | 'marketing' | 'authentication';

/** Normalises whatever Meta put in the webhook's pricing.category. */
export function normalizeCategory(raw?: string | null): MessageCategory | null {
  const c = String(raw ?? '').trim().toLowerCase();
  if (c === 'marketing') return 'marketing';
  if (c === 'utility') return 'utility';
  if (c === 'authentication' || c === 'authentication_international') return 'authentication';
  if (c === 'service') return 'service';
  return null;
}

/** What Booka pays Meta per delivered message of this category. */
export function resolveMessageCostCredits(category?: MessageCategory | null): number {
  if (category === 'marketing') {
    return positiveNumber(
      process.env.BOOKA_MESSAGE_MARKETING_RATE_CREDITS,
      PROVISIONAL_MARKETING_COST_CREDITS,
    );
  }
  return positiveNumber(process.env.BOOKA_MESSAGE_RATE_CREDITS, PROVISIONAL_COST_CREDITS);
}

/** Resale multiplier covering FX drift, BSP and tax overhead, and margin. */
export function getMessageMarkup(): number {
  const parsed = Number(process.env.BOOKA_MESSAGE_MARKUP);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MARKUP;
}

/**
 * What the tenant is charged per delivered message.
 *
 * A per-tenant rate override still applies to service and utility traffic, but
 * NOT to marketing: a negotiated rate for conversational replies must not
 * silently become a six-times-under-cost rate for broadcasts.
 */
export function resolveMessageSellCredits(
  tenantRate?: number | null,
  category?: MessageCategory | null,
): number {
  const hasOverride = typeof tenantRate === 'number' && Number.isFinite(tenantRate) && tenantRate > 0;
  if (hasOverride && category !== 'marketing') {
    return tenantRate;
  }
  return resolveMessageCostCredits(category) * getMessageMarkup();
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
