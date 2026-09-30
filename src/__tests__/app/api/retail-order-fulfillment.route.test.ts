import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const confirmFulfillment = jest.fn();
jest.mock('@/lib/commerce/retail-fulfillment-confirmation', () => {
  const actual = jest.requireActual('@/lib/commerce/retail-fulfillment-confirmation') as Record<string, unknown>;
  return { ...actual, confirmRetailOrderFulfillment: (...args: unknown[]) => confirmFulfillment(...args) };
});

import { POST } from '@/app/api/retail/orders/[id]/fulfillment/route';

function context(body: unknown, orderId = 'order-1') {
  return {
    request: {
      method: 'POST',
      url: `http://booka.test/api/retail/orders/${orderId}/fulfillment`,
      headers: new Headers(),
      json: async () => body,
    },
    params: { id: orderId },
    user: { id: 'owner-1', email: 'owner@example.com', role: 'owner', tenantId: 'tenant-1' },
    supabase: {} as never,
  };
}

describe('retail order fulfillment route', () => {
  beforeEach(() => {
    confirmFulfillment.mockReset();
    confirmFulfillment.mockResolvedValue({
      orderId: 'order-1', totalCents: 47_500, deliveryFeeCents: 2500,
      paymentUrl: 'https://pay.test/1', paymentReference: 'pay-1',
    });
  });

  it('passes a strict tenant-scoped confirmation to the service', async () => {
    const result = await POST(context({
      method: 'third_party_manual', provider: 'bolt', deliveryFeeCents: 2500,
      note: 'Rider will call',
    }) as never);

    expect(confirmFulfillment).toHaveBeenCalledWith({
      tenantId: 'tenant-1', orderId: 'order-1', actorUserId: 'owner-1',
      method: 'third_party_manual', provider: 'bolt', deliveryFeeCents: 2500,
      note: 'Rider will call',
    });
    expect(result).toMatchObject({ data: { orderId: 'order-1', totalCents: 47_500 } });
  });

  it('rejects unknown fields and inconsistent provider/fee input before mutation', async () => {
    await expect(POST(context({
      method: 'customer_pickup', provider: 'bolt', deliveryFeeCents: 500,
      surprise: true,
    }) as never)).rejects.toMatchObject({ statusCode: 400 });
    expect(confirmFulfillment).not.toHaveBeenCalled();
  });

  it('does not hide a tenant/order ownership miss as a server error', async () => {
    confirmFulfillment.mockRejectedValue(new Error('Retail order was not found in the tenant'));
    await expect(POST(context({
      method: 'customer_pickup', provider: null, deliveryFeeCents: 0, note: null,
    }) as never)).rejects.toMatchObject({ statusCode: 404 });
  });
});
