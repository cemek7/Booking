import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type MessageCategory,
  resolveMessageCostCredits,
  getMessageMarkup,
} from '@/lib/billing/messageRates';

/**
 * The cost basis for a WhatsApp message: Meta's USD price times the naira rate.
 *
 * Kept apart from messageRates.ts on purpose. That file holds the constants and
 * the pure arithmetic; this one talks to the database and can therefore fail,
 * be stale, or be empty. Every failure here falls back to the constants, because
 * a message must never go unsent over a pricing lookup.
 *
 * The send path NEVER calls an FX API. It reads the newest stored rate; a
 * separate worker refreshes that and alarms on drift. An FX provider having a
 * bad afternoon must not add latency to an inbound reply.
 */

const RATE_TABLE = 'message_rate_card';
const FX_TABLE = 'platform_fx_rates';

/** How long a loaded rate card is trusted before re-reading. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Sell price may never fall below cost times this, whatever a tenant override
 * or a stale rate says. The floor is the last line against selling at a loss.
 */
const MIN_MARKUP = 1.15;

export interface RateBasis {
  costUsd: number;
  fxRate: number;
  /** costUsd * fxRate, in credits (1 credit = NGN 1). */
  costCredits: number;
  fxAsOf: string | null;
  /** True when this came from the constants rather than the database. */
  fallback: boolean;
}

interface CardRow { category: string; cost_usd: number | string; effective_from: string }
interface FxRow { rate: number | string; as_of: string }

interface CacheEntry { at: number; card: CardRow[]; fx: FxRow | null }
let cache: CacheEntry | null = null;

/** Drops the cache. Used by the FX worker after it writes, and by tests. */
export function resetRateCardCache(): void {
  cache = null;
}

async function load(admin: SupabaseClient): Promise<CacheEntry> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;

  const [cardRes, fxRes] = await Promise.all([
    admin.from(RATE_TABLE).select('category, cost_usd, effective_from')
      .eq('country_code', 'NG').order('effective_from', { ascending: false }),
    admin.from(FX_TABLE).select('rate, as_of')
      .eq('base', 'USD').eq('quote', 'NGN')
      .order('as_of', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (cardRes.error) {
    console.warn('[rateCard] rate card read failed, using constants', cardRes.error);
  }
  if (fxRes.error) {
    console.warn('[rateCard] fx read failed, using constants', fxRes.error);
  }

  // On error treat the source as empty rather than trusting `data` to be null:
  // an empty card falls back to the constants, which is the safe direction.
  cache = {
    at: Date.now(),
    card: (cardRes.error ? [] : (cardRes.data ?? [])) as CardRow[],
    fx: (fxRes.error ? null : (fxRes.data ?? null)) as FxRow | null,
  };
  return cache;
}

function pickRate(rows: CardRow[], category: MessageCategory, at: Date): number | null {
  // Rows arrive newest-first, so the first one already in effect is the answer.
  const onDate = at.toISOString().slice(0, 10);
  const hit = rows.find((r) => r.category === category && r.effective_from <= onDate);
  if (!hit) return null;
  const n = Number(hit.cost_usd);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * What Meta charges for one message of this category, in credits.
 *
 * Falls back to the compiled-in constants when the rate card has nothing in
 * effect — which is the state before migration 146 is applied, and the state
 * on any date earlier than the first row.
 */
export async function resolveCostBasis(
  admin: SupabaseClient,
  category: MessageCategory | null,
  at: Date = new Date(),
): Promise<RateBasis> {
  const cat = category ?? 'service';
  try {
    const { card, fx } = await load(admin);
    const costUsd = pickRate(card, cat, at);
    const fxRate = fx ? Number(fx.rate) : NaN;

    if (costUsd === null || !Number.isFinite(fxRate) || fxRate <= 0) {
      return {
        costUsd: 0, fxRate: 0,
        costCredits: resolveMessageCostCredits(cat),
        fxAsOf: fx?.as_of ?? null,
        fallback: true,
      };
    }

    return {
      costUsd, fxRate,
      costCredits: costUsd * fxRate,
      fxAsOf: fx?.as_of ?? null,
      fallback: false,
    };
  } catch (error) {
    console.warn('[rateCard] cost basis lookup threw, using constants', { category: cat, error });
    return {
      costUsd: 0, fxRate: 0,
      costCredits: resolveMessageCostCredits(cat),
      fxAsOf: null,
      fallback: true,
    };
  }
}

/**
 * What the tenant is charged, in credits.
 *
 * A per-tenant override applies to service and utility only — never to
 * marketing, and never below the margin floor. A rate negotiated for
 * conversational replies must not become an under-cost rate for broadcasts,
 * and no override may sell below what Meta charges.
 */
export async function resolveSellCredits(
  admin: SupabaseClient,
  tenantRate: number | null | undefined,
  category: MessageCategory | null,
  at: Date = new Date(),
): Promise<number> {
  const basis = await resolveCostBasis(admin, category, at);
  const listPrice = basis.costCredits * getMessageMarkup();

  const hasOverride = typeof tenantRate === 'number' && Number.isFinite(tenantRate) && tenantRate > 0;
  if (!hasOverride || category === 'marketing') return listPrice;

  const floor = basis.costCredits * MIN_MARKUP;
  if (tenantRate < floor) {
    console.warn('[rateCard] tenant rate is below the margin floor, clamping', {
      tenantRate, floor, category,
    });
    return floor;
  }
  return tenantRate;
}

export const RATE_CARD_INTERNALS = { CACHE_TTL_MS, MIN_MARKUP, pickRate };
