import { NextResponse } from 'next/server';
import { releaseStaleReservations } from '@/lib/billing/messageWallet';
import { findStrandedReservations } from '@/lib/billing/messageReconciliation';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * How long a reservation may sit unsettled before it is released at zero cost.
 * Long on purpose: this moves money, so it must be past any plausible delay in
 * Meta's delivery webhook rather than merely past the common case.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Stranded rows are only REPORTED, never released, so this window can be far
 * more sensitive than the sweep window above: an hour is three orders of
 * magnitude past the normal reserve -> attachWamid gap, so it cannot produce
 * false positives, and it surfaces an incident the same day.
 */
const STRANDED_AFTER_MS = 60 * 60 * 1000;

/**
 * Releases message-charge reservations that never received a delivery webhook.
 *
 * Without this, a broken webhook subscription silently drains every tenant's
 * balance into reservations that never settle. The released count is also the
 * only early warning that the subscription has broken at all — a sustained
 * non-zero value means Meta has stopped delivering statuses.
 */
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
    const result = await releaseStaleReservations(admin, STALE_AFTER_MS);
    if (result.released > 0) {
      console.warn('[worker/message-charges] released stale reservations', result);
    }

    // Rows the sweep above structurally cannot see: it filters wamid IS NOT NULL
    // because settle_ai_wallet_spend is not idempotent, so sweeping an
    // already-settled row would refund twice. That leaves reserved rows with a
    // NULL wamid invisible to every automatic path. This is their only detection
    // channel, and it REPORTS ONLY — a row that settled but failed its final
    // update is indistinguishable from one that never settled, so releasing
    // automatically would double-refund exactly the case this catches.
    const stranded = await findStrandedReservations(admin, STRANDED_AFTER_MS);
    if (stranded.length > 0) {
      console.error(
        '[worker/message-charges] stranded reservations need manual reconciliation',
        { count: stranded.length, chargeIds: stranded.map((s) => s.chargeId) },
      );
    }

    return NextResponse.json({ ...result, stranded: stranded.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[worker/message-charges] failed', { error: message });
    return NextResponse.json({ error: 'Message charge sweeper failed' }, { status: 500 });
  }
}
