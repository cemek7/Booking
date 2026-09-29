import { nextMissingField, requiredFieldsForIntent } from './missingFields';
import type { ConversationStructuredState, VerifiedValue } from './structuredState';

const ALLOWED_FIELDS = new Set([
  'service', 'service_id', 'date', 'start_time', 'end_time', 'staff', 'staff_id',
  'contact_name', 'contact_phone', 'contact_email', 'modality', 'location',
  'desired_outcome', 'product', 'product_id', 'quantity', 'reservation_id',
  'booking_status', 'slot_start', 'slot_end',
]);
const ALLOWED_PATCH_KEYS = new Set(['intent', 'confirmed', 'proposed', 'corrections']);
const ALLOWED_INTENTS = new Set([
  'booking_request', 'create_booking', 'get_availability', 'cancel_booking',
  'reschedule_booking', 'retail_purchase',
]);

export interface ProposedStatePatch {
  intent?: string;
  confirmed?: Record<string, unknown>;
  proposed?: Record<string, unknown>;
  corrections?: Record<string, unknown>;
}

export interface AuthoritativeOperationResult {
  success: boolean;
  reservation?: { id: string; startAt: string; endAt: string; status: string };
}

function assertAllowed(fields: Record<string, unknown> | undefined): void {
  for (const field of Object.keys(fields ?? {})) {
    if (!ALLOWED_FIELDS.has(field)) throw new Error(`Unsupported conversation state field: ${field}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseProposedStatePatch(value: unknown): ProposedStatePatch {
  if (!isRecord(value)) throw new Error('Conversation state patch must be an object');
  for (const key of Object.keys(value)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) throw new Error(`Unsupported conversation state patch key: ${key}`);
  }
  if (value.intent !== undefined && (typeof value.intent !== 'string' || !ALLOWED_INTENTS.has(value.intent))) {
    throw new Error('Unsupported conversation state intent');
  }
  const patch: ProposedStatePatch = {};
  if (typeof value.intent === 'string') patch.intent = value.intent;
  for (const key of ['confirmed', 'proposed', 'corrections'] as const) {
    const fields = value[key];
    if (fields === undefined) continue;
    if (!isRecord(fields)) throw new Error(`Conversation state ${key} must be an object`);
    assertAllowed(fields);
    for (const fieldValue of Object.values(fields)) {
      if (!['string', 'number', 'boolean'].includes(typeof fieldValue)) {
        throw new Error(`Conversation state ${key} values must be scalar`);
      }
      if (typeof fieldValue === 'string' && fieldValue.length > 500) {
        throw new Error(`Conversation state ${key} value is too long`);
      }
    }
    patch[key] = fields;
  }
  return patch;
}

export function reduceConversationState(input: {
  previous: ConversationStructuredState;
  extracted: ProposedStatePatch;
  sourceMessageId: string;
  operationResult?: AuthoritativeOperationResult;
  observedAt: string;
}): ConversationStructuredState {
  assertAllowed(input.extracted.confirmed);
  assertAllowed(input.extracted.proposed);
  assertAllowed(input.extracted.corrections);

  const intent = input.extracted.intent ?? input.previous.intent;
  const confirmed = { ...input.previous.confirmed };
  const proposed = { ...input.previous.proposed, ...(input.extracted.proposed ?? {}) };
  const verify = (fields: Record<string, unknown> | undefined, source: VerifiedValue['source']) => {
    for (const [field, value] of Object.entries(fields ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      confirmed[field] = { value, source, sourceId: input.sourceMessageId, observedAt: input.observedAt };
      delete proposed[field];
    }
  };
  verify(input.extracted.confirmed, 'customer_explicit');
  verify(input.extracted.corrections, 'customer_explicit');

  if (input.operationResult?.success && input.operationResult.reservation) {
    const reservation = input.operationResult.reservation;
    verify({
      reservation_id: reservation.id,
      slot_start: reservation.startAt,
      slot_end: reservation.endAt,
      booking_status: reservation.status,
    }, 'transaction');
  }

  const satisfies = (field: string) => {
    if (field === 'service') return Boolean(confirmed.service || confirmed.service_id);
    if (field === 'date') return Boolean(confirmed.date || confirmed.slot_start);
    if (field === 'product') return Boolean(confirmed.product || confirmed.product_id);
    return Boolean(confirmed[field]);
  };
  const missing = requiredFieldsForIntent(intent ?? '').filter((field) => !satisfies(field));
  const state: ConversationStructuredState = { ...(intent ? { intent } : {}), confirmed, proposed, missing };
  const next = nextMissingField(state);
  return { ...state, ...(next ? { nextAction: `ask:${next}` } : {}) };
}
