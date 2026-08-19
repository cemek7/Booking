import crypto from 'crypto';

/**
 * Signed one-click-unsubscribe tokens (CAN-SPAM / GDPR).
 *
 * A token is `base64url(JSON payload).base64url(HMAC-SHA256(payload))`. The
 * payload is readable but tamper-evident: any change invalidates the signature.
 * Stateless — no DB lookup needed to validate an unsubscribe link.
 */

export interface UnsubscribePayload {
  tenantId: string;
  /** The recipient identifier (email or customer id). */
  recipient: string;
  /** Which list/category this opt-out applies to, e.g. 'marketing'. */
  list: string;
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export function makeUnsubscribeToken(payload: UnsubscribePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Returns the payload if the token is well-formed and the signature matches; otherwise null. */
export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = sign(body, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<UnsubscribePayload>;
    if (
      typeof parsed?.tenantId !== 'string' ||
      typeof parsed?.recipient !== 'string' ||
      typeof parsed?.list !== 'string'
    ) {
      return null;
    }
    return { tenantId: parsed.tenantId, recipient: parsed.recipient, list: parsed.list };
  } catch {
    return null;
  }
}
