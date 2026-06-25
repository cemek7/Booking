export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import EnhancedJobManager from '@/lib/enhancedJobManager';
import { defaultLogger } from '@/lib/logger';

/**
 * POST /api/jobs/process
 *
 * Drains the pending jobs queue. Intended to be called by an external scheduler
 * (Vercel Cron, Supabase pg_cron, or any HTTP cron service) every 1–2 minutes.
 *
 * Security: requires `x-cron-secret` header matching CRON_SECRET env var.
 * If CRON_SECRET is not set the endpoint rejects requests.
 *
 * Handles: process_whatsapp_message, send_booking_reminder, and any other
 * job types registered in EnhancedJobManager.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const batchSize = Math.min(Number(body?.batch_size) || 20, 50);

  const supabase = createSupabaseAdminClient();
  const lockKey = 'jobs_process';
  const lockTtlSeconds = 90;

  // D.1: Distributed lock — prevents two simultaneous cron invocations from
  // double-processing the same batch or double-resetting stale jobs.
  // Prefer the expiry-aware RPC (stale-lock reclaim), with legacy fallback.
  let lockAcquired = false;
  const { data: rpcLock, error: rpcLockError } = await supabase.rpc('acquire_cron_lock', {
    p_key: lockKey,
    p_ttl_seconds: lockTtlSeconds,
  });

  if (rpcLockError) {
    defaultLogger.warn('[JOBS] acquire_cron_lock RPC unavailable, using legacy fallback', {
      error: rpcLockError.message,
    });
    await supabase
      .from('cron_locks')
      .delete()
      .eq('key', lockKey)
      .lt('locked_until', new Date().toISOString());
    const { data: fallbackLock } = await supabase
      .from('cron_locks')
      .insert({ key: lockKey, locked_until: new Date(Date.now() + lockTtlSeconds * 1000).toISOString() })
      .select('key')
      .maybeSingle();
    lockAcquired = Boolean(fallbackLock);
  } else {
    lockAcquired = Boolean(rpcLock);
  }

  if (!lockAcquired) {
    defaultLogger.info('[JOBS] Another cron worker is running, skipping');
    return NextResponse.json({ status: 'locked', skipped: true }, { status: 200 });
  }

  try {
    const jobManager = new EnhancedJobManager(supabase);

    const result = await jobManager.processJobs({
      batch_size: batchSize,
      worker_id: `cron-${Date.now()}`,
      max_runtime_ms: 55_000, // Stay under 60s Vercel function limit
    });

    defaultLogger.info('[JOBS] Cron processor completed', result);

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    defaultLogger.error('[JOBS] Cron processor failed:', error);
    return NextResponse.json({ success: false, error }, { status: 500 });
  } finally {
    const { error: releaseError } = await supabase.rpc('release_cron_lock', { p_key: lockKey });
    if (releaseError) {
      await supabase.from('cron_locks').delete().eq('key', lockKey);
    }
  }
}

/** GET — health check so the cron provider can ping before scheduling */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'POST /api/jobs/process',
    description: 'Drains the jobs queue. Call every 1–2 minutes via cron.',
  });
}
