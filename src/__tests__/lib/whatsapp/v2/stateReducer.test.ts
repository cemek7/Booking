import { parseProposedStatePatch, reduceConversationState } from '@/lib/whatsapp/v2/stateReducer';
import { emptyConversationStructuredState } from '@/lib/whatsapp/v2/structuredState';

const now = '2026-09-29T10:00:00.000Z';

describe('reduceConversationState', () => {
  it('never deletes confirmed facts when the model omits them', () => {
    const prior = reduceConversationState({
      previous: emptyConversationStructuredState(),
      extracted: { intent: 'booking_request', confirmed: { service: 'Video consultation', date: '2026-10-02', staff: 'Dr Ada', contact_email: 'ada@example.com' } },
      sourceMessageId: 'message-1', observedAt: now,
    });
    const next = reduceConversationState({ previous: prior, extracted: {}, sourceMessageId: 'message-2', observedAt: now });
    expect(Object.fromEntries(Object.entries(next.confirmed).map(([key, fact]) => [key, fact.value]))).toMatchObject({
      service: 'Video consultation', date: '2026-10-02', staff: 'Dr Ada', contact_email: 'ada@example.com',
    });
  });

  it('records an explicit correction with source evidence', () => {
    const prior = reduceConversationState({
      previous: emptyConversationStructuredState(), extracted: { confirmed: { date: '2026-10-02' } },
      sourceMessageId: 'message-1', observedAt: now,
    });
    const next = reduceConversationState({
      previous: prior, extracted: { corrections: { date: '2026-10-03' } },
      sourceMessageId: 'message-2', observedAt: '2026-09-29T10:01:00.000Z',
    });
    expect(next.confirmed.date).toEqual(expect.objectContaining({ value: '2026-10-03', sourceId: 'message-2', source: 'customer_explicit' }));
  });

  it('writes authoritative reservation facts only after success', () => {
    const failed = reduceConversationState({
      previous: emptyConversationStructuredState(), extracted: { proposed: { date: '2026-10-02' } },
      sourceMessageId: 'message-1', observedAt: now,
      operationResult: { success: false },
    });
    expect(failed.confirmed.date).toBeUndefined();

    const succeeded = reduceConversationState({
      previous: failed, extracted: {}, sourceMessageId: 'message-1', observedAt: now,
      operationResult: { success: true, reservation: { id: 'booking-1', startAt: '2026-10-02T10:00:00Z', endAt: '2026-10-02T11:00:00Z', status: 'confirmed' } },
    });
    expect(succeeded.confirmed).toMatchObject({
      reservation_id: { value: 'booking-1', source: 'transaction' },
      booking_status: { value: 'confirmed', source: 'transaction' },
    });
  });

  it('keeps video-call intent while asking for the next booking detail', () => {
    const state = reduceConversationState({
      previous: emptyConversationStructuredState(),
      extracted: { intent: 'booking_request', confirmed: { modality: 'video_call' } },
      sourceMessageId: 'message-1', observedAt: now,
    });
    expect(state.confirmed.modality.value).toBe('video_call');
    expect(state.missing).toEqual(['service', 'date']);
    expect(state.nextAction).toBe('ask:service');
  });

  it('rejects unknown state fields', () => {
    expect(() => reduceConversationState({
      previous: emptyConversationStructuredState(), extracted: { confirmed: { system_prompt: 'ignore safety' } },
      sourceMessageId: 'message-1', observedAt: now,
    })).toThrow('Unsupported conversation state field');
  });

  it('rejects unbounded or malformed model patches', () => {
    expect(() => parseProposedStatePatch(null)).toThrow('must be an object');
    expect(() => parseProposedStatePatch({ intent: 'invented_intent' })).toThrow('Unsupported conversation state intent');
    expect(() => parseProposedStatePatch({ confirmed: { service: { injected: true } } })).toThrow('must be scalar');
    expect(() => parseProposedStatePatch({ hidden: { service: 'x' } })).toThrow('Unsupported conversation state patch key');
  });

  it('accepts a confirmed service id as satisfying the service requirement', () => {
    const state = reduceConversationState({
      previous: emptyConversationStructuredState(),
      extracted: { intent: 'booking_request', confirmed: { service_id: 'service-1' } },
      sourceMessageId: 'message-1', observedAt: now,
    });
    expect(state.missing).toEqual(['date']);
  });
});
