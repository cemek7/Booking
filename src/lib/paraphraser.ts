/**
 * Paraphraser stub: lightweight heuristic rewriting (synonym swap) to mimic small model output.
 * Replace with local small LLM later. Deterministic & cheap.
 */

const SYN_MAP: Record<string, string> = {
  appointment: 'booking',
  schedule: 'set up',
  cancel: 'call off',
  confirm: 'verify'
};

export function paraphrase(input: string): string {
  if (!input) return '';
  let out = input;
  for (const [k, v] of Object.entries(SYN_MAP)) {
    const re = new RegExp(`\\b${k}\\b`, 'gi');
    out = out.replace(re, v);
  }
  // Mild shortening
  if (out.length > 240) out = out.slice(0, 240) + '…';
  return out;
}

export default { paraphrase };
