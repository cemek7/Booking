import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
const addProducts = jest.fn();
const createPaymentLink = jest.fn();

function builder(table: string) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(chain);
  query.insert = jest.fn((payload: Record<string, unknown>) => {
    updates.push({ table, payload });
    return query;
  });
  query.update = jest.fn((payload: Record<string, unknown>) => {
    updates.push({ table, payload });
    return query;
  });
  query.maybeSingle = jest.fn(async () => {
    if (table === 'products') {
      return { data: { id: '11111111-1111-4111-8111-111111111111', name: 'Hair mask', is_active: true, track_inventory: false }, error: null };
    }
    if (table === 'customers') return { data: { id: 'customer-1' }, error: null };
    if (table === 'retail_orders') return { data: { metadata: { source: 'chat_sales' } }, error: null };
    return { data: null, error: null };
  });
  query.single = query.maybeSingle;
  (query as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null });
  return query;
}

const admin = { from: jest.fn((table: string) => builder(table)) };
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => admin }));
jest.mock('@/lib/commerce/retail-orders', () => ({
  addProductsToRetailCart: (...args: unknown[]) => addProducts(...args),
  createRetailOrderPaymentLinkForCustomer: (...args: unknown[]) => createPaymentLink(...args),
}));

import { createPublicOrder } from '@/lib/publicStorefrontService';

describe('public storefront fulfillment context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updates.length = 0;
    addProducts.mockResolvedValue({ orderId: 'order-1', cartId: 'cart-1', totalCents: 5000, itemCount: 1 });
    createPaymentLink.mockRejectedValue(new Error('payment unavailable'));
  });

  it('stores a trimmed address only in order fulfillment metadata', async () => {
    await createPublicOrder('tenant-1', {
      items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
      customer_name: 'Ada', customer_phone: '+2348000000000',
      delivery_address: '  12 Admiralty Way, Lekki  ', notes: 'Call on arrival',
    });

    const orderUpdate = updates.find((entry) => entry.table === 'retail_orders');
    expect(orderUpdate?.payload).toMatchObject({
      metadata: {
        source: 'chat_sales',
        retailFulfillment: {
          deliveryAddress: '12 Admiralty Way, Lekki',
          conversationThreadId: null,
        },
      },
    });
    expect(updates.filter((entry) => entry.table === 'customers')).toHaveLength(0);
    expect(JSON.stringify(updates)).not.toContain('verified');
  });

  it('keeps an absent delivery address null and still creates a threadless order context', async () => {
    await createPublicOrder('tenant-1', {
      items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
      customer_name: 'Ada', customer_phone: '+2348000000000',
    });

    expect(updates.find((entry) => entry.table === 'retail_orders')?.payload).toMatchObject({
      metadata: { retailFulfillment: { deliveryAddress: null, conversationThreadId: null } },
    });
  });

  it('bounds an address even when the service is called without the HTTP parser', async () => {
    await createPublicOrder('tenant-1', {
      items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
      customer_name: 'Ada', customer_phone: '+2348000000000',
      delivery_address: `  ${'A'.repeat(600)}  `,
    });

    const metadata = updates.find((entry) => entry.table === 'retail_orders')?.payload.metadata as {
      retailFulfillment?: { deliveryAddress?: string };
    };
    expect(metadata.retailFulfillment?.deliveryAddress).toHaveLength(500);
  });
});
