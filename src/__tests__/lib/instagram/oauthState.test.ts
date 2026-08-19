import { describe, it, expect, beforeAll, afterEach, jest } from '@jest/globals';
import { signState, verifyState } from '@/lib/instagram/oauthState';

describe('instagram oauthState', () => {
  beforeAll(() => {
    process.env.INSTAGRAM_OAUTH_STATE_SECRET = 'unit-test-state-secret';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.INSTAGRAM_OAUTH_STATE_SECRET = 'unit-test-state-secret';
  });

  it('round-trips the tenant id', () => {
    const state = signState('tenant-123');
    expect(verifyState(state)).toBe('tenant-123');
  });

  it('rejects a tampered payload', () => {
    const state = signState('tenant-123');
    const [, sig] = state.split('.', 2);
    const forged = `${Buffer.from(JSON.stringify({ t: 'attacker', iat: Date.now() })).toString('base64url')}.${sig}`;
    expect(verifyState(forged)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const state = signState('tenant-123');
    const [payload] = state.split('.', 2);
    expect(verifyState(`${payload}.deadbeef`)).toBeNull();
  });

  it('rejects state signed with a different secret', () => {
    const state = signState('tenant-123');
    process.env.INSTAGRAM_OAUTH_STATE_SECRET = 'a-different-secret';
    expect(verifyState(state)).toBeNull();
  });

  it('rejects expired state (older than 10 minutes)', () => {
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow - 11 * 60 * 1000);
    const oldState = signState('tenant-123');
    jest.spyOn(Date, 'now').mockReturnValue(realNow);
    expect(verifyState(oldState)).toBeNull();
  });

  it('returns null for empty/garbage input', () => {
    expect(verifyState(null)).toBeNull();
    expect(verifyState('')).toBeNull();
    expect(verifyState('no-dot')).toBeNull();
  });

  it('throws when no signing secret is configured', () => {
    delete process.env.INSTAGRAM_OAUTH_STATE_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.CRON_SECRET;
    expect(() => signState('tenant-123')).toThrow(/secret/i);
  });
});
