import { runConversationSummaryJob, type ConversationSummaryStore } from '@/lib/whatsapp/v2/conversationSummary';

describe('runConversationSummaryJob', () => {
  it('loads and updates the exact tenant/thread with an optimistic guard', async () => {
    const store: ConversationSummaryStore = {
      loadThread: jest.fn(async () => ({ updatedAt: '2026-09-29T10:00:00Z', summaryThrough: null, rollingSummary: null })),
      loadNewTurns: jest.fn(async () => [
        { direction: 'inbound', content: 'I need a video consultation', at: '2026-09-29T10:01:00Z' },
        { direction: 'outbound', content: 'What date works?', at: '2026-09-29T10:02:00Z' },
      ]),
      updateSummary: jest.fn(async () => true),
    };
    const result = await runConversationSummaryJob({ tenantId: 'tenant-a', threadId: 'thread-a' }, store);
    expect(result.success).toBe(true);
    expect(store.loadNewTurns).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', threadId: 'thread-a' }));
    expect(store.updateSummary).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', threadId: 'thread-a', expectedUpdatedAt: '2026-09-29T10:00:00Z',
      through: '2026-09-29T10:02:00Z',
    }));
  });
});
