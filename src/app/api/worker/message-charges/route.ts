import { NextResponse } from 'next/server';
import { releaseStaleReservations } from '@/lib/billing/messageWallet';
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
    const result = await releaseStaleReservations(createSupabaseAdminClient(), STALE_AFTER_MS);
    if (result.released > 0) {
      console.warn('[worker/message-charges] released stale reservations', result);
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[worker/message-charges] failed', { error: message });
    return NextResponse.json({ error: 'Message charge sweeper failed' }, { status: 500 });
  }
}
