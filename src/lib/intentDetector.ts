import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { recordLLMUsage, canMakeLLMRequest } from '@/lib/llmUsageTracker';
import { callOpenRouter } from '@/lib/openrouter';
import { isGoogleAIConfigured, getGoogleAIModel } from '@/lib/google-ai';
import { estimatePromptTokens, withTenantWalletSpend } from './billing/ai-wallet';

export type IntentType = 'booking' | 'reschedule' | 'cancel' | 'inquiry' | 'business_info' | 'product_inquiry' | 'payment' | 'status' | 'unknown';

export type ExtractedEntity = {
  type: 'time' | 'date' | 'service' | 'staff' | 'phone' | 'email' | 'name';
  value: string;
  confidence: number;
  position?: { start: number; end: number };
};

export type Intent = {
  intent: IntentType;
  confidence: number;
  entities: ExtractedEntity[];
  context?: {
    hasTimeReference: boolean;
    hasServiceMention: boolean;
    hasStaffPreference: boolean;
    isUrgent: boolean;
    sentiment: 'positive' | 'neutral' | 'negative';
  };
  fallbackUsed: boolean;
};

export type ContextualHints = {
  previousIntent?: IntentType;
  conversationTurn: number;
  tenantVertical?: 'beauty' | 'hospitality' | 'medicine';
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  services?: Array<{ name: string }>;
};

type ContextAnalysis = {
  hasTimeReference: boolean;
  hasServiceMention: boolean;
  hasStaffPreference: boolean;
  isUrgent: boolean;
  sentiment: 'positive' | 'neutral' | 'negative';
};

/**
 * Enhanced intent detector with confidence scoring, entity extraction, and context awareness.
 * Uses OpenRouter for complex cases, falls back to improved heuristics.
 * Includes LLM usage tracking for cost management.
 */
export async function detectIntent(
  text: string, 
  context?: ContextualHints,
  tenantId?: string,
  userId?: string
): Promise<Intent> {
  const t = (text || '').trim();
  
  // Extract entities first for context
  const entities = extractEntities(t, context);
  const contextInfo = analyzeContext(t, entities, context);

  // Check LLM quota before making request
  const canUseLLM = tenantId ? await canMakeLLMRequest(tenantId, 150) : true;

  if (tenantId && !canUseLLM) {
    defaultLogger.warn('intentDetector: LLM quota exceeded or disabled, falling back to heuristics', { tenantId });
  }

  const hasLLMProvider = isGoogleAIConfigured() || !!process.env.OPENROUTER_API_KEY;
  if (hasLLMProvider && canUseLLM) {
    try {
      const supabase = createSupabaseAdminClient();
      // Enhanced system prompt for better classification
      const servicesHint = context?.services?.length
        ? `\nKnown services for this business: ${context.services.map((s) => s.name).join(', ')}.`
        : '';
      const system = `You are an advanced booking intent classifier. Analyze the message and return JSON with:
- intent: booking|reschedule|cancel|inquiry|business_info|product_inquiry|payment|status|unknown
  - booking: user wants to make an appointment
  - reschedule: user wants to change existing booking
  - cancel: user wants to cancel a booking
  - inquiry: general questions about services, pricing, hours
  - business_info: user asks about the business itself (location, hours, contact, about us)
  - product_inquiry: user asks about products, items for sale, inventory, prices of goods
  - payment: user wants to pay for a booking, asks about payment, or mentions payment link
  - status: user asks about their booking status, booking details, or "where is my booking"
- confidence: 0-1 number (be conservative, use context)
- entities: array of {type, value, confidence} objects for time, date, service, staff, phone, email, name
- context: {hasTimeReference, hasServiceMention, hasStaffPreference, isUrgent, sentiment}
Only return valid JSON.${servicesHint}`;
      
      const contextPrompt = context ? `\nContext: ${context.tenantVertical || 'general'} business, conversation turn ${context.conversationTurn || 1}, ${context.timeOfDay || 'unknown'} time` : '';
      const user = `Message: "${t.replace(/\"/g, '\\"')}"${contextPrompt}`;

      const activeModel = isGoogleAIConfigured() ? getGoogleAIModel() : 'free-model';
      const activeProvider = isGoogleAIConfigured() ? 'google_ai' as const : 'openrouter' as const;
      const { json: j } = await withTenantWalletSpend(
        supabase,
        tenantId ?? null,
        {
          estimatedTokens: estimatePromptTokens(system.length + user.length),
          provider: activeProvider,
          model: activeModel,
          requestId: `intent:${tenantId ?? 'anonymous'}:${Date.now()}`,
          description: 'Intent detection',
          metadata: {
            operation: 'intent_detection',
            text_length: t.length,
            entities_found: entities.length,
            context_provided: !!context,
          },
        },
        () => callOpenRouter(
          [{ role: 'system', content: system }, { role: 'user', content: user }],
          undefined,
          1
        )
      );
      // Attempt to find assistant message
      const assistant = j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || null;

      // Track LLM usage
      if (tenantId && userId) {
        const usage = j?.usage;
        const inputTokens = usage?.prompt_tokens || 100;
        const outputTokens = usage?.completion_tokens || 50;
        const costUsd = 0; // Free model — no cost

        try {
          await recordLLMUsage(
            tenantId,
            userId,
            activeProvider,
            activeModel,
            'intent_detection',
            inputTokens,
            outputTokens,
            costUsd,
            {
              text_length: t.length,
              entities_found: entities.length,
              context_provided: !!context
            }
          );
        } catch (trackingError) {
          defaultLogger.warn('Failed to track LLM usage:', trackingError);
        }
      }

      if (assistant) {
        // Extract JSON from the response (robustly)
        const m = assistant.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            const intent = parsed.intent || 'unknown';
            const confidence = Math.min(Number(parsed.confidence) || 0.5, 0.95); // Cap LLM confidence
            const entities = Array.isArray(parsed.entities) ? parsed.entities : extractEntities(t, context);
            const contextData = parsed.context || contextInfo;

            return {
              intent,
              confidence,
              entities,
              context: contextData,
              fallbackUsed: false
            } as Intent;
          } catch (e) {
            defaultLogger.warn('LLM JSON parse failed', e);
            // fall through to heuristics
          }
        }
      }
    } catch (err) {
      defaultLogger.warn('OpenRouter intent detection failed', err);
    }
  }

  // Enhanced fallback heuristics with dynamic confidence
  return enhancedHeuristics(t, entities, contextInfo, context);
}

/**
 * Extract entities from text using pattern matching
 */
function extractEntities(text: string, hints?: ContextualHints): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const low = text.toLowerCase();
  
  // Time patterns
  const timeMatches = text.match(/\b(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?\b/g);
  if (timeMatches) {
    timeMatches.forEach(match => {
      entities.push({
        type: 'time',
        value: match.trim(),
        confidence: 0.8
      });
    });
  }
  
  // Date patterns
  const dateMatches = text.match(/\b(\d{1,2}[\\/\\-]\d{1,2}[\\/\\-]\d{2,4}|tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi);
  if (dateMatches) {
    dateMatches.forEach(match => {
      entities.push({
        type: 'date',
        value: match.trim(),
        confidence: 0.7
      });
    });
  }
  
  // Phone patterns
  const phoneMatches = text.match(/\b(\+?[\d\s\-\(\)]{10,})\b/g);
  if (phoneMatches) {
    phoneMatches.forEach(match => {
      if (match.replace(/[^\d]/g, '').length >= 10) {
        entities.push({
          type: 'phone',
          value: match.trim(),
          confidence: 0.9
        });
      }
    });
  }
  
  // Email patterns
  const emailMatches = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g);
  if (emailMatches) {
    emailMatches.forEach(match => {
      entities.push({
        type: 'email',
        value: match.trim(),
        confidence: 0.95
      });
    });
  }
  
  // Service patterns — dynamic from hints + fallback generic terms
  const dynamicServiceNames = hints?.services?.map((s) =>
    s.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  ).filter(Boolean) ?? [];

  const allServiceTerms = [
    ...dynamicServiceNames,
    'haircut', 'massage', 'facial', 'manicure', 'pedicure',
    'consultation', 'check-up', 'check up',
  ];

  // Escape regex metacharacters in service names before building the pattern
  function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const servicePattern = new RegExp(
    `\\b(${allServiceTerms.map((t) => escapeRegex(t).replace(/\s+/g, '\\s+')).join('|')})\\b`, 'gi'
  );
  const serviceMatches = text.match(servicePattern);
  if (serviceMatches) {
    serviceMatches.forEach(match => {
      entities.push({
        type: 'service',
        value: match.trim(),
        confidence: dynamicServiceNames.some((n) => n === match.toLowerCase().trim()) ? 0.85 : 0.6
      });
    });
  }
  
  return entities;
}

/**
 * Analyze context from text and entities
 */
function analyzeContext(text: string, entities: ExtractedEntity[], hints?: ContextualHints): ContextAnalysis {
  const low = text.toLowerCase();
  
  return {
    hasTimeReference: entities.some(e => e.type === 'time' || e.type === 'date'),
    hasServiceMention: entities.some(e => e.type === 'service'),
    hasStaffPreference: /\b(with|by|prefer|request|ask for|see)\s+[A-Z][a-z]+\b/.test(text),
    isUrgent: /\b(urgent|asap|emergency|now|today|immediately)\b/i.test(text),
    sentiment: detectSentiment(low)
  };
}

/**
 * Simple sentiment detection
 */
function detectSentiment(text: string): 'positive' | 'neutral' | 'negative' {
  const positive = /\b(great|good|excellent|love|like|happy|pleased|satisfied)\b/i;
  const negative = /\b(bad|terrible|awful|hate|angry|frustrated|disappointed|cancel|problem)\b/i;
  
  if (positive.test(text)) return 'positive';
  if (negative.test(text)) return 'negative';
  return 'neutral';
}

/**
 * Enhanced heuristics with confidence scoring
 */
function enhancedHeuristics(
  text: string, 
  entities: ExtractedEntity[], 
  contextInfo: ContextAnalysis, 
  hints?: ContextualHints
): Intent {
  const low = text.toLowerCase();
  let baseConfidence = 0.4;
  
  // Booking intent detection
  if (/\b(book|appointment|schedule|reserve|set up|make|need|want)\b/.test(low)) {
    let confidence = 0.7;
    
    // Boost confidence with supporting evidence
    if (contextInfo.hasTimeReference) confidence += 0.15;
    if (contextInfo.hasServiceMention) confidence += 0.1;
    if (entities.length >= 2) confidence += 0.05;
    if (hints?.tenantVertical) confidence += 0.05;
    
    return {
      intent: 'booking',
      confidence: Math.min(confidence, 0.9),
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }
  
  // Reschedule intent
  if (/\b(resched|reschedule|move|change|shift|different time)\b/.test(low)) {
    let confidence = 0.75;
    if (contextInfo.hasTimeReference) confidence += 0.1;
    
    return {
      intent: 'reschedule',
      confidence: Math.min(confidence, 0.85),
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }
  
  // Cancel intent  
  if (/\b(cancel|cancellation|won't make|can't make|not coming|don't come)\b/.test(low)) {
    let confidence = 0.85;
    if (contextInfo.sentiment === 'negative') confidence += 0.05;
    
    return {
      intent: 'cancel',
      confidence: Math.min(confidence, 0.9),
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }
  
  // Business info intent - questions about the business itself
  if (/\b(where are you|location|address|contact|phone number|email|hours of operation|opening hours|closing|when do you open|when do you close|about you|about the|who are you|tell me about|business hours|working hours)\b/.test(low)) {
    return {
      intent: 'business_info',
      confidence: 0.75,
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }

  // Product inquiry intent - questions about products/items
  if (/\b(product|products|item|items|sell|selling|buy|purchase|stock|inventory|what do you have|what products|catalog|catalogue|menu|price list|merchandise|goods|retail)\b/.test(low)) {
    return {
      intent: 'product_inquiry',
      confidence: 0.75,
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }

  // Payment intent
  if (/\b(pay|payment|pay for|how to pay|payment link|i want to pay|need to pay|paying|paid)\b/.test(low)) {
    return {
      intent: 'payment',
      confidence: 0.8,
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }
  
  // Status intent - check booking status
  if (/\b(status|my booking|my appointment|booking details|where is my|check my|find my|show my|booking info|appointment info)\b/.test(low)) {
    return {
      intent: 'status',
      confidence: 0.8,
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }

  // General inquiry intent - service and pricing questions
  if (/\b(price|cost|how much|available|info|question|services|offer)\b/.test(low)) {
    return {
      intent: 'inquiry',
      confidence: 0.65,
      entities,
      context: contextInfo,
      fallbackUsed: true
    };
  }

  // Adjust unknown confidence based on context
  if (entities.length > 0) baseConfidence += 0.1;
  if (contextInfo.hasTimeReference || contextInfo.hasServiceMention) baseConfidence += 0.05;
  
  return {
    intent: 'unknown',
    confidence: baseConfidence,
    entities,
    context: contextInfo,
    fallbackUsed: true
  };
}

export default detectIntent;
