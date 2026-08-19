/**
 * Simple PII redaction and truncation utilities used before sending context to LLMs.
 * Keep these conservative and deterministic.
 */

export function redactAndTruncate(input: string | null | undefined, maxLen = 1000): string {
  if (!input) return '';
  let out = String(input);
  // redact emails
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  // redact credit card numbers (Visa/MC/AmEx: 13-16 digit groups with optional spaces/dashes)
  out = out.replace(/\b(?:\d[ -]?){13,15}\d\b/g, '[REDACTED_CARD]');
  // redact US SSN (XXX-XX-XXXX)
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
  // redact phone numbers: tighter pattern with word boundaries to avoid false positives on ZIP/IDs
  out = out.replace(/(?<!\d)\+?(\d[\s.-]?){9,14}\d(?!\d)/g, '[REDACTED_PHONE]');
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
