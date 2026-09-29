/** Leased conversation-batch worker for WhatsApp and Instagram inbound queues. */

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { processConversationBatch } from '@/lib/whatsapp/v2/pipeline';
import {
  claimNextConversationBatch,
  completeConversationBatch,
  retryConversationBatch,
} from '@/lib/whatsapp/v2/queueBatch';
import { sendTelegramAlert } from '@/lib/monitoring/telegramAlert';

const MAX_BATCHES = 20;
const MAX_EXECUTION_MS = 55_000;
const SETTLE_GAP_MS = 2_500;
const LEASE_SECONDS = 120;

export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (process.env.NODE_ENV === 'production'
      && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const workerId = randomUUID();
  let processed = 0;
  let errors = 0;

  try {
    while (processed + errors < MAX_BATCHES && Date.now() - startedAt < MAX_EXECUTION_MS) {
      const batch = await claimNextConversationBatch({
        workerId,
        settleBefore: new Date(Date.now() - SETTLE_GAP_MS),
        leaseSeconds: LEASE_SECONDS,
      });
      if (!batch) break;

      try {
        const result = await processConversationBatch(batch);
        if (result.disposition !== 'complete') {
          throw new Error('Pipeline returned an unsupported batch disposition');
        }
        await completeConversationBatch(batch);
        processed += 1;
      } catch (error) {
        errors += 1;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const nextRetryCount = Math.max(...batch.rows.map((row) => row.retryCount)) + 1;
        const maxRetries = Math.min(...batch.rows.map((row) => row.maxRetries));
        const terminal = nextRetryCount >= maxRetries;
        const backoffSeconds = Math.pow(nextRetryCount, 2) * 60;
        await retryConversationBatch(batch, {
          errorMessage,
          scheduledAt: new Date(Date.now() + backoffSeconds * 1000),
          terminal,
        });
      }
    }

    if (errors > 0 && processed === 0) {
      await sendTelegramAlert(`Conversation worker: all ${errors} batches failed. Check logs.`);
    }

    return NextResponse.json({
      processed,
      errors,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendTelegramAlert(`Conversation worker crashed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
