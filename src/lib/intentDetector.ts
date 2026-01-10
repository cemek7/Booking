import { recordLLMUsage, canMakeLLMRequest } from '@/lib/llmUsageTracker';

export type IntentType = 'booking' | 'reschedule' | 'cancel' | 'inquiry' | 'unknown';

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
  const entities = extractEntities(t);
  const contextInfo = analyzeContext(t, entities, context);

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const base = process.env.OPENROUTER_BASE_URL || 'https://api.openrouter.ai';

  // Check LLM quota before making request
  const canUseLLM = tenantId ? await canMakeLLMRequest(tenantId, 150) : true;

  if (openrouterKey && canUseLLM) {
    try {
      // Enhanced system prompt for better classification
      const system = `You are an advanced booking intent classifier. Analyze the message and return JSON with:
- intent: booking|reschedule|cancel|inquiry|unknown
- confidence: 0-1 number (be conservative, use context)
- entities: array of {type, value, confidence} objects for time, date, service, staff, phone, email, name
- context: {hasTimeReference, hasServiceMention, hasStaffPreference, isUrgent, sentiment}
Only return valid JSON.`;
      
      const contextPrompt = context ? `\nContext: ${context.tenantVertical || 'general'} business, conversation turn ${context.conversationTurn || 1}, ${context.timeOfDay || 'unknown'} time` : '';
      const user = `Message: "${t.replace(/\"/g, '\\"')}"${contextPrompt}`;

      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openrouterKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          max_tokens: 200,
          temperature: 0.0
        })
      });

      if (resp.ok) {
        const j = await resp.json();
        // Attempt to find assistant message
        const assistant = j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || null;
        
        // Track LLM usage
        if (tenantId && userId) {
          const usage = j?.usage;
          const inputTokens = usage?.prompt_tokens || 100; // Estimate if not provided
          const outputTokens = usage?.completion_tokens || 50;
          const totalTokens = usage?.total_tokens || inputTokens + outputTokens;
          const costUsd = (totalTokens * 0.0001); // Rough estimate for gpt-4o-mini
          
          try {
            await recordLLMUsage(
              tenantId,
              userId,
              'openrouter',
              'gpt-4o-mini',
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
            console.warn('Failed to track LLM usage:', trackingError);
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
              const entities = Array.isArray(parsed.entities) ? parsed.entities : extractEntities(t);
              const contextData = parsed.context || contextInfo;
              
              return { 
                intent, 
                confidence, 
                entities,
                context: contextData,
                fallbackUsed: false 
              } as Intent;
            } catch (e) {
              console.warn('OpenRouter JSON parse failed', e);
              // fall through to heuristics
            }
          }
        }
      } else {
        console.warn('OpenRouter responded with status', resp.status);
      }
    } catch (err) {
      console.warn('OpenRouter intent detection failed', err);
    }
  }

  // Enhanced fallback heuristics with dynamic confidence
  return enhancedHeuristics(t, entities, contextInfo, context);
}

/**
 * Extract entities from text using pattern matching
 */
function extractEntities(text: string): ExtractedEntity[] {
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
  
  // Service patterns (basic)
  const serviceKeywords = /\b(haircut|massage|facial|manicure|pedicure|consultation|check[-\s]?up|appointment|booking|reservation)\b/gi;
  const serviceMatches = text.match(serviceKeywords);
  if (serviceMatches) {
    serviceMatches.forEach(match => {
      entities.push({
        type: 'service',
        value: match.trim(),
        confidence: 0.6
      });
    });
  }
  
  return entities;
}

/**
 * Analyze context from text and entities
 */
function analyzeContext(text: string, entities: ExtractedEntity[], hints?: ContextualHints): any {
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
  contextInfo: any, 
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
  
  // Inquiry intent
  if (/\b(price|cost|how much|hours|open|available|info|question)\b/.test(low)) {
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
