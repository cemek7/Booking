import { describe, it, expect } from '@jest/globals';
import {
  evaluateRateCard, nextQuarterStart, daysUntil, LOOKAHEAD_DAYS, FX_STALE_DAYS,
} from '@/lib/billing/rateCardWatch';

/**
 * The failure this guards against already happened once: messageRates.ts
 * carried a comment saying to update the rate on 2026-09-01, and the date
 * passed unnoticed. A comment cannot raise its hand.
 */

const FRESH_FX = (now: Date) => ({ as_of: new Date(now.getTime() - 86_400_000).toISOString() });

describe('nextQuarterStart', () => {
  it('finds the next 1st-of-quarter, never today', () => {
    expect(nextQuarterStart(new Date('2026-09-08T00:00:00Z')).toISOString().slice(0, 10))
      .toBe('2026-10-01');
    expect(nextQuarterStart(new Date('2026-10-01T12:00:00Z')).toISOString().slice(0, 10))
      .toBe('2027-01-01');
    expect(nextQuarterStart(new Date('2026-11-20T00:00:00Z')).toISOString().slice(0, 10))
      .toBe('2027-01-01');
  });

  it('rolls into the following year from Q4', () => {
    expect(nextQuarterStart(new Date('2026-12-31T23:00:00Z')).toISOString().slice(0, 10))
      .toBe('2027-01-01');
  });
});

describe('evaluateRateCard', () => {
  it('warns when a quarter start is close and nothing is dated for it', () => {
    const now = new Date('2026-11-25T00:00:00Z');   // 37 days to 2027-01-01
    const warnings = evaluateRateCard(
      [{ category: 'service', effective_from: '2026-10-01' }], FRESH_FX(now), now,
    );
    const w = warnings.find((x) => x.kind === 'quarter_unconfirmed');
    expect(w).toBeDefined();
    expect(w!.effectiveOn).toBe('2027-01-01');
    expect(w!.message).toContain('2027-01-01');
  });

  it('goes quiet once a future-dated row exists', () => {
    const now = new Date('2026-11-25T00:00:00Z');
    const warnings = evaluateRateCard(
      [
        { category: 'service', effective_from: '2026-10-01' },
        { category: 'service', effective_from: '2027-01-01' },
      ],
      FRESH_FX(now), now,
    );
    expect(warnings.filter((x) => x.kind === 'quarter_unconfirmed')).toHaveLength(0);
  });

  it('stays quiet while the quarter is still far off', () => {
    // Meta gives a month's notice, so warning in July about January is noise
    // that trains people to ignore the alert.
    const now = new Date('2026-07-05T00:00:00Z');   // ~88 days to 2026-10-01
    expect(daysUntil(nextQuarterStart(now), now)).toBeGreaterThan(LOOKAHEAD_DAYS);
    const warnings = evaluateRateCard(
      [{ category: 'service', effective_from: '2026-04-01' }], FRESH_FX(now), now,
    );
    expect(warnings.filter((x) => x.kind === 'quarter_unconfirmed')).toHaveLength(0);
  });

  it('flags an empty rate card as falling back to constants', () => {
    const now = new Date('2026-09-08T00:00:00Z');
    const warnings = evaluateRateCard([], FRESH_FX(now), now);
    expect(warnings.some((w) => w.kind === 'no_rate_card')).toBe(true);
  });

  it('flags a stale FX reading', () => {
    const now = new Date('2026-09-08T00:00:00Z');
    const old = { as_of: new Date(now.getTime() - (FX_STALE_DAYS + 3) * 86_400_000).toISOString() };
    const warnings = evaluateRateCard(
      [{ category: 'service', effective_from: '2026-10-01' }], old, now,
    );
    const w = warnings.find((x) => x.kind === 'fx_stale');
    expect(w).toBeDefined();
    expect(w!.message).toContain('17 days old');
  });

  it('flags a missing FX reading, because cost cannot be derived without it', () => {
    const now = new Date('2026-09-08T00:00:00Z');
    const warnings = evaluateRateCard(
      [{ category: 'service', effective_from: '2026-10-01' }], null, now,
    );
    expect(warnings.some((w) => w.kind === 'fx_stale')).toBe(true);
  });

  it('is silent when the card is current and the FX is fresh', () => {
    const now = new Date('2026-11-01T00:00:00Z');   // 61 days to 2027-01-01
    expect(evaluateRateCard(
      [{ category: 'service', effective_from: '2026-10-01' }], FRESH_FX(now), now,
    )).toEqual([]);
  });

  it('would have caught the miss that actually happened', () => {
    // 2026-09-08, nothing dated for the 2026-10-01 change: 23 days out.
    const now = new Date('2026-09-08T00:00:00Z');
    const warnings = evaluateRateCard(
      [{ category: 'service', effective_from: '2026-01-01' }], FRESH_FX(now), now,
    );
    expect(warnings.some((w) => w.kind === 'quarter_unconfirmed')).toBe(true);
  });
});
