import {
  assembleConversationContext,
  assembleConversationContextForMode,
  type ConversationContextStore,
} from '@/lib/ai/conversation-context';

describe('assembleConversationContext', () => {
  it('requests only the exact tenant, customer, and thread with a 12-turn bound', async () => {
    const store: ConversationContextStore = {
      loadThread: jest.fn(async () => ({ structured_state: { confirmed: {}, proposed: {}, missing: [] }, rolling_summary: 'Needs a video consultation.' })),
      loadTurns: jest.fn(async () => [{ direction: 'inbound', content: 'Tomorrow works', timestamp: '2026-09-29T10:00:00Z' }]),
      loadFacts: jest.fn(async () => [{ fact_key: 'preferred_service', fact_value: 'Consultation', source_type: 'explicit_message', verified_at: '2026-09-20T10:00:00Z' }]),
    };
    const result = await assembleConversationContext({ tenantId: 'tenant-a', threadId: 'thread-a', customerId: 'customer-a' }, store);
    expect(store.loadThread).toHaveBeenCalledWith({ tenantId: 'tenant-a', threadId: 'thread-a', customerId: 'customer-a' });
    expect(store.loadTurns).toHaveBeenCalledWith({ tenantId: 'tenant-a', threadId: 'thread-a', limit: 12 });
    expect(store.loadFacts).toHaveBeenCalledWith({ tenantId: 'tenant-a', customerId: 'customer-a', limit: 20 });
    expect(result.recentTurns).toHaveLength(1);
    expect(result.rollingSummary).toContain('video consultation');
  });

  it('caps caller-supplied turn limits at 12', async () => {
    const store: ConversationContextStore = {
      loadThread: jest.fn(async () => ({ structured_state: { confirmed: {}, proposed: {}, missing: [] }, rolling_summary: null })),
      loadTurns: jest.fn(async () => []), loadFacts: jest.fn(async () => []),
    };
    await assembleConversationContext({ tenantId: 't', threadId: 'x', customerId: 'c', recentTurnLimit: 999 }, store);
    expect(store.loadTurns).toHaveBeenCalledWith({ tenantId: 't', threadId: 'x', limit: 12 });
  });

  it('keeps shadow mode non-blocking when context storage is unavailable', async () => {
    const store: ConversationContextStore = {
      loadThread: jest.fn(async () => { throw new Error('context store unavailable'); }),
      loadTurns: jest.fn(async () => []),
      loadFacts: jest.fn(async () => []),
    };
    const input = { tenantId: 't', threadId: 'x', customerId: 'c' };

    await expect(assembleConversationContextForMode({ ...input, mode: 'shadow' }, store))
      .resolves.toBeNull();
    await expect(assembleConversationContextForMode({ ...input, mode: 'live' }, store))
      .rejects.toThrow('context store unavailable');
  });
});
