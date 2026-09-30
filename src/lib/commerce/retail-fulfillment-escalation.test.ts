import { jest } from '@jest/globals';

import {
  createRetailFulfillmentEscalation,
  type RetailFulfillmentEscalationStore,
} from './retail-fulfillment-escalation';
import type { RetailOrderFulfillmentContext } from './retail-fulfillment';

const context: RetailOrderFulfillmentContext = {
  method: 'third_party_manual',
  provider: 'bolt',
  deliveryAddress: '12 Private Delivery Street',
  serviceArea: 'Lekki',
  feeStatus: 'quote_required',
  deliveryFeeCents: null,
  arrangementStatus: 'awaiting_human',
  conversationThreadId: 'thread-1',
};

function makeStore(overrides: Partial<RetailFulfillmentEscalationStore> = {}) {
  const store: RetailFulfillmentEscalationStore = {
    loadOrder: jest.fn(async () => ({
      id: 'order-1',
      tenantId: 'tenant-1',
      externalCustomerRef: '+2348000000000',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'unfulfilled',
    })),
    loadThread: jest.fn(async () => ({
      id: 'thread-1', channel: 'whatsapp', humanHandlingMode: null,
    })),
    findExisting: jest.fn(async () => null),
    insert: jest.fn(async (payload) => ({ id: 'escalation-1', status: 'pending', ...payload })),
    holdThreadUntilReleased: jest.fn(async () => undefined),
    ...overrides,
  };
  return store;
}

describe('retail fulfillment escalation', () => {
  it('creates a tenant-owned, order-scoped escalation with a bounded snapshot', async () => {
    const store = makeStore();

    const result = await createRetailFulfillmentEscalation({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      reasonCode: 'third_party_arrangement_required',
      context,
    }, store);

    expect(result.id).toBe('escalation-1');
    expect(store.loadOrder).toHaveBeenCalledWith('tenant-1', 'order-1');
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      retail_order_id: 'order-1',
      reason_code: 'retail_fulfillment',
      reason: 'Delivery arrangement needs a teammate',
      conversation_thread_id: 'thread-1',
      conversation_snapshot: {
        retailOrderId: 'order-1',
        orderStatus: 'pending_payment',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unfulfilled',
        fulfillment: {
          method: 'third_party_manual',
          provider: 'bolt',
          feeStatus: 'quote_required',
          arrangementStatus: 'awaiting_human',
        },
        reasonCode: 'third_party_arrangement_required',
      },
    }));
    const payload = (store.insert as jest.Mock).mock.calls[0]?.[0];
    expect(JSON.stringify(payload)).not.toContain('12 Private Delivery Street');
  });

  it('rejects an order or thread outside the tenant', async () => {
    const missingOrder = makeStore({ loadOrder: jest.fn(async () => null) });
    await expect(createRetailFulfillmentEscalation({
      tenantId: 'tenant-2', orderId: 'order-1', reasonCode: 'fulfillment_not_configured', context,
    }, missingOrder)).rejects.toThrow(/order was not found/i);

    const missingThread = makeStore({ loadThread: jest.fn(async () => null) });
    await expect(createRetailFulfillmentEscalation({
      tenantId: 'tenant-1', orderId: 'order-1', reasonCode: 'third_party_arrangement_required', context,
    }, missingThread)).rejects.toThrow(/thread was not found/i);
    expect(missingThread.insert).not.toHaveBeenCalled();
  });

  it('reuses the existing order escalation without adding another hold', async () => {
    const existing = { id: 'escalation-existing', status: 'pending' };
    const store = makeStore({
      findExisting: jest.fn(async () => existing),
      loadThread: jest.fn(async () => ({
        id: 'thread-1', channel: 'whatsapp', humanHandlingMode: 'until_released',
      })),
    });

    await expect(createRetailFulfillmentEscalation({
      tenantId: 'tenant-1', orderId: 'order-1', reasonCode: 'delivery_fee_requires_human', context,
    }, store)).resolves.toEqual(existing);
    expect(store.insert).not.toHaveBeenCalled();
    expect(store.holdThreadUntilReleased).not.toHaveBeenCalled();
  });

  it('repairs a missing thread hold when replay finds a durable escalation', async () => {
    const existing = { id: 'escalation-existing', status: 'pending' };
    const store = makeStore({ findExisting: jest.fn(async () => existing) });

    await createRetailFulfillmentEscalation({
      tenantId: 'tenant-1', orderId: 'order-1', reasonCode: 'delivery_fee_requires_human', context,
    }, store);

    expect(store.insert).not.toHaveBeenCalled();
    expect(store.holdThreadUntilReleased).toHaveBeenCalledTimes(1);
  });

  it('holds the verified thread until explicit release after durable insertion', async () => {
    const store = makeStore();

    await createRetailFulfillmentEscalation({
      tenantId: 'tenant-1', orderId: 'order-1', reasonCode: 'third_party_arrangement_required', context,
    }, store);

    expect(store.holdThreadUntilReleased).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      threadId: 'thread-1',
      externalId: '+2348000000000',
      channel: 'whatsapp',
    });
    expect((store.insert as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((store.holdThreadUntilReleased as jest.Mock).mock.invocationCallOrder[0]!);
  });

  it('allows a public order without a conversation thread', async () => {
    const store = makeStore({
      loadOrder: jest.fn(async () => ({
        id: 'order-1', tenantId: 'tenant-1', externalCustomerRef: null,
        status: 'draft', paymentStatus: 'unpaid', fulfillmentStatus: 'unfulfilled',
      })),
    });

    await createRetailFulfillmentEscalation({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      reasonCode: 'fulfillment_not_configured',
      context: { ...context, conversationThreadId: null },
    }, store);

    expect(store.loadThread).not.toHaveBeenCalled();
    expect(store.holdThreadUntilReleased).not.toHaveBeenCalled();
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({
      customer_phone: 'retail-order:order-1',
      conversation_thread_id: null,
    }));
  });
});
