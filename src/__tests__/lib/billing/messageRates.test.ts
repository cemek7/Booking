import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  getMeteringMode,
  isShadowMode,
  resolveMessageCostCredits,
  getMessageMarkup,
  resolveMessageSellCredits,
  getGraceOverdraftDefault,
  getReconcileDriftPct,
} from '@/lib/billing/messageRates';

describe('messageRates', () => {
  beforeEach(() => {
    delete process.env.BOOKA_MESSAGE_METERING_MODE;
    delete process.env.BOOKA_MESSAGE_RATE_CREDITS;
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
