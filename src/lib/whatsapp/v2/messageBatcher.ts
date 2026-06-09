/**
 * Message Batcher
 *
 * Accumulates rapid-fire messages from the same sender before processing.
 * Messages are appended to whatsapp_conversations.flow_data.pending_messages[].
 *
 * The worker (called every 30s by Vercel cron) checks if messages have
 * stopped arriving (gap ≥ 2500ms since the last append) before processing.
 * This prevents splitting a multi-message thought into multiple AI calls.
 */

import { createClient } from '@supabase/supabase-js';
import type { ConvChannel } from './conversationState';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PendingMessage {
  content: string;
  receivedAt: string; // ISO timestamp
  messageId: string;
}

const BATCH_GAP_MS = 2500; // messages still arriving if gap < this

// ─── Append ───────────────────────────────────────────────────────────────────

/**
 * Appends an incoming message to the pending_messages list in flow_data.
 * Called immediately when a webhook message arrives.
 *
 * The trailing `channel` param defaults to `'whatsapp'` so all existing callers
 * are unaffected. When channel='instagram', the row is keyed on (channel, external_id)
 * instead of phone_number (matching the conversationState key scheme from migration 078).
 */
export async function appendPendingMessage(
  externalId: string,
  tenantId: string,
  content: string,
  messageId: string,
  channel: ConvChannel = 'whatsapp'
): Promise<void> {
  const newMessage: PendingMessage = {
    content,
    receivedAt: new Date().toISOString(),
    messageId,
  };

  // Use jsonb_array_append to safely append without race conditions
  // We do a read-modify-write here since Supabase doesn't expose jsonb append natively
  const { data: current } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('flow_data')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const existingData = current?.flow_data ?? {};
  const pendingMessages: PendingMessage[] = existingData.pending_messages ?? [];
  pendingMessages.push(newMessage);

  await supabaseAdmin
    .from('whatsapp_conversations')
    .update({
      flow_data: { ...existingData, pending_messages: pendingMessages },
    })
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId);
}

// ─── Claim ────────────────────────────────────────────────────────────────────

/**
 * Checks if the message stream has settled (gap ≥ 2500ms since last message).
 * If settled, concatenates all pending messages into a single string and clears
 * the pending list.
 *
 * Returns null if messages are still arriving (caller should skip this cycle).
 * Returns the concatenated message string if ready to process.
 *
 * The trailing `channel` param defaults to `'whatsapp'` so all existing callers
 * are unaffected. Rows are keyed on (channel, external_id) matching migration 078.
 */
export async function claimBatch(
  externalId: string,
  tenantId: string,
  channel: ConvChannel = 'whatsapp'
): Promise<{ combined: string; messageIds: string[] } | null> {
  const { data } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('flow_data')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const flowData = data?.flow_data ?? {};
  const pendingMessages: PendingMessage[] = flowData.pending_messages ?? [];

  if (pendingMessages.length === 0) return null;

  // Check gap since last message
  const lastMessage = pendingMessages[pendingMessages.length - 1];
  const lastReceived = new Date(lastMessage.receivedAt).getTime();
  const gapMs = Date.now() - lastReceived;

  if (gapMs < BATCH_GAP_MS) {
    // Still arriving — skip this cycle
    return null;
  }

  // Settled — claim the batch
  const combined = pendingMessages.map((m) => m.content).join(' ');
  const messageIds = pendingMessages.map((m) => m.messageId);

  // Clear pending_messages from flow_data
  await supabaseAdmin
    .from('whatsapp_conversations')
    .update({
      flow_data: { ...flowData, pending_messages: [] },
    })
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId);

  return { combined, messageIds };
}
