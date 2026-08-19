import { describe, it, expect } from '@jest/globals';
import { CAPS } from '@/lib/billing/spendCaps/config';

describe('spend-cap config', () => {
  it('exposes defaults', () => {
    expect(CAPS.velocityCredits()).toBe(200);
    expect(CAPS.velocityWindowMs()).toBe(10 * 60 * 1000);
    expect(CAPS.dailyDefault()).toBe(2000);
    expect(CAPS.dailyPlatformMax()).toBe(20000);
    expect(CAPS.softWarnPct()).toBeCloseTo(0.8);
    expect(CAPS.enforced()).toBe(true);
  });

  it('resolves a daily budget clamped to the platform max', () => {
    expect(CAPS.resolveDailyBudget(500)).toBe(500);
    expect(CAPS.resolveDailyBudget(999999)).toBe(20000);
    expect(CAPS.resolveDailyBudget(null)).toBe(2000);
  });

  it('resolves velocity from override or env default', () => {
    expect(CAPS.resolveVelocity(50)).toBe(50);
    expect(CAPS.resolveVelocity(null)).toBe(200);
  });
});
