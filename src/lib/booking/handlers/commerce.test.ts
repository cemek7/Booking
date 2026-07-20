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
    RETAIL_SALE_RECORDED: 'retail_sale.recorded',
    ORDER_REFUNDED: 'order.refunded',
    OUTSTANDING_BALANCE_RECORDED: 'outstanding_balance.recorded',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { commerceHandlers } from './commerce';
import { HANDLERS } from './registry';

function makeAdmin(responses: Array<{ data: unknown; error: { message: string } | null }>) {
  const queue = [...responses];

  return {
    rpc: jest.fn(async () => queue.shift() ?? { data: null, error: null }),
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

  it('record_retail_sale executes through the atomic RPC and emits retail_sale.recorded', async () => {
    const admin = makeAdmin([
      {
        data: [{ order_id: 'order-1', transaction_id: 'tx-1', total_cents: 6500, item_count: 2 }],
        error: null,
      },
    ]);

    const result = await commerceHandlers.record_retail_sale.execute(
      admin,
      'tenant-1',
      {
        items: [
          { product_id: 'product-1', quantity: 1, unit_price_cents: 2500 },
          { product_id: 'product-2', quantity: 1, unit_price_cents: 4000 },
        ],
        external_customer_ref: '2348012345678',
      },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith(
      'record_retail_sale_tx',
      expect.objectContaining({
        p_tenant_id: 'tenant-1',
        p_actor_user_id: 'user-1',
        p_external_customer_ref: '2348012345678',
      })
    );
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        action: BUSINESS_EVENT_ACTIONS.RETAIL_SALE_RECORDED,
        entityId: 'order-1',
      })
    );
  });

  it('record_retail_sale returns the RPC error and emits no event on failure', async () => {
    const admin = makeAdmin([{ data: null, error: { message: 'inventory move failed' } }]);

    const result = await commerceHandlers.record_retail_sale.execute(
      admin,
      'tenant-1',
      {
        items: [{ product_id: 'product-1', quantity: 2, unit_price_cents: 3000 }],
      },
      { actorId: 'user-1' }
    );

    expect(result).toEqual({ success: false, error: 'inventory move failed' });
    expect(mockRecordBusinessEvent).not.toHaveBeenCalled();
  });

  it('refund_sale executes through the atomic refund RPC and emits order.refunded', async () => {
    const admin = makeAdmin([
      { data: [{ order_id: 'order-1', refund_transaction_id: 'tx-refund-1', total_cents: 6500 }], error: null },
    ]);

    const result = await commerceHandlers.refund_sale.execute(
      admin,
      'tenant-1',
      { order_id: 'order-1', reason: 'customer changed mind' },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith(
      'refund_retail_sale_tx',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_reason: 'customer changed mind',
      })
    );
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.ORDER_REFUNDED,
        entityId: 'order-1',
      })
    );
  });

  it('record_outstanding_balance creates an unpaid retail order and emits an audit event', async () => {
    const admin = makeAdmin([{ data: { id: 'order-2', total_cents: 9000 }, error: null }]);

    const result = await commerceHandlers.record_outstanding_balance.execute(
      admin,
      'tenant-1',
      {
        items: [
          { product_id: 'product-1', quantity: 1, unit_price_cents: 5000 },
          { product_id: 'product-2', quantity: 2, unit_price_cents: 2000 },
        ],
        customer_id: 'customer-1',
      },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(admin.from).toHaveBeenNthCalledWith(1, 'retail_orders');
    expect(admin.from).toHaveBeenNthCalledWith(2, 'retail_order_items');
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.OUTSTANDING_BALANCE_RECORDED,
        entityId: 'order-2',
      })
    );
  });
});
