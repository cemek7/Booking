import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  resolveCostBasis, resolveSellCredits, resetRateCardCache, RATE_CARD_INTERNALS,
} from '@/lib/billing/rateCard';

/**
 * The cost basis is Meta's USD price times the naira rate. Storing NGN 14
 * directly hid both halves: a Meta change could not be future-dated, and an FX
 * move raised the real cost with nothing to read and nothing to update.
 */

type Row = Record<string, unknown>;
let cardRows: Row[] = [];
let fxRow: Row | null = null;
let cardError: unknown = null;

function makeAdmin() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: fxRow, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(
            table === 'message_rate_card'
              // supabase-js nulls `data` when it sets `error`
              ? { data: cardError ? null : cardRows, error: cardError }
              : { data: fxRow, error: null },
          ).then(res, rej),
      });
      return q;
    },
  } as never;
}

const NOW = new Date('2026-10-15T00:00:00Z');

beforeEach(() => {
  resetRateCardCache();
  cardError = null;
  cardRows = [
    { category: 'marketing', cost_usd: '0.062000', effective_from: '2026-10-01' },
    { category: 'service', cost_usd: '0.010100', effective_from: '2026-10-01' },
  ];
  fxRow = { rate: '1321.225569', as_of: '2026-10-14T00:00:00Z' };
  delete process.env.BOOKA_MESSAGE_MARKUP;
});

describe('resolveCostBasis', () => {
  it('derives naira cost from USD price times the stored FX rate', async () => {
    const basis = await resolveCostBasis(makeAdmin(), 'service', NOW);
    expect(basis.fallback).toBe(false);
    expect(basis.costCredits).toBeCloseTo(0.0101 * 1321.225569, 6);
  });

  it('prices marketing from its own row, not the service row', async () => {
    const basis = await resolveCostBasis(makeAdmin(), 'marketing', NOW);
    expect(basis.costCredits).toBeCloseTo(0.062 * 1321.225569, 6);
  });

  it('applies a future-dated row only once it is in effect', async () => {
    // Entered the day Meta announces, a month or more ahead.
    cardRows.unshift({ category: 'marketing', cost_usd: '0.068', effective_from: '2027-01-01' });

    resetRateCardCache();
    const before = await resolveCostBasis(makeAdmin(), 'marketing', new Date('2026-12-31T00:00:00Z'));
    expect(before.costUsd).toBe(0.062);

    resetRateCardCache();
    const after = await resolveCostBasis(makeAdmin(), 'marketing', new Date('2027-01-01T00:00:00Z'));
    expect(after.costUsd).toBe(0.068);
  });

  it('falls back to the constants when the card has nothing in effect yet', async () => {
    const basis = await resolveCostBasis(makeAdmin(), 'service', new Date('2026-09-30T00:00:00Z'));
    expect(basis.fallback).toBe(true);
    expect(basis.costCredits).toBe(14);
  });

  it('falls back to the constants when the read fails', async () => {
    // A pricing lookup must never be the reason a message goes unsent.
    cardError = { message: 'relation does not exist' };
    const basis = await resolveCostBasis(makeAdmin(), 'marketing', NOW);
    expect(basis.fallback).toBe(true);
    expect(basis.costCredits).toBe(84);
  });

  it('falls back when there is no FX reading at all', async () => {
    fxRow = null;
    const basis = await resolveCostBasis(makeAdmin(), 'service', NOW);
    expect(basis.fallback).toBe(true);
    expect(basis.costCredits).toBe(14);
  });
});

describe('resolveSellCredits', () => {
  it('sells at cost times the markup', async () => {
    const price = await resolveSellCredits(makeAdmin(), null, 'service', NOW);
    expect(price).toBeCloseTo(0.0101 * 1321.225569 * 1.6, 6);
  });

  it('honours a tenant override above the floor', async () => {
    const price = await resolveSellCredits(makeAdmin(), 20, 'service', NOW);
    expect(price).toBe(20);
  });

  it('clamps a tenant override that would sell below cost', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const cost = 0.0101 * 1321.225569;

    // 5 credits is well under the ~13.3 it costs Booka to send.
    const price = await resolveSellCredits(makeAdmin(), 5, 'service', NOW);

    expect(price).toBeCloseTo(cost * RATE_CARD_INTERNALS.MIN_MARKUP, 6);
    expect(price).toBeGreaterThan(cost);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores a tenant override for marketing entirely', async () => {
    // A rate negotiated for conversational replies must not become a
    // six-times-under-cost rate the moment that tenant broadcasts.
    const price = await resolveSellCredits(makeAdmin(), 20, 'marketing', NOW);
    expect(price).toBeCloseTo(0.062 * 1321.225569 * 1.6, 6);
    expect(price).toBeGreaterThan(20);
  });
});
