/**
 * Reminders Cron Job — send due reminders across ALL tenants.
 *
 * The scheduled, all-tenants counterpart to POST /api/reminders/run (which is session-auth and
 * scoped to one tenant). Both share runRemindersForTenant() so behavior is identical per tenant.
 *
 * Auth: Authorization: Bearer $CRON_SECRET (mirrors /api/cron/nightly). In non-production the
 * check is skipped so local/test drivers can call it.
 *
 * VPS scheduler: deployment/vps-crontab.txt runs this every 10 minutes.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runRemindersForTenant } from '@/lib/reminders/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5-minute budget

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Active tenants only — offboarded tenants have no live reminders and their data is purged.
  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .is('offboarded_at', null);

  if (error) {
    return NextResponse.json({ error: 'Failed to list tenants' }, { status: 500 });
  }

  let remindersProcessed = 0;
  let v2RemindersSent = 0;
  let tenantsProcessed = 0;
  const failures: Array<{ tenantId: string; error: string }> = [];

  for (const t of tenants ?? []) {
    try {
      const result = await runRemindersForTenant(supabaseAdmin, t.id);
      remindersProcessed += result.processed;
      v2RemindersSent += result.v2_reminders_sent;
      tenantsProcessed += 1;
    } catch (err) {
      failures.push({
        tenantId: t.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    tenants_processed: tenantsProcessed,
    reminders_processed: remindersProcessed,
    v2_reminders_sent: v2RemindersSent,
    failures,
  });
}
