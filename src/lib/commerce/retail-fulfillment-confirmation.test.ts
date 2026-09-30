import { jest } from '@jest/globals';

import {
  confirmRetailOrderFulfillment,
  type RetailFulfillmentConfirmationStore,
} from './retail-fulfillment-confirmation';

function makeStore(overrides: Partial<RetailFulfillmentConfirmationStore> = {}) {
  const store: RetailFulfillmentConfirmationStore = {
    loadOrder: jest.fn(async () => ({
      id: 'order-1', tenantId: 'tenant-1', externalCustomerRef: '+2348000000000',
      paymentStatus: 'unpaid', subtotalCents: 50_000, discountCents: 5_000,
      metadata: {
        retailFulfillment: {
          method: 'own_dispatch', provider: null, deliveryAddress: '12 Admiralty Way',
          serviceArea: 'Lekki', feeStatus: 'quote_required', deliveryFeeCents: null,
          arrangementStatus: 'awaiting_human', conversationThreadId: '11111111-1111-4111-8111-111111111111',
        },
      },
    })),
    updateOrder: jest.fn(async () => undefined),
    createOrReusePaymentLink: jest.fn(async () => ({
      paymentUrl: 'https://pay.test/order-1', reference: 'pay-1', totalCents: 47_500,
    })),
    resolveEscalation: jest.fn(async () => undefined),
    loadThread: jest.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111', channel: 'whatsapp',
    })),
    releaseThread: jest.fn(async () => undefined),
    ...overrides,
  };
  return store;
}

describe('retail fulfillment confirmation', () => {
  it('calculates from canonical subtotal exactly once and releases only after payment and resolution', async () => {
    const store = makeStore();

    const result = await confirmRetailOrderFulfillment({
      tenantId: 'tenant-1', orderId: 'order-1', actorUserId: 'owner-1',
      method: 'own_dispatch', provider: null, deliveryFeeCents: 2500,
      note: 'Rider will call first',
    }, store);

    expect(store.updateOrder).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', orderId: 'order-1', deliveryFeeCents: 2500, totalCents: 47_500,
      context: expect.objectContaining({
        method: 'own_dispatch', feeStatus: 'confirmed', deliveryFeeCents: 2500,
        arrangementStatus: 'arranged', arrangementNote: 'Rider will call first',
      }),
    }));
    expect(store.createOrReusePaymentLink).toHaveBeenCalled();
    expect(store.resolveEscalation).toHaveBeenCalledWith('tenant-1', 'order-1');
    expect(store.releaseThread).toHaveBeenCalled();
    const calls = [
      (store.updateOrder as jest.Mock).mock.invocationCallOrder[0],
      (store.createOrReusePaymentLink as jest.Mock).mock.invocationCallOrder[0],
      (store.resolveEscalation as jest.Mock).mock.invocationCallOrder[0],
      (store.releaseThread as jest.Mock).mock.invocationCallOrder[0],
    ];
    expect(calls).toEqual([...calls].sort((a, b) => Number(a) - Number(b)));
    expect(result).toMatchObject({ totalCents: 47_500, paymentUrl: 'https://pay.test/order-1' });
  });

  it('does not accumulate the previously stored delivery fee on replay', async () => {
    const store = makeStore({
      loadOrder: jest.fn(async () => ({
        id: 'order-1', tenantId: 'tenant-1', externalCustomerRef: null,
        paymentStatus: 'unpaid', subtotalCents: 50_000, discountCents: 5_000,
        metadata: {
          retailFulfillment: {
            method: 'own_dispatch', provider: null, deliveryAddress: '12 Admiralty Way',
            serviceArea: null, feeStatus: 'confirmed', deliveryFeeCents: 2500,
            arrangementStatus: 'arranged', conversationThreadId: null,
          },
        },
      })),
    });

    await confirmRetailOrderFulfillment({
      tenantId: 'tenant-1', orderId: 'order-1', actorUserId: 'owner-1',
      method: 'own_dispatch', provider: null, deliveryFeeCents: 2500, note: null,
    }, store);

    expect(store.updateOrder).toHaveBeenCalledWith(expect.objectContaining({ totalCents: 47_500 }));
  });

  it('stops before payment, escalation resolution and release if confirmation is not durable', async () => {
    const store = makeStore({ updateOrder: jest.fn(async () => { throw new Error('write failed'); }) });

    await expect(confirmRetailOrderFulfillment({
      tenantId: 'tenant-1', orderId: 'order-1', actorUserId: 'owner-1',
      method: 'own_dispatch', provider: null, deliveryFeeCents: 2500, note: null,
    }, store)).rejects.toThrow('write failed');

    expect(store.createOrReusePaymentLink).not.toHaveBeenCalled();
    expect(store.resolveEscalation).not.toHaveBeenCalled();
    expect(store.releaseThread).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant/missing orders and inconsistent delivery confirmation', async () => {
    const missing = makeStore({ loadOrder: jest.fn(async () => null) });
    await expect(confirmRetailOrderFulfillment({
      tenantId: 'tenant-2', orderId: 'order-1', actorUserId: 'owner-1',
      method: 'customer_pickup', provider: null, deliveryFeeCents: 0, note: null,
    }, missing)).rejects.toThrow(/not found/i);

    const store = makeStore();
    await expect(confirmRetailOrderFulfillment({
      tenantId: 'tenant-1', orderId: 'order-1', actorUserId: 'owner-1',
      method: 'third_party_manual', provider: null, deliveryFeeCents: 2500, note: null,
    }, store)).rejects.toThrow(/provider/i);
    expect(store.updateOrder).not.toHaveBeenCalled();
  });

  it('resolves an already-paid order without creating another payment link', async () => {
    const store = makeStore({
      loadOrder: jest.fn(async () => ({
        id: 'order-1', tenantId: 'tenant-1', externalCustomerRef: null,
        paymentStatus: 'paid', subtotalCents: 50_000, discountCents: 0, metadata: {},
      })),
    });

    await confirmRetailOrderFulfillment({
      tenantId: 'tenant-1', orderId: 'order-1', actorUserId: 'owner-1',
      method: 'customer_pickup', provider: null, deliveryFeeCents: 0, note: null,
    }, store);

    expect(store.createOrReusePaymentLink).not.toHaveBeenCalled();
    expect(store.resolveEscalation).toHaveBeenCalled();
  });
});
