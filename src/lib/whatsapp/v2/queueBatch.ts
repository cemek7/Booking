import { createHash } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { ConvChannel } from './conversationState';

export interface QueueRow {
  id: string;
  tenantId: string;
  channel: ConvChannel;
  externalId: string;
  conversationId: string;
  threadId: string;
  content: string;
  messageId: string;
  providerTimestamp: string | null;
  createdAt: string;
  batchId: string;
  leaseOwner: string;
  retryCount: number;
  maxRetries: number;
}

export interface ClaimedConversationBatch {
  batchId: string;
  workerId: string;
  tenantId: string;
  channel: ConvChannel;
  externalId: string;
  conversationId: string;
  threadId: string;
  rows: QueueRow[];
  combinedText: string;
  correlationKey: string;
}

export interface QueueBatchStore {
  claim(input: { workerId: string; settleBefore: string; leaseSeconds: number }): Promise<QueueRow[]>;
  complete(input: { batchId: string; workerId: string }): Promise<void>;
  retry(input: {
    batchId: string;
    workerId: string;
    errorMessage: string;
    scheduledAt: string;
    terminal: boolean;
    retryCount: number;
  }): Promise<void>;
}

export interface ConversationMessageIngest {
  webhookProvider: string;
  webhookExternalId: string;
  webhookPayload: unknown;
  messageId: string;
  tenantId: string;
  conversationId: string;
  threadId: string;
  channel: ConvChannel;
  fromNumber: string;
  toNumber: string;
  content: string;
  messageType: string;
  providerMessageId: string;
  providerTimestamp: string;
  raw: unknown;
  mediaInfo: unknown;
}

export async function ingestConversationMessage(
  input: ConversationMessageIngest,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('ingest_conversation_message', {
    p_webhook_provider: input.webhookProvider,
    p_webhook_external_id: input.webhookExternalId,
    p_webhook_payload: input.webhookPayload,
    p_message_id: input.messageId,
    p_tenant_id: input.tenantId,
    p_conversation_id: input.conversationId,
    p_thread_id: input.threadId,
    p_channel: input.channel,
    p_from_number: input.fromNumber,
    p_to_number: input.toNumber,
    p_content: input.content,
    p_message_type: input.messageType,
    p_provider_message_id: input.providerMessageId,
    p_provider_timestamp: input.providerTimestamp,
    p_raw: input.raw,
    p_media_info: input.mediaInfo,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) {
    throw new Error('Atomic conversation ingestion returned no queue identity');
  }
  return data;
}

function mapQueueRow(row: Record<string, unknown>): QueueRow {
  return {
    id: String(row.id ?? ''),
    tenantId: String(row.tenant_id ?? ''),
    channel: row.channel === 'instagram' ? 'instagram' : 'whatsapp',
    externalId: String(row.from_number ?? ''),
    conversationId: String(row.conversation_id ?? ''),
    threadId: String(row.conversation_thread_id ?? ''),
    content: String(row.content ?? ''),
    messageId: String(row.message_id ?? ''),
    providerTimestamp: typeof row.provider_timestamp === 'string' ? row.provider_timestamp : null,
    createdAt: String(row.created_at ?? ''),
    batchId: String(row.batch_id ?? ''),
    leaseOwner: String(row.lease_owner ?? ''),
    retryCount: Number(row.retry_count ?? 0),
    maxRetries: Number(row.max_retries ?? 3),
  };
}

function createQueueBatchStore(): QueueBatchStore {
  const admin = createSupabaseAdminClient();
  return {
    async claim(input) {
      const { data, error } = await admin.rpc('claim_whatsapp_conversation_batch', {
        p_worker_id: input.workerId,
        p_settle_before: input.settleBefore,
        p_lease_seconds: input.leaseSeconds,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map((row) => mapQueueRow(row));
    },

    async complete(input) {
      const { error } = await admin.from('whatsapp_message_queue').update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      }).eq('batch_id', input.batchId).eq('lease_owner', input.workerId);
      if (error) throw error;
    },

    async retry(input) {
      const { error } = await admin.from('whatsapp_message_queue').update({
        status: input.terminal ? 'failed' : 'retry',
        scheduled_at: input.scheduledAt,
        error_message: input.errorMessage,
        retry_count: input.retryCount,
        lease_owner: null,
        lease_expires_at: null,
        batch_id: null,
      }).eq('batch_id', input.batchId).eq('lease_owner', input.workerId);
      if (error) throw error;
    },
  };
}

function orderRows(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) => {
    const aProvider = a.providerTimestamp ?? a.createdAt;
    const bProvider = b.providerTimestamp ?? b.createdAt;
    return aProvider.localeCompare(bProvider)
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id);
  });
}

function validateRows(rows: QueueRow[], workerId: string): void {
  const first = rows[0];
  const required = [
    first.id, first.tenantId, first.externalId, first.conversationId,
    first.threadId, first.batchId, first.leaseOwner,
  ];
  if (required.some((value) => !value) || first.leaseOwner !== workerId) {
    throw new Error('Claim RPC returned incomplete lease metadata');
  }

  const isMixed = rows.some((row) =>
    row.tenantId !== first.tenantId
    || row.channel !== first.channel
    || row.externalId !== first.externalId
    || row.conversationId !== first.conversationId
    || row.threadId !== first.threadId
    || row.batchId !== first.batchId
    || row.leaseOwner !== workerId
  );
  if (isMixed) throw new Error('Claim RPC returned mixed conversation rows');
}

export async function claimNextConversationBatch(
  input: { workerId: string; settleBefore: Date; leaseSeconds: number },
  store: QueueBatchStore = createQueueBatchStore(),
): Promise<ClaimedConversationBatch | null> {
  const rows = await store.claim({
    workerId: input.workerId,
    settleBefore: input.settleBefore.toISOString(),
    leaseSeconds: input.leaseSeconds,
  });
  if (rows.length === 0) return null;
  validateRows(rows, input.workerId);

  const ordered = orderRows(rows);
  const first = ordered[0];
  const sortedIds = ordered.map((row) => row.id).sort();
  const digest = createHash('sha256').update(sortedIds.join(',')).digest('hex');
  return {
    batchId: first.batchId,
    workerId: input.workerId,
    tenantId: first.tenantId,
    channel: first.channel,
    externalId: first.externalId,
    conversationId: first.conversationId,
    threadId: first.threadId,
    rows: ordered,
    combinedText: ordered.map((row) => row.content).filter(Boolean).join(' '),
    correlationKey: `conversation-batch:${digest}`,
  };
}

export async function completeConversationBatch(
  batch: ClaimedConversationBatch,
  store: QueueBatchStore = createQueueBatchStore(),
): Promise<void> {
  await store.complete({ batchId: batch.batchId, workerId: batch.workerId });
}

export async function retryConversationBatch(
  batch: ClaimedConversationBatch,
  input: { errorMessage: string; scheduledAt: Date; terminal: boolean },
  store: QueueBatchStore = createQueueBatchStore(),
): Promise<void> {
  await store.retry({
    batchId: batch.batchId,
    workerId: batch.workerId,
    errorMessage: input.errorMessage,
    scheduledAt: input.scheduledAt.toISOString(),
    terminal: input.terminal,
    retryCount: Math.max(...batch.rows.map((row) => row.retryCount)) + 1,
  });
}
