// src/lib/whatsapp/v2/optOut.ts
/**
 * Minimal opt-out detection. Matches ONLY when the whole trimmed message is a
 * keyword, so "stop by at 5" and "can I start" are not treated as opt-out.
 */
export type OptOutSignal = 'stop' | 'start' | null;

const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'STOPP']);
const START_WORDS = new Set(['START', 'RESUME', 'UNSTOP']);

export function detectOptOutKeyword(text: string): OptOutSignal {
  const word = text.trim().toUpperCase();
  if (STOP_WORDS.has(word)) return 'stop';
  if (START_WORDS.has(word)) return 'start';
  return null;
}

export function isOptedOut(conv: { opted_out_at: string | null }): boolean {
  return conv.opted_out_at != null;
}
