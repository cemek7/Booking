import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { resetRateCardCache } from '@/lib/billing/rateCard';
import { sendTelegramInfo } from '@/lib/monitoring/telegramAlert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Keeps the naira cost basis honest.
 *
 * Meta bills in USD and Booka sells in naira, so the real cost moves every time
 * the rate does — with no announcement to read and no quarter boundary. This is
 * the leak that opens silently: a slide from 1340 to 1600 raises cost by 19%
 * while every dashboard still says NGN 14.
 *
 * Readings are APPENDED, never overwritten, so a settled charge can always be
 * reconciled against the rate that was in force when it settled.
 *
 * Deliberately a worker rather than part of the send path: an FX provider having
 * a bad afternoon must never add latency to an inbound reply, so
 * resolveCostBasis() only ever reads what this job stored.
 */

const FX_URL = 'https://open.er-api.com/v6/latest/USD';

/** How far the naira may move before a human should look at the plan tiers. */
const DRIFT_ALERT_PCT = 5;

interface ErApiResponse {
  result?: string;
  rates?: Record<string, number>;
}

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (
    process.env.NODE_ENV === 'production'
    && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();

    const { data: current } = await admin
      .from('platform_fx_rates')
      .select('rate, as_of')
      .eq('base', 'USD').eq('quote', 'NGN')
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle();
    const storedRate = current ? Number((current as { rate: number | string }).rate) : null;

    let live: number | null = null;
    try {
      const res = await fetchWithTimeout(FX_URL, { timeoutMs: 15_000 });
      const body = (await res.json()) as ErApiResponse;
      const ngn = body?.rates?.NGN;
      if (body?.result === 'success' && typeof ngn === 'number' && ngn > 0) live = ngn;
    } catch (error) {
      console.warn('[worker/fx-rate] FX fetch failed', error);
    }

    if (live === null) {
      // Not an error. The stored rate is still what pricing uses, so a missed
      // reading changes nothing; repeated failures surface as a stale as_of.
      return NextResponse.json({ ok: true, fetched: false, storedRate });
    }

    const driftPct = storedRate && storedRate > 0
      ? (Math.abs(live - storedRate) / storedRate) * 100
      : null;

    const { error: insertError } = await admin.from('platform_fx_rates').insert({
      base: 'USD', quote: 'NGN', rate: live,
      as_of: new Date().toISOString(), source: 'open.er-api.com',
    });
    if (insertError) {
      console.error('[worker/fx-rate] could not store the reading', insertError);
      return NextResponse.json({ ok: false, error: 'store failed' }, { status: 500 });
    }
    resetRateCardCache();

    // The alert is the point of the job. Pricing follows the naira now, so a
    // large move re-prices every tenant without anyone deciding it should.
    if (driftPct !== null && driftPct >= DRIFT_ALERT_PCT) {
      const direction = live > (storedRate ?? 0) ? 'weakened' : 'strengthened';
      console.warn('[worker/fx-rate] cost base moved', { storedRate, live, driftPct });
      await sendTelegramInfo(
        `FX drift ${driftPct.toFixed(1)}%: the naira has ${direction} against the dollar `
        + `(${storedRate?.toFixed(2)} to ${live.toFixed(2)}). WhatsApp costs are set in USD, `
        + `so Booka's cost per message moved with it — check the plan tiers still cover it.`,
      ).catch(() => { /* telemetry must not fail the job */ });
    }

    return NextResponse.json({
      ok: true,
      fetched: true,
      storedRate,
      liveRate: live,
      driftPct: driftPct === null ? null : Number(driftPct.toFixed(2)),
      alerted: driftPct !== null && driftPct >= DRIFT_ALERT_PCT,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[worker/fx-rate] failed', { error: message });
    return NextResponse.json({ error: 'FX refresh failed' }, { status: 500 });
  }
}
