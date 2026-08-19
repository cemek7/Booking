/**
 * Layer 1 Rules Engine — Universal Signal Detection
 *
 * Only matches signals that are unambiguously interpretable regardless of
 * business vertical:
 *   1. Pure affirmatives (yes/ok/oya)
 *   2. Pure negatives (no/cancel/abeg no)
 *   3. Numeric list selections (1–9, only when awaiting_selection)
 *   4. Greetings (hi/hello/how far)
 *   5. Help/menu triggers
 *
 * Everything else — service intent, owner commands, time parsing, natural
 * language instructions — is passed to Layer 2 (Gemini Flash-Lite).
 *
 * Also exports normalizePidgin() which pre-processes all messages before
 * both L1 matching and L2 prompt construction.
 */

export type RuleMatch = {
  action: 'affirm' | 'negate' | 'select_option' | 'greet' | 'help';
  confidence: 'high';
  params?: { optionIndex?: number };
};

export interface RuleContext {
  current_flow: string;
  flow_step: number;
  awaiting_selection: boolean;
}

// ─── Pidgin Normalization ─────────────────────────────────────────────────────
// Maps common Nigerian Pidgin English expressions to standard English equivalents.
// Runs before both L1 pattern matching and L2 prompt construction.

const PIDGIN_MAP: [RegExp, string][] = [
  [/\bI wan\b/gi, 'I want to'],
  [/\bmake I\b/gi, 'I want to'],
  [/\bna me\b/gi, 'it is me'],
  [/\babeg\b/gi, 'please'],
  [/\bwetin\b/gi, 'what'],
  [/\buna\b/gi, 'you all'],
  [/\bdey\b/gi, 'is/are'],
  [/\bwey\b/gi, 'that/which'],
  [/\bno be\b/gi, 'is not'],
  [/\bna\b/gi, 'it is'],
  [/\bsabi\b/gi, 'know'],
  [/\bchop\b/gi, 'eat'],
  [/\bsharp sharp\b/gi, 'quickly'],
  [/\bhow far\b/gi, 'hi how are you'],
  [/\be kaaro\b/gi, 'good morning'],
  [/\bekaabo\b/gi, 'welcome'],
  [/\boya\b/gi, 'ok'],
  [/\be correct\b/gi, 'yes that is correct'],
  [/\bno stress\b/gi, 'no problem'],
  [/\bforget am\b/gi, 'forget it'],
  [/\bno vex\b/gi, 'no problem'],
  [/\bfine fine\b/gi, 'very good'],
  [/\benter\b/gi, 'go into'],
  [/\bgist\b/gi, 'talk about'],
];

export function normalizePidgin(message: string): string {
  let normalized = message.trim();
  for (const [pattern, replacement] of PIDGIN_MAP) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

// ─── Pattern groups ───────────────────────────────────────────────────────────

const AFFIRMATIVE_PATTERNS = [
  /^(yes|yeah|yep|yup|sure|ok|okay|correct|alright|fine|go ahead|proceed|confirm|e correct|no stress|no problem|np|👍)$/i,
];

const NEGATIVE_PATTERNS = [
  /^(no|nope|nah|cancel|stop|don't|dont|never|negative|abeg no|forget am|no vex|no thanks|not really|👎)$/i,
];

// Single digits or ordinal words (only valid when a numbered list was shown)
const SELECTION_DIGIT = /^([1-9])$/;
const SELECTION_WORD: Record<string, number> = {
  one: 1, first: 1,
  two: 2, second: 2,
  three: 3, third: 3,
  four: 4, fourth: 4,
  five: 5, fifth: 5,
  six: 6, sixth: 6,
  seven: 7, seventh: 7,
  eight: 8, eighth: 8,
  nine: 9, ninth: 9,
};

const GREETING_PATTERNS = [
  /^(hi|hello|hey|howdy|hiya|good\s?(morning|afternoon|evening|day)|how\s?far|e\s?kaaro|ekaabo|greetings|sup|what'?s up)$/i,
];

const HELP_PATTERNS = [
  /^(help|menu|options|commands|what can you do|how does this work|start over|restart)$/i,
];

// ─── Matcher ──────────────────────────────────────────────────────────────────

export function matchRule(
  rawMessage: string,
  context: RuleContext
): RuleMatch | null {
  const normalized = normalizePidgin(rawMessage);
  const msg = normalized.trim().toLowerCase();

  // Greetings and help are always valid — no flow context required
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(msg)) return { action: 'greet', confidence: 'high' };
  }

  for (const pattern of HELP_PATTERNS) {
    if (pattern.test(msg)) return { action: 'help', confidence: 'high' };
  }

  // Affirmatives and negatives only make sense when the conversation is
  // mid-flow and expecting a yes/no decision from the user
  const flowActive =
    context.current_flow !== 'idle' && context.flow_step > 0;

  if (flowActive) {
    for (const pattern of AFFIRMATIVE_PATTERNS) {
      if (pattern.test(msg)) return { action: 'affirm', confidence: 'high' };
    }

    for (const pattern of NEGATIVE_PATTERNS) {
      if (pattern.test(msg)) return { action: 'negate', confidence: 'high' };
    }
  }

  // Numeric selections only valid when a numbered list was presented
  if (context.awaiting_selection) {
    const digitMatch = msg.match(SELECTION_DIGIT);
    if (digitMatch) {
      return {
        action: 'select_option',
        confidence: 'high',
        params: { optionIndex: parseInt(digitMatch[1], 10) },
      };
    }

    const wordIndex = SELECTION_WORD[msg];
    if (wordIndex !== undefined) {
      return {
        action: 'select_option',
        confidence: 'high',
        params: { optionIndex: wordIndex },
      };
    }
  }

  // No match → escalate to L2
  return null;
}
