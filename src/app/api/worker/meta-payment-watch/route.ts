import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { runMetaPaymentWatch } from '@/lib/billing/metaBillingWatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Warns tenants who own their own Meta billing that they need a payment method
 * before 2026-10-01, when Meta stops delivering service messages without one.
 *
 * Booka's own payment method covers only the shared gateway. A tenant who
 * connected their own number is billed by Meta directly, and nothing in the
 * product would raise an error when their messages stop — they would simply go
 * quiet. Schedule this daily until the deadline.
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
    const result = await runMetaPaymentWatch(createSupabaseAdminClient());
    if (result.warned > 0) {
      console.warn('[worker/meta-payment-watch] warned tenants who own their Meta billing', result);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[worker/meta-payment-watch] failed', { error: message });
    return NextResponse.json({ error: 'Meta payment watch failed' }, { status: 500 });
  }
}
