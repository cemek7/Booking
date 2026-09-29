import { nextMissingField, requiredFieldsForIntent } from '@/lib/whatsapp/v2/missingFields';
import { emptyConversationStructuredState } from '@/lib/whatsapp/v2/structuredState';

describe('missing-field policy', () => {
  it('uses cross-vertical booking requirements in priority order', () => {
    expect(requiredFieldsForIntent('booking_request')).toEqual(['service', 'date']);
    expect(requiredFieldsForIntent('cancel_booking')).toEqual(['reservation_id']);
  });

  it('returns only the highest-priority missing field', () => {
    const state = { ...emptyConversationStructuredState(), intent: 'booking_request', missing: ['service', 'date'] };
    expect(nextMissingField(state)).toBe('service');
  });
});
