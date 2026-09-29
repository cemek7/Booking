import { EnhancedJobManager } from '@/lib/enhancedJobManager';

describe('EnhancedJobManager conversation summaries', () => {
  it('registers the summarize_conversation_thread handler', () => {
    const manager = new EnhancedJobManager({} as never);
    const handlers = (manager as unknown as { handlers: Map<string, unknown> }).handlers;
    expect(handlers.has('summarize_conversation_thread')).toBe(true);
  });
});
