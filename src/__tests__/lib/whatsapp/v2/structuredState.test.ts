import {
  emptyConversationStructuredState,
  parseConversationStructuredState,
} from '@/lib/whatsapp/v2/structuredState';

const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => ({
  defaultLogger: { warn: (...args: unknown[]) => mockWarn(...args) },
}));

describe('parseConversationStructuredState', () => {
  it('accepts confirmed facts only when they carry explicit provenance', () => {
    expect(parseConversationStructuredState({
      intent: 'book_service',
      confirmed: {
        service: {
          value: 'Knotless braids',
          source: 'customer_explicit',
          sourceId: 'message-1',
          observedAt: '2026-09-28T12:00:00.000Z',
        },
      },
      proposed: { date: '2026-09-30' },
      missing: ['time'],
      nextAction: 'ask_time',
    })).toEqual({
      intent: 'book_service',
      confirmed: {
        service: {
          value: 'Knotless braids',
          source: 'customer_explicit',
          sourceId: 'message-1',
          observedAt: '2026-09-28T12:00:00.000Z',
        },
      },
      proposed: { date: '2026-09-30' },
      missing: ['time'],
      nextAction: 'ask_time',
    });
  });

  it('returns a safe empty state for malformed or unverified database JSON', () => {
    expect(parseConversationStructuredState({
      confirmed: { service: { value: 'Braids' } }, proposed: {}, missing: [],
    })).toEqual(emptyConversationStructuredState());
    expect(parseConversationStructuredState(null)).toEqual(emptyConversationStructuredState());
    expect(mockWarn).toHaveBeenCalledTimes(2);
  });
});
