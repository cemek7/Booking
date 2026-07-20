import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { retailRules } from './retail';

function makeAdmin() {
  const responseMap = new Map<string, { data: unknown; error: { message: string } | null }>();

  return {
    __responses: responseMap,
    from: jest.fn((table: string) => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        then: undefined as unknown,
      } as {
        select: jest.Mock;
        eq: jest.Mock;
        gt: jest.Mock;
        gte: jest.Mock;
        lt: jest.Mock;
        then?: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown;
      };

      state.then = (onfulfilled) =>
        Promise.resolve(onfulfilled(responseMap.get(table) ?? { data: null, error: null }));

      return state;
    }),
  } as unknown as SupabaseClient & { __responses: Map<string, { data: unknown; error: { message: string } | null }> };
}

describe('retailRules', () => {
  it('flags refund_without_reason when a refund has no reason', async () => {
    const admin = makeAdmin();
    admin.__responses.set('transactions', {
      data: [{ id: 'tx-1', subject_type: 'retail_order', subject_id: 'order-1', refund_amount: 50, refund_reason: null }],
      error: null,
    });

    const candidates = await retailRules[1].detect(admin, 'tenant-1', {
      startUtc: '2026-07-20T00:00:00.000Z',
      endUtc: '2026-07-21T00:00:00.000Z',
    }, { window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' } });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({
      ruleKey: 'refund_without_reason',
      entityId: 'order-1',
    }));
  });
});
