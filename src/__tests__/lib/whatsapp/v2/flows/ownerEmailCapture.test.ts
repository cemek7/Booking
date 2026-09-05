import { describe, it, expect } from '@jest/globals';
import {
  parseEmail, isSkipRequest, generateCode, hashCode, buildChallenge, verifyCode,
  clearChallenge, CODE_TTL_MS, MAX_ATTEMPTS,
} from '@/lib/whatsapp/v2/flows/ownerEmailCapture';

const TENANT = 'tenant-1';

describe('parseEmail', () => {
  it('pulls an address out of conversational text', () => {
    expect(parseEmail('sure its Ada@Salon.NG thanks')).toBe('ada@salon.ng');
  });

  it('returns null when there is no address', () => {
    expect(parseEmail('i dont really use email')).toBeNull();
  });

  it('rejects a bare domain and a bare local part', () => {
    expect(parseEmail('salon.ng')).toBeNull();
    expect(parseEmail('ada@')).toBeNull();
  });
});

describe('isSkipRequest', () => {
  it.each(['skip', 'No', "I don't have one", 'no email', 'later'])('treats %p as a skip', (t) => {
    expect(isSkipRequest(t)).toBe(true);
  });

  it('does not treat an address as a skip', () => {
    expect(isSkipRequest('ada@salon.ng')).toBe(false);
  });

  // A substring match on 'no' reads both of these as a skip, which would drop
  // a real address on the floor and answer a question with silence.
  it('does not treat an address that merely contains "no" as a skip', () => {
    expect(isSkipRequest('arno@salon.ng')).toBe(false);
    expect(isSkipRequest('  Nonso@Salon.NG ')).toBe(false);
  });

  it('does not treat a sentence containing "no" as a skip', () => {
    expect(isSkipRequest('i have no idea what you mean')).toBe(false);
    expect(isSkipRequest('can you send it now')).toBe(false);
  });
});

describe('generateCode', () => {
  it('is always six digits, including when the draw is small', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('verifyCode', () => {
  function armed(code: string, now = Date.now()) {
    return buildChallenge('ada@salon.ng', code, TENANT, now);
  }

  it('accepts the right code', () => {
    const state = armed('123456');
    expect(verifyCode('123456', state, TENANT).outcome).toBe('ok');
  });

  it('tolerates a code the owner typed with spaces', () => {
    const state = armed('123456');
    expect(verifyCode('12 34 56', state, TENANT).outcome).toBe('ok');
  });

  it('rejects a wrong code and spends an attempt', () => {
    const state = armed('123456');
    const r = verifyCode('999999', state, TENANT);
    expect(r.outcome).toBe('wrong');
    // Without this the six-digit space is brute-forceable over a chat thread.
    expect(r.next.email_code_attempts).toBe(1);
  });

  it('locks out after the attempt cap', () => {
    const state = { ...armed('123456'), email_code_attempts: MAX_ATTEMPTS };
    expect(verifyCode('123456', state, TENANT).outcome).toBe('locked');
  });

  it('expires the code after its TTL', () => {
    const issuedAt = Date.now() - CODE_TTL_MS - 1000;
    const state = armed('123456', issuedAt);
    expect(verifyCode('123456', state, TENANT).outcome).toBe('expired');
  });

  it('will not verify against another tenant, even with the right code', () => {
    // The hash is salted with the tenant id so a hash lifted from one tenant's
    // flow_data cannot be replayed against another's.
    const state = armed('123456');
    expect(verifyCode('123456', state, 'tenant-2', Date.now()).outcome).toBe('wrong');
  });

  it('reports no_pending when nothing was armed', () => {
    expect(verifyCode('123456', {}, TENANT).outcome).toBe('no_pending');
  });
});

describe('hashCode', () => {
  it('never stores the code itself', () => {
    const h = hashCode('123456', TENANT);
    expect(h).not.toContain('123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs per tenant for the same code', () => {
    expect(hashCode('123456', 'a')).not.toBe(hashCode('123456', 'b'));
  });
});

describe('clearChallenge', () => {
  it('leaves no verification material behind', () => {
    const next = clearChallenge({ ...buildChallenge('a@b.co', '123456', TENANT), });
    expect(next.email_pending).toBeUndefined();
    expect(next.email_code_hash).toBeUndefined();
    expect(next.email_code_expires_at).toBeUndefined();
    expect(next.email_code_attempts).toBeUndefined();
  });

  it('preserves unrelated flow_data', () => {
    const state = { ...buildChallenge('a@b.co', '123456', TENANT), onboarding_step: 7 } as Record<string, unknown>;
    expect(clearChallenge(state).onboarding_step).toBe(7);
  });
});
