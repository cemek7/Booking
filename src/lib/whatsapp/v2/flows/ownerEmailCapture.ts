import { createHash, randomInt, timingSafeEqual } from 'crypto';

/**
 * Email capture for WhatsApp-native owner onboarding.
 *
 * Owners onboarded over WhatsApp have historically had no email at all — the
 * flow created their `tenant_users` row with `user_id` and `email` both NULL.
 * That left them unreachable by every email-based alert, including the
 * low-balance warning that exists to tell them their message wallet is running
 * out before their bot goes quiet.
 *
 * The address is verified rather than merely collected: a typo'd address is
 * worse than no address, because it reads as reachable and silently is not.
 * The code goes to the email; the owner types it back into the chat.
 *
 * Verification state lives in `whatsapp_conversations.flow_data`, which is
 * already this flow's state store — no new table, no migration.
 */

export const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export interface EmailVerificationState {
  email_pending?: string;
  email_code_hash?: string;
  email_code_expires_at?: string;
  email_code_attempts?: number;
}

export type VerifyOutcome = 'ok' | 'wrong' | 'expired' | 'locked' | 'no_pending';

/**
 * Conservative, deliberately not RFC 5322. This runs on free-form chat text, so
 * the job is to reject things that are obviously not an address and let the
 * verification email be the real arbiter — an address that cannot receive a
 * code fails the next step regardless of what any regex thought of it.
 */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

export function parseEmail(text: string): string | null {
  const match = EMAIL_RE.exec(text.trim());
  return match ? match[0].toLowerCase() : null;
}

/** Phrases specific enough to recognise anywhere in a sentence. */
const SKIP_PHRASES = ["no email", "don't have", 'dont have', 'no mail', 'i have none'];
/** Words that must stand alone. `includes('no')` would read "I have no idea what
 *  you mean" — and the address "arno@salon.ng" — as a request to skip. */
const SKIP_WORDS = ['skip', 'no', 'none', 'nope', 'later', 'nah'];

/** Owners without an email must be able to finish onboarding, not be walled out. */
export function isSkipRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!,]+$/, '');
  if (SKIP_PHRASES.some((w) => t.includes(w))) return true;
  return SKIP_WORDS.some((w) => t === w || t.startsWith(`${w} `));
}

/** Six digits from a CSPRNG — Math.random is not acceptable for a credential. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Salted with the tenant id so a hash lifted from one tenant's flow_data cannot
 * be replayed against another's.
 */
export function hashCode(code: string, tenantId: string): string {
  return createHash('sha256').update(`${tenantId}:${code}`).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** The flow_data patch that arms a new verification challenge. */
export function buildChallenge(
  email: string,
  code: string,
  tenantId: string,
  now = Date.now(),
): EmailVerificationState {
  return {
    email_pending: email,
    email_code_hash: hashCode(code, tenantId),
    email_code_expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    email_code_attempts: 0,
  };
}

/**
 * Checks a code typed back into the chat.
 *
 * Attempts are counted by the caller persisting the returned state; this
 * function is pure so it can be tested without a database.
 */
export function verifyCode(
  input: string,
  state: EmailVerificationState,
  tenantId: string,
  now = Date.now(),
): { outcome: VerifyOutcome; next: EmailVerificationState } {
  const attempts = state.email_code_attempts ?? 0;

  if (!state.email_code_hash || !state.email_pending) {
    return { outcome: 'no_pending', next: state };
  }
  if (attempts >= MAX_ATTEMPTS) {
    return { outcome: 'locked', next: state };
  }
  if (!state.email_code_expires_at || Date.parse(state.email_code_expires_at) <= now) {
    return { outcome: 'expired', next: state };
  }

  const digits = input.replace(/\D/g, '');
  if (!constantTimeEquals(hashCode(digits, tenantId), state.email_code_hash)) {
    // Count the failure so a wrong guess costs an attempt. Without this the
    // six-digit space is brute-forceable over a chat thread.
    return { outcome: 'wrong', next: { ...state, email_code_attempts: attempts + 1 } };
  }

  return { outcome: 'ok', next: state };
}

/** Clears the challenge once it has been consumed, however it ended. */
export function clearChallenge(state: EmailVerificationState): EmailVerificationState {
  const next = { ...state };
  delete next.email_pending;
  delete next.email_code_hash;
  delete next.email_code_expires_at;
  delete next.email_code_attempts;
  return next;
}
