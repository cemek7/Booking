import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  getMeteringMode,
  isShadowMode,
  resolveMessageCostCredits,
  getMessageMarkup,
  resolveMessageSellCredits,
  getGraceOverdraftDefault,
  getReconcileDriftPct,
  normalizeCategory,
} from '@/lib/billing/messageRates';

describe('messageRates', () => {
  beforeEach(() => {
    delete process.env.BOOKA_MESSAGE_METERING_MODE;
    delete process.env.BOOKA_MESSAGE_RATE_CREDITS;
    delete process.env.BOOKA_MESSAGE_MARKETING_RATE_CREDITS;
    delete process.env.BOOKA_MESSAGE_MARKUP;
    delete process.env.BOOKA_MESSAGE_GRACE_CREDITS;
    delete process.env.BOOKA_MESSAGE_RECONCILE_DRIFT_PCT;
  });

  it('defaults to shadow mode', () => {
    expect(getMeteringMode()).toBe('shadow');
    expect(isShadowMode()).toBe(true);
  });

  it('honours live mode', () => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'live';
    expect(getMeteringMode()).toBe('live');
    expect(isShadowMode()).toBe(false);
  });

  it('falls back to shadow for an unrecognised mode', () => {
    process.env.BOOKA_MESSAGE_METERING_MODE = 'banana';
    expect(getMeteringMode()).toBe('shadow');
  });

  it('uses the provisional cost when unset', () => {
    expect(resolveMessageCostCredits()).toBe(14);
  });

  it('reads the platform cost from env', () => {
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '11.5';
    expect(resolveMessageCostCredits()).toBe(11.5);
  });

  it('ignores a non-numeric or non-positive platform cost', () => {
    process.env.BOOKA_MESSAGE_RATE_CREDITS = 'abc';
    expect(resolveMessageCostCredits()).toBe(14);
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '0';
    expect(resolveMessageCostCredits()).toBe(14);
    process.env.BOOKA_MESSAGE_RATE_CREDITS = '-3';
    expect(resolveMessageCostCredits()).toBe(14);
  });

  it('defaults the markup to 1.6', () => {
    expect(getMessageMarkup()).toBe(1.6);
  });

  it('refuses a markup below 1 (would sell below cost)', () => {
    process.env.BOOKA_MESSAGE_MARKUP = '0.5';
    expect(getMessageMarkup()).toBe(1.6);
  });

  it('sells at cost times markup', () => {
    expect(resolveMessageSellCredits(null)).toBeCloseTo(22.4, 6);
  });

  it('prefers a per-tenant override over the computed sell rate', () => {
    expect(resolveMessageSellCredits(30)).toBe(30);
  });

  it('ignores a non-positive tenant override', () => {
    expect(resolveMessageSellCredits(0)).toBeCloseTo(22.4, 6);
    expect(resolveMessageSellCredits(-5)).toBeCloseTo(22.4, 6);
  });

  it('defaults grace and drift', () => {
    expect(getGraceOverdraftDefault()).toBe(100);
    expect(getReconcileDriftPct()).toBe(2);
  });
});

// ── Category pricing ─────────────────────────────────────────────────────────
// Meta charges ~NGN 84 for a marketing message and ~NGN 14 for service/utility.
// One flat rate meant Booka billed NGN 22.40 for something that cost NGN 84.

describe('category-aware pricing', () => {
  const ENV = { ...process.env };
  afterEach(() => { process.env = { ...ENV }; });

  it('prices marketing six times higher than service', () => {
    expect(resolveMessageCostCredits('marketing')).toBe(84);
    expect(resolveMessageCostCredits('service')).toBe(14);
    expect(resolveMessageCostCredits('utility')).toBe(14);
    expect(resolveMessageCostCredits(null)).toBe(14);
  });

  it('lets the marketing rate move with the exchange rate', () => {
    process.env.BOOKA_MESSAGE_MARKETING_RATE_CREDITS = '92';
    expect(resolveMessageCostCredits('marketing')).toBe(92);
    expect(resolveMessageCostCredits('utility')).toBe(14);
  });

  it('applies the markup to the marketing cost, not the service cost', () => {
    // 84 * 1.6, not 14 * 1.6 — the bug this exists to prevent.
    expect(resolveMessageSellCredits(null, 'marketing')).toBeCloseTo(84 * 1.6, 5);
    expect(resolveMessageSellCredits(null, 'service')).toBeCloseTo(14 * 1.6, 5);
  });

  it('honours a tenant rate override for service but NEVER for marketing', () => {
    // A negotiated conversational rate must not become a six-times-under-cost
    // rate the moment the tenant sends a broadcast.
    expect(resolveMessageSellCredits(9, 'service')).toBe(9);
    expect(resolveMessageSellCredits(9, 'utility')).toBe(9);
    expect(resolveMessageSellCredits(9, 'marketing')).toBeCloseTo(84 * 1.6, 5);
  });

  it('keeps the old single-argument behaviour for callers that pass no category', () => {
    expect(resolveMessageSellCredits(9)).toBe(9);
    expect(resolveMessageSellCredits(null)).toBeCloseTo(14 * 1.6, 5);
  });
});

describe('normalizeCategory', () => {
  it('reads the shapes Meta actually sends', () => {
    expect(normalizeCategory('MARKETING')).toBe('marketing');
    expect(normalizeCategory(' service ')).toBe('service');
    expect(normalizeCategory('authentication_international')).toBe('authentication');
  });

  it('returns null for anything unrecognised rather than guessing', () => {
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory('')).toBeNull();
    expect(normalizeCategory('referral_conversion')).toBeNull();
  });
});
