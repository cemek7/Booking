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
    PRODUCT_STOCK_ADJUSTED: 'product.stock_adjusted',
    PRODUCT_PRICE_CHANGED: 'product.price_changed',
    PRODUCT_ADDED: 'product.added',
    PRODUCT_AVAILABILITY_CHANGED: 'product.availability_changed',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { commerceHandlers } from './commerce';
import { HANDLERS } from './registry';

function makeAdmin(responses: Array<{ data: unknown; error: { message: string } | null }>) {
  const queue = [...responses];

  return {
    from: jest.fn(() => {
      const state = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        single: jest.fn(async () => queue.shift() ?? { data: null, error: null }),
        maybeSingle: jest.fn(async () => queue.shift() ?? { data: null, error: null }),
      };
      return state;
    }),
  } as unknown as SupabaseClient;
}

describe('commerceHandlers', () => {
  beforeEach(() => {
    Object.assign(HANDLERS, commerceHandlers);
    mockRecordMovement.mockReset();
    mockRecordBusinessEvent.mockReset();
  });

  it('adjust_stock executes through recordMovement and emits product.stock_adjusted', async () => {
    mockRecordMovement.mockResolvedValue({ data: [{ movement_id: 'mov-1' }], error: null });
    const admin = makeAdmin([]);

    const result = await commerceHandlers.adjust_stock.execute(
      admin,
      'tenant-1',
      { product_id: 'product-1', delta: -2, reason: 'count fix' },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(mockRecordMovement).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        productId: 'product-1',
        movementType: 'adjustment',
        quantityChange: -2,
      })
    );
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        action: BUSINESS_EVENT_ACTIONS.PRODUCT_STOCK_ADJUSTED,
      })
    );
  });

  it('low_stock_query returns matching low-stock products', async () => {
    const query = {
      eq: jest.fn(),
      then: undefined as unknown,
    } as {
      eq: jest.Mock;
      then?: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown;
    };
    query.eq.mockReturnValue(query);
    query.then = (onfulfilled) =>
      Promise.resolve(
        onfulfilled({
          data: [
            { id: 'p1', name: 'Oil', stock_quantity: 1, low_stock_threshold: 3 },
            { id: 'p2', name: 'Gel', stock_quantity: 0, low_stock_threshold: 2 },
          ],
          error: null,
        })
      );

    const admin = {
      from: jest.fn(() => ({
        select: jest.fn(() => query),
      })),
    } as unknown as SupabaseClient;

    const result = await commerceHandlers.low_stock_query.execute(admin, 'tenant-1', {}, {});

    expect(result.success).toBe(true);
    expect(result.reply).toMatch(/Low stock items/i);
    expect(result.data).toEqual({
      items: [
        { id: 'p1', name: 'Oil', stock_quantity: 1, low_stock_threshold: 3 },
        { id: 'p2', name: 'Gel', stock_quantity: 0, low_stock_threshold: 2 },
      ],
    });
  });
});
