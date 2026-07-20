import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';

const mockRecordMovement = jest.fn();
const mockRecordBusinessEvent = jest.fn();

jest.mock('@/lib/inventory/recordMovement', () => ({
  recordMovement: (...args: unknown[]) => mockRecordMovement(...args),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    STOCK_DAMAGED: 'stock.damaged',
    STOCK_RESTOCKED: 'stock.restocked',
    STOCK_TRANSFERRED: 'stock.transferred',
    STOCK_COUNT_RECORDED: 'stock.count_recorded',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { inventoryHandlers } from './inventory';

function makeAdmin(responses: Array<{ data: unknown; error: { message: string } | null }>) {
  const queue = [...responses];
  return {
    from: jest.fn(() => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(async () => queue.shift() ?? { data: null, error: null }),
        maybeSingle: jest.fn(async () => queue.shift() ?? { data: null, error: null }),
        then: undefined as unknown,
      } as {
        select: jest.Mock;
        eq: jest.Mock;
        single: jest.Mock;
        maybeSingle: jest.Mock;
        then?: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown;
      };
      state.then = (onfulfilled) => Promise.resolve(onfulfilled(queue.shift() ?? { data: null, error: null }));
      return state;
    }),
  } as unknown as SupabaseClient;
}

describe('inventoryHandlers', () => {
  beforeEach(() => {
    mockRecordMovement.mockReset();
    mockRecordBusinessEvent.mockReset();
  });

  it('record_damage validate fails without a reason', async () => {
    const result = await inventoryHandlers.record_damage.validate(
      {} as SupabaseClient,
      'tenant-1',
      { product_id: 'product-1', quantity: 2 },
      {}
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reason/i);
  });

  it('record_damage posts a negative damage movement and emits stock.damaged', async () => {
    mockRecordMovement.mockResolvedValue({ data: [{ movement_id: 'mov-1' }], error: null });
    const admin = makeAdmin([]);

    const result = await inventoryHandlers.record_damage.execute(
      admin,
      'tenant-1',
      { product_id: 'product-1', quantity: 2, reason: 'broken seal' },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(mockRecordMovement).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        movementType: 'damage',
        quantityChange: -2,
      })
    );
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.STOCK_DAMAGED,
      })
    );
  });

  it('inventory_variance_query returns product stock against recorded ledger movement totals', async () => {
    const admin = makeAdmin([
      {
        data: [
          { id: 'p1', name: 'Oil', stock_quantity: 8 },
          { id: 'p2', name: 'Gel', stock_quantity: 3 },
        ],
        error: null,
      },
      {
        data: [
          { product_id: 'p1', quantity_change: 5 },
          { product_id: 'p1', quantity_change: -1 },
          { product_id: 'p2', quantity_change: 1 },
        ],
        error: null,
      },
    ]);

    const result = await inventoryHandlers.inventory_variance_query.execute(
      admin,
      'tenant-1',
      {},
      {}
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      items: [
        { id: 'p1', name: 'Oil', current_stock: 8, net_recorded_change: 4, variance: 4 },
        { id: 'p2', name: 'Gel', current_stock: 3, net_recorded_change: 1, variance: 2 },
      ],
    });
  });
});
