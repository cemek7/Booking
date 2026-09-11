import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tells you a Meta price change is coming BEFORE it lands.
 *
 * Meta may only change prices on the 1st of a quarter, and must give at least
 * a month's notice for a rate change (six for a pricing-model change). So being
 * caught out is a calendar problem, not an intelligence problem — the dates are
 * known years ahead, and the only question is whether anyone confirmed the rate
 * card before each one.
 *
 * That is exactly what failed already: messageRates.ts carried a comment saying
 * "Meta publishes confirmed country rates on 2026-09-01; update the rate then",
 * and the date passed unnoticed until someone happened to look a week later.
 * A comment cannot raise its hand. This can.
 */

/** Warn this far ahead — comfortably beyond Meta's one-month notice. */
export const LOOKAHEAD_DAYS = 45;

/** Flag the FX reading as stale after this long. */
export const FX_STALE_DAYS = 14;

export interface RateCardWarning {
  kind: "quarter_unconfirmed" | "fx_stale" | "no_rate_card";
  message: string;
  /** The quarter start this concerns, for quarter_unconfirmed. */
  effectiveOn?: string;
}

/** The next 1st-of-quarter on or after `from`. */
export function nextQuarterStart(from: Date): Date {
  const y = from.getUTCFullYear();
  const starts = [0, 3, 6, 9].map((m) => new Date(Date.UTC(y, m, 1)));
  starts.push(new Date(Date.UTC(y + 1, 0, 1)));
  return starts.find((d) => d > from)!;
}

export function daysUntil(target: Date, from: Date): number {
  return Math.ceil((target.getTime() - from.getTime()) / 86_400_000);
}

interface CardRow {
  category: string;
  effective_from: string;
}
interface FxRow {
  as_of: string;
}

/**
 * Everything worth a human's attention about the cost basis. Pure enough to
 * test: the rows come from the caller.
 */
export function evaluateRateCard(
  card: CardRow[],
  fx: FxRow | null,
  now: Date = new Date(),
): RateCardWarning[] {
  const out: RateCardWarning[] = [];

  if (card.length === 0) {
    out.push({
      kind: "no_rate_card",
      message:
        "No message rate card rows. Pricing has fallen back to the compiled-in " +
        "constants, which nothing keeps current — apply migration 147.",
    });
  } else {
    const quarter = nextQuarterStart(now);
    const days = daysUntil(quarter, now);
    const onDate = quarter.toISOString().slice(0, 10);
    if (days <= LOOKAHEAD_DAYS) {
      // Meta can only change prices on a quarter start, and announces a month
      // ahead — so by now the next rate is either published or confirmed
      // unchanged. Either way somebody must put a row in.
      const confirmed = card.some((r) => r.effective_from >= onDate);
      if (!confirmed) {
        out.push({
          kind: "quarter_unconfirmed",
          effectiveOn: onDate,
          message:
            `Meta's next possible price change is ${onDate} (${days} days). The rate ` +
            `card has nothing dated on or after it. Confirm Meta's published rates and ` +
            `add rows — a future-dated row applies itself on the day.`,
        });
      }
    }
  }

  const asOf = fx?.as_of ? Date.parse(fx.as_of) : NaN;
  if (!Number.isFinite(asOf)) {
    out.push({
      kind: "fx_stale",
      message:
        "No USD/NGN reading stored. Message costs are set in USD, so the naira " +
        "cost cannot be derived — run the fx-rate worker.",
    });
  } else {
    const ageDays = Math.floor((now.getTime() - asOf) / 86_400_000);
    if (ageDays > FX_STALE_DAYS) {
      out.push({
        kind: "fx_stale",
        message:
          `The USD/NGN rate is ${ageDays} days old. Margins are being modelled on a ` +
          `stale naira, and the naira moves with no announcement — check the fx-rate worker.`,
      });
    }
  }

  return out;
}

/** Reads the rows and evaluates them. Never throws; an empty list means healthy. */
export async function checkRateCard(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<RateCardWarning[]> {
  try {
    const [cardRes, fxRes] = await Promise.all([
      admin
        .from("message_rate_card")
        .select("category, effective_from")
        .eq("country_code", "NG"),
      admin
        .from("platform_fx_rates")
        .select("as_of")
        .eq("base", "USD")
        .eq("quote", "NGN")
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return evaluateRateCard(
      (cardRes.data ?? []) as CardRow[],
      (fxRes.data ?? null) as FxRow | null,
      now,
    );
  } catch (error) {
    console.warn("[rateCardWatch] check failed", error);
    return [];
  }
}
