import type { ConversationStructuredState } from './structuredState';

const REQUIRED_FIELDS: Record<string, string[]> = {
  booking_request: ['service', 'date'],
  create_booking: ['service', 'date'],
  get_availability: ['service', 'date'],
  reschedule_booking: ['reservation_id', 'date'],
  cancel_booking: ['reservation_id'],
  retail_purchase: ['product', 'quantity'],
};

export function requiredFieldsForIntent(intent: string): string[] {
  return [...(REQUIRED_FIELDS[intent] ?? [])];
}

export function nextMissingField(state: ConversationStructuredState): string | null {
  const priority = requiredFieldsForIntent(state.intent ?? '');
  return priority.find((field) => state.missing.includes(field)) ?? state.missing[0] ?? null;
}
