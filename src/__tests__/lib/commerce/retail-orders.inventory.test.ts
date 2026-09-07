import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Guards the retail paid-path inventory model: it MUST go through the
// update_inventory() RPC (migration 117) and MUST NOT query a `product_inventory`
// table (which no migration creates — the earlier implementation threw on it).

const rpcMock = jest.fn(async () => ({
  data: [{ movement_id: 'mv-1', previous_quantity: 5, new_quantity: 3 }],
  error: null,
}));
const fromTables: string[] = [];

const paidOrder = {
  id: 'ord-1',
  tenant_id: 'tenant-1',
  status: 'pending_payment',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  total_cents: 185000,
  currency: 'NGN',
  external_customer_ref: '+2348000000000',
  cart_id: 'cart-1',
  metadata: {},
  items: [
    {
      product_id: 'prd-1',
      variant_id: null,
      quantity: 2,
      product: { id: 'prd-1', track_inventory: true },
    },
  ],
};

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'update', 'delete', 'insert', 'upsert']) {
    builder[method] = jest.fn(chain);
  }
  builder.maybeSingle = jest.fn(async () => ({
    data: table === 'retail_orders' ? paidOrder : null,
    error: null,
  }));
  builder.single = builder.maybeSingle;
  // Awaitable for `await admin.from(x).update(...).eq(...).eq(...)` chains.
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: null, error: null });
  return builder;
}

const adminMock = {
  from: jest.fn((table: string) => {
    fromTables.push(table);
    return makeBuilder(table);
  }),
  rpc: rpcMock,
};

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => adminMock,
}));

const mockUpdateChatJourney = jest.fn();
jest.mock('@/lib/chats/journey-service', () => ({
  updateChatJourneyByExternalId: (...args: unknown[]) => mockUpdateChatJourney(...args),
}));

jest.mock('@/lib/paymentsAdapter', () => ({ PaymentsAdapter: jest.fn() }));

const mockRecordAttribution = jest.fn();
jest.mock('@/lib/sias-operations', () => ({
  siasOperations: { recordOutcomeAttribution: (...args: unknown[]) => mockRecordAttribution(...args) },
}));

import { transitionRetailOrder } from '@/lib/commerce/retail-orders';

describe('retail order inventory on mark_paid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fromTables.length = 0;
    mockUpdateChatJourney.mockResolvedValue(undefined);
    mockRecordAttribution.mockResolvedValue(undefined);
  });

  it('decrements stock via the update_inventory RPC and never queries product_inventory', async () => {
    await transitionRetailOrder({
      tenantId: 'tenant-1',
      orderId: 'ord-1',
      actorUserId: 'user-9',
      action: 'mark_paid',
    });

    // Canonical path: the RPC, with a negative quantity change for a sale.
    expect(rpcMock).toHaveBeenCalledWith(
      'update_inventory',
      expect.objectContaining({
        p_tenant_id: 'tenant-1',
        p_product_id: 'prd-1',
        p_quantity_change: -2,
        p_movement_type: 'sale',
        p_reference_type: 'retail_order',
        p_reference_id: 'ord-1',
        p_performed_by: 'user-9',
      }),
    );

    // Regression guard: the phantom table must never be touched.
    expect(fromTables).not.toContain('product_inventory');
  });

  it('attributes the realized sale to sias_outcome_attributions on mark_paid', async () => {
    await transitionRetailOrder({
      tenantId: 'tenant-1',
      orderId: 'ord-1',
      actorUserId: 'user-9',
      action: 'mark_paid',
    });

    expect(mockRecordAttribution).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        signal: 'retail_sale',
        sourceEvent: 'frontdesk.retail.paid',
        value: 1,
        attributionType: 'processed',
        verificationStatus: 'merchant_confirmed',
        amountCents: 185000,
        currency: 'NGN',
        evidenceType: 'retail_order_marked_paid',
        verifiedBy: 'user-9',
        customerPhone: '+2348000000000',
        metadata: expect.objectContaining({ retail_order_id: 'ord-1', product_ids: ['prd-1'] }),
      }),
    );
  });
});
