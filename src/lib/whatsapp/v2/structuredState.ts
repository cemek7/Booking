import { defaultLogger } from '@/lib/logger';

export type VerifiedValue<T = unknown> = {
  value: T;
  source: 'customer_explicit' | 'transaction' | 'operator';
  sourceId: string;
  observedAt: string;
};

export type ConversationStructuredState = {
  intent?: string;
  confirmed: Record<string, VerifiedValue>;
  proposed: Record<string, unknown>;
  missing: string[];
  nextAction?: string;
};

export function emptyConversationStructuredState(): ConversationStructuredState {
  return { confirmed: {}, proposed: {}, missing: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isVerifiedValue(value: unknown): value is VerifiedValue {
  if (!isRecord(value)) return false;
  return (
    'value' in value
    && ['customer_explicit', 'transaction', 'operator'].includes(String(value.source))
    && typeof value.sourceId === 'string'
    && value.sourceId.length > 0
    && typeof value.observedAt === 'string'
    && !Number.isNaN(Date.parse(value.observedAt))
  );
}

export function parseConversationStructuredState(value: unknown): ConversationStructuredState {
  if (!isRecord(value) || !isRecord(value.confirmed) || !isRecord(value.proposed)
      || !Array.isArray(value.missing) || !value.missing.every((item) => typeof item === 'string')) {
    defaultLogger.warn('[structuredState] rejected malformed conversation state');
    return emptyConversationStructuredState();
  }

  if (!Object.values(value.confirmed).every(isVerifiedValue)) {
    defaultLogger.warn('[structuredState] rejected unverified confirmed state');
    return emptyConversationStructuredState();
  }
  if (value.intent !== undefined && typeof value.intent !== 'string') {
    defaultLogger.warn('[structuredState] rejected malformed intent');
    return emptyConversationStructuredState();
  }
  if (value.nextAction !== undefined && typeof value.nextAction !== 'string') {
    defaultLogger.warn('[structuredState] rejected malformed next action');
    return emptyConversationStructuredState();
  }

  return {
    ...(typeof value.intent === 'string' ? { intent: value.intent } : {}),
    confirmed: value.confirmed as Record<string, VerifiedValue>,
    proposed: value.proposed,
    missing: value.missing as string[],
    ...(typeof value.nextAction === 'string' ? { nextAction: value.nextAction } : {}),
  };
}
