import { describe, it, expect } from '@jest/globals';
import { makeUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/email/unsubscribe';

const SECRET = 'test-secret';
const payload = { tenantId: 't1', recipient: 'ada@example.com', list: 'marketing' };

describe('unsubscribe token', () => {
  it('round-trips a payload', () => {
    const token = makeUnsubscribeToken(payload, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual(payload);
  });

  it('rejects a token signed with a different secret', () => {
    const token = makeUnsubscribeToken(payload, SECRET);
    expect(verifyUnsubscribeToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = makeUnsubscribeToken(payload, SECRET);
    const [body, sig] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ ...payload, recipient: 'eve@example.com' }),
    ).toString('base64url');
    expect(verifyUnsubscribeToken(`${forgedBody}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken('', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('garbage', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c', SECRET)).toBeNull();
  });
});
