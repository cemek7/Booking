/**
 * v2 WhatsApp Queue Worker
 *
 * Vercel Cron #1 — runs every minute.
 * Claims up to 20 pending messages from whatsapp_message_queue and
 * processes them through the v2 pipeline.
 *
 * Uses SELECT FOR UPDATE SKIP LOCKED for safe concurrent dequeuing
 * (no Redis or pgmq required — works on Supabase free tier).
 *
 * vercel.json cron config:
 *   { "path": "/api/worker/whatsapp", "schedule": "* * * * *" }
 */

import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { processMessageV2 } from '@/lib/whatsapp/v2/pipeline';
import { sendTelegramAlert } from '@/lib/monitoring/telegramAlert';

const supabaseAdmin = createSupabaseAdminClient();

const BATCH_SIZE = 20;
const MAX_EXECUTION_MS = 55_000; // Stay under Vercel's 60s limit

export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  // Verify this is a Vercel Cron request (or internal call)
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    // ── Claim messages using SELECT FOR UPDATE SKIP LOCKED ─────────────────
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
      'claim_whatsapp_queue_messages',
      { p_limit: BATCH_SIZE }
    );

    // Fallback if the RPC doesn't exist: inline the claim using raw SQL approach
    // The RPC wraps:
    //   WITH claimed AS (
    //     SELECT id FROM whatsapp_message_queue
    //     WHERE status IN ('pending', 'retry')
    //       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
    //     ORDER BY priority DESC, created_at ASC
    //     LIMIT p_limit
    //     FOR UPDATE SKIP LOCKED
    //   )
    //   UPDATE whatsapp_message_queue
    //   SET status = 'processing'
    //   WHERE id IN (SELECT id FROM claimed)
    //   RETURNING *;

    let messages = claimed;

    if (claimError || !messages) {
      // Direct query fallback (works if RPC not created yet)
      console.warn('[worker/whatsapp] claim_whatsapp_queue_messages RPC unavailable, using non-locking fallback');
      const { data: pending } = await supabaseAdmin
        .from('whatsapp_message_queue')
        .select('*')
        .in('status', ['pending', 'retry'])
        .or('scheduled_at.is.null,scheduled_at.lte.' + new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (!pending || pending.length === 0) {
        return NextResponse.json({ processed: 0, errors: 0, message: 'queue empty' });
      }

      // Mark as processing
      const ids = pending.map((m) => m.id);
      await supabaseAdmin
        .from('whatsapp_message_queue')
        .update({ status: 'processing' })
        .in('id', ids);

      messages = pending;
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ processed: 0, errors: 0, message: 'queue empty' });
    }

    // ── Process each message ───────────────────────────────────────────────
    for (const msg of messages) {
      // Check execution budget
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.warn('[worker/whatsapp] Execution budget reached, deferring remaining messages');
        // Release unprocessed messages back to pending
        const remainingIds = messages
          .slice(messages.indexOf(msg))
          .map((m: { id: string }) => m.id);
        await supabaseAdmin
          .from('whatsapp_message_queue')
          .update({ status: 'pending' })
          .in('id', remainingIds);
        break;
      }

      try {
        // msg.channel defaults to 'whatsapp' for all pre-079 rows (migration 079 adds the column).
        const msgChannel: 'whatsapp' | 'instagram' =
          msg.channel === 'instagram' ? 'instagram' : 'whatsapp';

        const didProcess = await processMessageV2(
          msg.from_number,
          msg.tenant_id,
          msg.content,
          msg.message_id ?? msg.id,
          msgChannel
        );

        if (!didProcess) {
          await supabaseAdmin
            .from('whatsapp_message_queue')
            .update({ status: 'pending' })
            .eq('id', msg.id);
          continue;
        }

        await supabaseAdmin
          .from('whatsapp_message_queue')
          .update({ status: 'completed', processed_at: new Date().toISOString() })
          .eq('id', msg.id);

        processed++;
      } catch (err) {
        errors++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[worker/whatsapp] processMessageV2 error', { id: msg.id, error: errorMessage });

        const retryCount = (msg.retry_count ?? 0) + 1;
        const maxRetries = msg.max_retries ?? 3;

        if (retryCount >= maxRetries) {
          await supabaseAdmin
            .from('whatsapp_message_queue')
            .update({ status: 'failed', error_message: errorMessage, retry_count: retryCount })
            .eq('id', msg.id);
        } else {
          // Exponential backoff: 1min, 4min, 9min
          const backoffSeconds = Math.pow(retryCount, 2) * 60;
          const scheduledAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
          await supabaseAdmin
            .from('whatsapp_message_queue')
            .update({
              status: 'retry',
              retry_count: retryCount,
              scheduled_at: scheduledAt,
              error_message: errorMessage,
            })
            .eq('id', msg.id);
        }
      }
    }

    // Alert if error rate is high
    if (errors > 0 && processed === 0) {
      await sendTelegramAlert(`WhatsApp worker: all ${errors} messages failed. Check logs.`);
    }

    return NextResponse.json({
      processed,
      errors,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[worker/whatsapp] Fatal error', err);
    await sendTelegramAlert(`WhatsApp worker crashed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
