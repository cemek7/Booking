import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inventoryRules } from './inventory';

function makeAdmin() {
  const responseMap = new Map<string, { data: unknown; error: { message: string } | null }>();

  return {
    __responses: responseMap,
    from: jest.fn((table: string) => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        then: undefined as unknown,
      } as {
        select: jest.Mock;
        eq: jest.Mock;
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

describe('inventoryRules', () => {
  it('excludes count_adjustment movements from stock_leaving_without_record', async () => {
    const admin = makeAdmin();
    admin.__responses.set('inventory_movements', {
      data: [
        {
          id: 'movement-1',
          product_id: 'product-1',
          movement_type: 'count_adjustment',
          quantity_change: -3,
          previous_quantity: 10,
          new_quantity: 7,
        },
      ],
      error: null,
    });

    const candidates = await inventoryRules[0].detect(admin, 'tenant-1', {
      startUtc: '2026-07-20T00:00:00.000Z',
      endUtc: '2026-07-21T00:00:00.000Z',
    }, { window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' } });

    expect(candidates).toHaveLength(0);
  });
});
