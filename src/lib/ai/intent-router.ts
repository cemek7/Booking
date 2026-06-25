import { detectIntent, type ContextualHints } from '@/lib/intentDetector';

export type FrontDeskIntent =
  | 'booking_request'
  | 'reschedule_booking'
  | 'cancel_booking'
  | 'availability_question'
  | 'price_question'
  | 'owner_query'
  | 'customer_support'
  | 'unknown';

export interface IntentRoute {
  intent: FrontDeskIntent;
  confidence: 'high' | 'medium' | 'low';
  source: 'rules' | 'llm_fallback';
}

export async function routeIntent(
  message: string,
  options: {
    tenantId?: string;
    userRole?: 'owner' | 'customer';
    contextHints?: ContextualHints;
  } = {}
): Promise<IntentRoute> {
  const normalized = message.trim().toLowerCase();
  const ruleMatch = matchRuleIntent(normalized, options.userRole ?? 'customer');

  if (ruleMatch) {
    return {
      intent: ruleMatch,
      confidence: 'high',
      source: 'rules',
    };
  }

  const detected = await detectIntent(
    message,
    options.contextHints,
    options.tenantId
  );

  return {
    intent: mapDetectedIntent(detected.intent, options.userRole ?? 'customer'),
    confidence: normalizeConfidence(detected.confidence),
    source: 'llm_fallback',
  };
}

function matchRuleIntent(
  normalized: string,
  userRole: 'owner' | 'customer'
): FrontDeskIntent | null {
  if (userRole === 'owner') {
    if (/\b(who booked|today.?s bookings|appointments today|schedule today|revenue|sales|summary|insight)\b/i.test(normalized)) {
      return 'owner_query';
    }
  }

  if (/\b(cancel|call off|remove)\b/i.test(normalized) && /\b(booking|appointment|reservation)\b/i.test(normalized)) {
    return 'cancel_booking';
  }

  if (/\b(reschedule|move|change)\b/i.test(normalized) && /\b(booking|appointment|reservation|time|date)\b/i.test(normalized)) {
    return 'reschedule_booking';
  }

  if (/\b(price|cost|fee|how much)\b/i.test(normalized)) {
    return 'price_question';
  }

  if (/\b(available|availability|free slot|what time|open tomorrow|tomorrow available)\b/i.test(normalized)) {
    return 'availability_question';
  }

  if (/\b(book|booking|appointment|reserve|braid my hair|schedule me)\b/i.test(normalized)) {
    return 'booking_request';
  }

  if (/\b(help|support|human|agent|problem|issue)\b/i.test(normalized)) {
    return 'customer_support';
  }

  return null;
}

function mapDetectedIntent(
  intent: string,
  userRole: 'owner' | 'customer'
): FrontDeskIntent {
  switch (intent) {
    case 'booking':
      return 'booking_request';
    case 'reschedule':
      return 'reschedule_booking';
    case 'cancel':
      return 'cancel_booking';
    case 'status':
    case 'inquiry':
      return userRole === 'owner' ? 'owner_query' : 'availability_question';
    case 'business_info':
      return userRole === 'owner' ? 'owner_query' : 'customer_support';
    default:
      return 'unknown';
  }
}

function normalizeConfidence(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.55) return 'medium';
  return 'low';
}
