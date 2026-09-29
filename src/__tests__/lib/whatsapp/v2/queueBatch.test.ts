const mockRpc = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));

import {
  claimNextConversationBatch,
  completeConversationBatch,
  retryConversationBatch,
  ingestConversationMessage,
  type QueueBatchStore,
  type QueueRow,
} from '@/lib/whatsapp/v2/queueBatch';

const baseRow: QueueRow = {
  id: 'queue-1',
  tenantId: 'tenant-1',
  channel: 'whatsapp',
  externalId: '+2348031234567',
  conversationId: 'conversation-1',
  threadId: 'thread-1',
  content: 'tomorrow',
  messageId: 'message-1',
  providerTimestamp: '2026-09-28T12:00:02.000Z',
  createdAt: '2026-09-28T12:00:02.100Z',
  batchId: 'batch-1',
  leaseOwner: 'worker-1',
  retryCount: 0,
  maxRetries: 3,
};

function store(overrides: Partial<QueueBatchStore> = {}): QueueBatchStore {
  return {
    claim: jest.fn().mockResolvedValue([]),
    complete: jest.fn().mockResolvedValue(undefined),
    retry: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('claimNextConversationBatch', () => {
  it('combines only RPC-returned rows in stable provider order', async () => {
    const earlier = {
      ...baseRow, id: 'queue-0', messageId: 'message-0', content: 'I need braids',
      providerTimestamp: '2026-09-28T12:00:01.000Z', createdAt: '2026-09-28T12:00:01.100Z',
    };
    const batchStore = store({ claim: jest.fn().mockResolvedValue([baseRow, earlier]) });

    const result = await claimNextConversationBatch({
      workerId: 'worker-1', settleBefore: new Date('2026-09-28T12:00:05.000Z'), leaseSeconds: 120,
    }, batchStore);

    expect(result).toMatchObject({
      batchId: 'batch-1', workerId: 'worker-1', tenantId: 'tenant-1', channel: 'whatsapp',
      externalId: '+2348031234567', conversationId: 'conversation-1', threadId: 'thread-1',
      combinedText: 'I need braids tomorrow',
    });
    expect(result?.rows.map((row) => row.id)).toEqual(['queue-0', 'queue-1']);
    expect(result?.correlationKey).toMatch(/^conversation-batch:[a-f0-9]{64}$/);
  });

  it('fails closed when the leased-claim RPC is unavailable', async () => {
    const missingRpc = Object.assign(new Error('function does not exist'), { code: '42883' });
    const batchStore = store({ claim: jest.fn().mockRejectedValue(missingRpc) });

    await expect(claimNextConversationBatch({
      workerId: 'worker-1', settleBefore: new Date(), leaseSeconds: 120,
    }, batchStore)).rejects.toThrow('function does not exist');
  });

  it('rejects a mixed or incomplete RPC result instead of processing ambiguous rows', async () => {
    const batchStore = store({
      claim: jest.fn().mockResolvedValue([
        baseRow,
        { ...baseRow, id: 'queue-2', threadId: 'thread-other' },
      ]),
    });
    await expect(claimNextConversationBatch({
      workerId: 'worker-1', settleBefore: new Date(), leaseSeconds: 120,
    }, batchStore)).rejects.toThrow('mixed conversation rows');
  });
});

describe('batch dispositions', () => {
  it('completes only rows matching the batch and lease owner', async () => {
    const batchStore = store();
    const batch = (await claimNextConversationBatch({
      workerId: 'worker-1', settleBefore: new Date(), leaseSeconds: 120,
    }, store({ claim: jest.fn().mockResolvedValue([baseRow]) })))!;

    await completeConversationBatch(batch, batchStore);
    expect(batchStore.complete).toHaveBeenCalledWith({ batchId: 'batch-1', workerId: 'worker-1' });
  });

  it('retries only the leased batch with a scheduled backoff', async () => {
    const batchStore = store();
    const batch = (await claimNextConversationBatch({
      workerId: 'worker-1', settleBefore: new Date(), leaseSeconds: 120,
    }, store({ claim: jest.fn().mockResolvedValue([baseRow]) })))!;
    const scheduledAt = new Date('2026-09-28T12:01:00.000Z');

    await retryConversationBatch(batch, {
      errorMessage: 'provider timeout', scheduledAt, terminal: false,
    }, batchStore);
    expect(batchStore.retry).toHaveBeenCalledWith({
      batchId: 'batch-1', workerId: 'worker-1', errorMessage: 'provider timeout',
      scheduledAt: scheduledAt.toISOString(), terminal: false, retryCount: 1,
    });
  });
});

describe('atomic webhook ingestion', () => {
  it('delegates all three writes to one RPC and treats replay as the same queue identity', async () => {
    mockRpc.mockResolvedValue({ data: 'queue-existing', error: null });
    const input = {
      webhookProvider: 'meta', webhookExternalId: 'phone-1:wamid.1', webhookPayload: {},
      messageId: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-1',
      conversationId: 'conversation-1', threadId: 'thread-1', channel: 'whatsapp' as const,
      fromNumber: '+2348031234567', toNumber: '+2348000000000', content: 'hello',
      messageType: 'text', providerMessageId: 'wamid.1',
      providerTimestamp: '2026-09-28T12:00:00.000Z', raw: {}, mediaInfo: null,
    };

    await expect(ingestConversationMessage(input)).resolves.toBe('queue-existing');
    await expect(ingestConversationMessage({
      ...input, messageId: '22222222-2222-4222-8222-222222222222',
    })).resolves.toBe('queue-existing');
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'ingest_conversation_message', expect.objectContaining({
      p_webhook_external_id: 'phone-1:wamid.1', p_message_id: input.messageId,
      p_conversation_id: 'conversation-1', p_thread_id: 'thread-1',
    }));
  });
});
