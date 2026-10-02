import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Guards the retail paid-path inventory model: it MUST go through the
// update_inventory() RPC (migration 117) and MUST NOT query a `product_inventory`
// table (which no migration creates — the earlier implementation threw on it).

const rpcMock = jest.fn(async () => ({
  data: [{ movement_id: 'mv-1', previous_quantity: 5, new_quantity: 3 }],
  error: null,
}));
const fromTables: string[] = [];
const updatePayloads: Array<{ table: string; payload: Record<string, unknown> }> = [];
const mockInitializeTenantPayment = jest.fn();
const mockCreateFulfillmentEscalation = jest.fn();
const mockRecordBusinessMetric = jest.fn();

jest.mock('@/lib/observability', () => ({
  observability: { recordBusinessMetric: (...args: unknown[]) => mockRecordBusinessMetric(...args) },
}));

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

let currentOrder: Record<string, unknown> = paidOrder;
let currentTenant: Record<string, unknown> = { metadata: {}, settings: {} };

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'delete', 'insert', 'upsert']) {
    builder[method] = jest.fn(chain);
  }
  builder.update = jest.fn((payload: Record<string, unknown>) => {
    updatePayloads.push({ table, payload });
    return builder;
  });
  builder.maybeSingle = jest.fn(async () => ({
    data: table === 'retail_orders'
      ? currentOrder
      : table === 'tenants'
        ? currentTenant
        : null,
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

jest.mock('@/lib/payments/tenantSettlement', () => ({
  initializeTenantPayment: (...args: unknown[]) => mockInitializeTenantPayment(...args),
  SETTLEMENT_CUSTOMER_MESSAGE: 'Online payment is not available for this business right now.',
}));

jest.mock('@/lib/commerce/retail-fulfillment-escalation', () => ({
  createRetailFulfillmentEscalation: (...args: unknown[]) => mockCreateFulfillmentEscalation(...args),
}));

const mockRecordAttribution = jest.fn();
jest.mock('@/lib/sias-operations', () => ({
  siasOperations: { recordOutcomeAttribution: (...args: unknown[]) => mockRecordAttribution(...args) },
}));

import { createRetailOrderPaymentLink, transitionRetailOrder } from '@/lib/commerce/retail-orders';

describe('retail order inventory on mark_paid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fromTables.length = 0;
    updatePayloads.length = 0;
    currentOrder = paidOrder;
    currentTenant = { metadata: {}, settings: {} };
    mockInitializeTenantPayment.mockResolvedValue({
      ok: true, transactionId: 'tx', reference: 'bk_x', authorizationUrl: 'https://pay', snapshot: {}, reused: false,
    });
    mockCreateFulfillmentEscalation.mockResolvedValue({ id: 'esc-1', status: 'pending' });
    mockUpdateChatJourney.mockResolvedValue(undefined);
    mockRecordAttribution.mockResolvedValue(undefined);
    mockRecordBusinessMetric.mockResolvedValue(undefined);
    delete process.env.BOOKA_RETAIL_FULFILLMENT_MODE;
  });

  it('blocks a live unconfigured tenant before Paystack and creates one fulfillment handoff', async () => {
    process.env.BOOKA_RETAIL_FULFILLMENT_MODE = 'live';
    currentOrder = {
      ...paidOrder,
      payment_status: 'unpaid',
      status: 'draft',
      subtotal_cents: 185000,
      discount_cents: 0,
      delivery_fee_cents: 0,
      metadata: {},
    };
    currentTenant = {
      metadata: {},
      settings: { rollouts: { retailFulfillment: 'live' } },
    };

    await expect(createRetailOrderPaymentLink({
      tenantId: 'tenant-1', orderId: 'ord-1', actorUserId: 'user-1', channel: 'whatsapp',
    })).rejects.toThrow(/delivery arrangement needs a teammate/i);

    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
    expect(mockCreateFulfillmentEscalation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', orderId: 'ord-1', reasonCode: 'fulfillment_not_configured',
    }));
    expect(mockUpdateChatJourney).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ stage: 'awaiting_fulfillment_handoff' }),
    }));
  });

  it('observes an unselected shadow tenant without fulfillment mutations or handoff', async () => {
    process.env.BOOKA_RETAIL_FULFILLMENT_MODE = 'shadow';
    currentOrder = {
      ...paidOrder,
      payment_status: 'unpaid',
      status: 'draft',
      subtotal_cents: 185000,
      discount_cents: 0,
      delivery_fee_cents: 0,
      metadata: {
        retailFulfillment: {
          method: 'third_party_manual', provider: 'bolt', deliveryAddress: 'Private address',
          serviceArea: 'Lekki', feeStatus: 'quote_required', deliveryFeeCents: null,
          arrangementStatus: 'not_started', arrangementNote: 'Private note', conversationThreadId: null,
        },
      },
    };
    currentTenant = {
      metadata: {},
      settings: {
        retailFulfillment: {
          methods: ['third_party_manual'], thirdPartyProviders: ['bolt'], serviceAreas: ['Lekki'],
          feePolicy: 'manual',
        },
      },
    };

    await createRetailOrderPaymentLink({
      tenantId: 'tenant-1', orderId: 'ord-1', actorUserId: 'user-1', channel: 'whatsapp',
    });

    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 185000,
    }));
    expect(mockCreateFulfillmentEscalation).not.toHaveBeenCalled();
    expect(mockUpdateChatJourney).not.toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ stage: expect.stringMatching(/fulfillment/) }),
    }));
    expect(updatePayloads.some(({ payload }) => (
      'delivery_fee_cents' in payload
      || 'total_cents' in payload
      || JSON.stringify(payload).includes('awaiting_human')
    ))).toBe(false);
    expect(mockRecordBusinessMetric).toHaveBeenCalledWith(
      'retail_fulfillment_decision_total',
      1,
      {
        mode: 'shadow',
        surface: 'payment_link',
        status: 'awaiting_human',
        reason: 'third_party_arrangement_required',
        provider: 'bolt',
      },
    );
    expect(JSON.stringify(mockRecordBusinessMetric.mock.calls)).not.toMatch(
      /Private address|2348000000000|Private note|185000/,
    );
  });

  it('applies a known fixed fee exactly once before creating the payment link', async () => {
    process.env.BOOKA_RETAIL_FULFILLMENT_MODE = 'live';
    currentOrder = {
      ...paidOrder,
      payment_status: 'unpaid',
      status: 'draft',
      subtotal_cents: 185000,
      total_cents: 185000,
      discount_cents: 0,
      delivery_fee_cents: 0,
      metadata: {
        retailFulfillment: {
          method: 'own_dispatch', provider: null, deliveryAddress: 'Lekki Phase 1',
          serviceArea: 'Lekki', feeStatus: 'not_required', deliveryFeeCents: null,
          arrangementStatus: 'not_started', conversationThreadId: null,
        },
      },
    };
    currentTenant = {
      metadata: { paystack_subaccount_code: 'ACCT_1' },
      settings: {
        rollouts: { retailFulfillment: 'live' },
        retailFulfillment: {
          methods: ['own_dispatch'], thirdPartyProviders: [], serviceAreas: ['Lekki'],
          feePolicy: 'fixed', fixedFeeCents: 2500,
        },
      },
    };

    await createRetailOrderPaymentLink({
      tenantId: 'tenant-1', orderId: 'ord-1', actorUserId: 'user-1', channel: 'whatsapp',
    });

    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 187500,
    }));
    expect(updatePayloads).toContainEqual(expect.objectContaining({
      table: 'retail_orders',
      payload: expect.objectContaining({ delivery_fee_cents: 2500, total_cents: 187500 }),
    }));
    expect(mockCreateFulfillmentEscalation).not.toHaveBeenCalled();
  });

  it('reuses only a payment link bound to the current fulfillment-aware total', async () => {
    process.env.BOOKA_RETAIL_FULFILLMENT_MODE = 'live';
    currentOrder = {
      ...paidOrder,
      payment_status: 'pending',
      status: 'pending_payment',
      subtotal_cents: 185000,
      total_cents: 187500,
      discount_cents: 0,
      delivery_fee_cents: 2500,
      metadata: {
        retailFulfillment: {
          method: 'own_dispatch', provider: null, deliveryAddress: 'Lekki Phase 1',
          serviceArea: 'Lekki', feeStatus: 'known', deliveryFeeCents: 2500,
          arrangementStatus: 'arranged', conversationThreadId: null,
        },
        payment: {
          provider: 'paystack', reference: 'pay-existing', url: 'https://pay.test/existing',
          amountCents: 187500,
        },
      },
    };
    currentTenant = {
      metadata: {},
      settings: {
        rollouts: { retailFulfillment: 'live' },
        retailFulfillment: {
          methods: ['own_dispatch'], thirdPartyProviders: [], serviceAreas: ['Lekki'],
          feePolicy: 'fixed', fixedFeeCents: 2500,
        },
      },
    };

    mockInitializeTenantPayment.mockResolvedValue({
      ok: true, transactionId: 'tx-live', reference: 'bk_live', authorizationUrl: 'https://pay/live', snapshot: {}, reused: true,
    });
    const result = await createRetailOrderPaymentLink({
      tenantId: 'tenant-1', orderId: 'ord-1', actorUserId: 'user-1', channel: 'whatsapp',
    });
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 187500,
      idempotencyKey: 'retail_order:ord-1:187500',
    }));
    // The boundary's checkout is returned; the legacy metadata link is not.
    expect(result).toMatchObject({ reference: 'bk_live', paymentUrl: 'https://pay/live', totalCents: 187500 });
    expect(result.reference).not.toBe('pay-existing');
    expect(result.paymentUrl).not.toBe('https://pay.test/existing');
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
