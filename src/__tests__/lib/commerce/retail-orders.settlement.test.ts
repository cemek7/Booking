import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// (settlement) Guards the retail paid-path inventory model: it MUST go through the
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

import { createRetailOrderPaymentLink } from '@/lib/commerce/retail-orders';

const readyOrder = {
  ...paidOrder,
  payment_status: 'unpaid',
  status: 'draft',
  total_cents: 750000,
  subtotal_cents: 750000,
  discount_cents: 0,
  delivery_fee_cents: 0,
  customer: { email: 'buyer@test.com', phone: '+2348000000000', name: 'Buyer' },
};
const input = { tenantId: 'tenant-1', orderId: 'ord-1', actorUserId: 'user-1', channel: 'whatsapp' as const };
const okResult = {
  ok: true, transactionId: 'tx-1', reference: 'bk_ref_1', authorizationUrl: 'https://pay.test/1', snapshot: {}, reused: false,
};
const pendingUpdates = () => updatePayloads.filter(({ table, payload }) => table === 'retail_orders' && payload.status === 'pending_payment');

describe('retail payment link settlement boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fromTables.length = 0;
    updatePayloads.length = 0;
    currentOrder = readyOrder;
    currentTenant = { metadata: { paystack_subaccount_code: 'ACCT_LEGACY' }, settings: {} };
    mockInitializeTenantPayment.mockResolvedValue(okResult);
    mockCreateFulfillmentEscalation.mockResolvedValue({ id: 'esc-1', status: 'pending' });
    mockUpdateChatJourney.mockResolvedValue(undefined);
    mockRecordBusinessMetric.mockResolvedValue(undefined);
    delete process.env.BOOKA_RETAIL_FULFILLMENT_MODE;
  });

  it('settles a ready order in integer minor units with a per-amount idempotency key', async () => {
    const result = await createRetailOrderPaymentLink(input);
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      amountMinor: 750000,
      currency: 'NGN',
      customerEmail: 'buyer@test.com',
      subject: { type: 'retail_order', id: 'ord-1' },
      idempotencyKey: 'retail_order:ord-1:750000',
    }));
    expect(JSON.stringify(mockInitializeTenantPayment.mock.calls)).not.toContain('ACCT_LEGACY');
    expect(result).toMatchObject({ reference: 'bk_ref_1', paymentUrl: 'https://pay.test/1', totalCents: 750000 });
    expect(pendingUpdates()).toHaveLength(1);
  });

  it('does not write a transactions row itself (the boundary does)', async () => {
    await createRetailOrderPaymentLink(input);
    expect(fromTables).not.toContain('transactions');
  });

  it('keeps the fulfilment gate ahead of settlement', async () => {
    process.env.BOOKA_RETAIL_FULFILLMENT_MODE = 'live';
    currentOrder = { ...readyOrder, metadata: {} };
    currentTenant = { metadata: {}, settings: { rollouts: { retailFulfillment: 'live' } } };
    await expect(createRetailOrderPaymentLink(input)).rejects.toThrow(/delivery arrangement needs a teammate/i);
    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
  });

  it('throws the customer message and leaves the order untouched when settlement fails', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED', message: 'x' });
    await expect(createRetailOrderPaymentLink(input)).rejects.toThrow(
      'Online payment is not available for this business right now.',
    );
    expect(pendingUpdates()).toHaveLength(0);
  });

  it('throws when the order has no customer email', async () => {
    currentOrder = { ...readyOrder, customer: { email: null, phone: '+2348000000000' } };
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'CUSTOMER_EMAIL_REQUIRED', message: 'x' });
    await expect(createRetailOrderPaymentLink(input)).rejects.toThrow(/customer email/i);
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({ customerEmail: '' }));
    expect(pendingUpdates()).toHaveLength(0);
  });

  it('asks for a replacement link when the boundary reports an idempotency conflict', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'IDEMPOTENCY_CONFLICT', message: 'x' });
    await expect(createRetailOrderPaymentLink(input)).rejects.toThrow(/create a replacement/i);
    expect(pendingUpdates()).toHaveLength(0);
  });

  it('uses a new idempotency key when the total changes', async () => {
    currentOrder = { ...readyOrder, total_cents: 800000, subtotal_cents: 800000 };
    await createRetailOrderPaymentLink(input);
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 800000,
      idempotencyKey: 'retail_order:ord-1:800000',
    }));
  });
});
