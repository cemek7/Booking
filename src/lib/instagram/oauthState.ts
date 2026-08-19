import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Stateless, signed OAuth `state` for the Instagram connect flow.
 *
 * Encodes the initiating tenant id + issue time, signed with an HMAC so it can't be
 * tampered with across the redirect. The callback additionally cross-checks the decoded
 * tenant id against the authenticated session, so this is defence-in-depth against CSRF.
 */

const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function stateSecret(): string {
  return (
    process.env.INSTAGRAM_OAUTH_STATE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.CRON_SECRET ||
    ''
  );
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Create a signed state string for `tenantId`. Throws if no signing secret is configured. */
export function signState(tenantId: string): string {
  const secret = stateSecret();
  if (!secret) throw new Error('Instagram OAuth state secret not configured');
  const payload = b64url(JSON.stringify({ t: tenantId, iat: Date.now() }));
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

/** Verify a signed state string. Returns the tenant id, or null if invalid/expired. */
export function verifyState(state: string | null | undefined): string | null {
  const secret = stateSecret();
  if (!secret || !state || !state.includes('.')) return null;

  const [payload, sig] = state.split('.', 2);
  const expected = sign(payload, secret);

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      t?: string;
      iat?: number;
    };
    if (!decoded.t || !decoded.iat) return null;
    if (Date.now() - decoded.iat > MAX_AGE_MS) return null;
    return decoded.t;
  } catch {
    return null;
  }
}
