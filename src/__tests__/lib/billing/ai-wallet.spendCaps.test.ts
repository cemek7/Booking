import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCheckCaps = jest.fn();

jest.mock('@/lib/billing/spendCaps/spendGuard', () => ({
  checkCaps: mockCheckCaps,
}));

import { withTenantWalletSpend } from '@/lib/billing/ai-wallet';

function makeSupabase() {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: { llm_token_rate: null }, error: null })),
  };

  return {
    from: jest.fn(() => chain),
  };
}

describe('withTenantWalletSpend spend-cap backstop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws wallet_block when the cap guard blocks a non-pipeline caller', async () => {
    mockCheckCaps.mockResolvedValue({
      allowed: false,
      reason: 'velocity_cap',
      softWarn: false,
      spentTodayCredits: 0,
      dailyBudgetCredits: 0,
    });

    await expect(
      withTenantWalletSpend(
        makeSupabase() as never,
        'tenant-1',
        { estimatedTokens: 1000 },
        async () => ({ ok: true }),
      ),
    ).rejects.toThrow('wallet_block: velocity_cap');
  });

  it('skips the cap re-check for the pipeline path', async () => {
    mockCheckCaps.mockResolvedValue({
      allowed: false,
      reason: 'daily_cap',
      softWarn: false,
      spentTodayCredits: 0,
      dailyBudgetCredits: 0,
    });

    const result = await withTenantWalletSpend(
      makeSupabase() as never,
      'tenant-1',
      { estimatedTokens: 0, skipCapCheck: true },
      async () => ({ ok: true }),
    );

    expect(result).toEqual({ ok: true });
    expect(mockCheckCaps).not.toHaveBeenCalled();
  });
});
