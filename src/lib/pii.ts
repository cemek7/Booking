/**
 * Simple PII redaction and truncation utilities used before sending context to LLMs.
 * Keep these conservative and deterministic.
 */

export function redactAndTruncate(input: string | null | undefined, maxLen = 1000): string {
  if (!input) return '';
  let out = String(input);
  // redact emails
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  // redact simple phone numbers (digits with optional + and separators)
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]');
  // collapse long whitespace
  out = out.replace(/\s{2,}/g, ' ').trim();
  if (out.length > maxLen) {
    return out.slice(0, maxLen) + '...';
  }
  return out;
}

export function redactPII(text: string | null | undefined): string {
  return redactAndTruncate(text, 1000);
}

export function sanitizeMessages(messages: Array<{ id?: unknown; content?: string | null }>) {
  return messages.map((m) => ({ id: m.id ? String(m.id) : undefined, content: redactAndTruncate(m.content ?? '', 1000) }));
}
