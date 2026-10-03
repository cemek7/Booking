import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateServerSupabaseClient = jest.fn();
const mockCreateSupabaseAdminClient = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
  createSupabaseAdminClient: mockCreateSupabaseAdminClient,
}));

const mockRecordFrontDeskEvent = jest.fn();
jest.mock('@/lib/ai/front-desk-events', () => ({
  recordFrontDeskEvent: (...args: unknown[]) => mockRecordFrontDeskEvent(...args),
}));

const mockRecordAttribution = jest.fn();
jest.mock('@/lib/sias-operations', () => ({
  siasOperations: { recordOutcomeAttribution: (...args: unknown[]) => mockRecordAttribution(...args) },
}));

const mockTransitionRetailOrder = jest.fn();
const mockGetRetailOrderById = jest.fn();
jest.mock('@/lib/commerce/retail-orders', () => ({
  transitionRetailOrder: (...args: unknown[]) => mockTransitionRetailOrder(...args),
  getRetailOrderById: (...args: unknown[]) => mockGetRetailOrderById(...args),
}));

const mockCreateFulfillmentEscalation = jest.fn();
jest.mock('@/lib/commerce/retail-fulfillment-escalation', () => ({
  createRetailFulfillmentEscalation: (...args: unknown[]) => mockCreateFulfillmentEscalation(...args),
}));

const mockRecordBusinessMetric = jest.fn();
jest.mock('@/lib/observability', () => ({
  observability: { recordBusinessMetric: (...args: unknown[]) => mockRecordBusinessMetric(...args) },
}));

const mockGetConversation = jest.fn();
const mockUpdateConversation = jest.fn();
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
}));

const mockSendTextMessage = jest.fn();
const mockGetTenantChannelProviderClient = jest.fn();
const mockGetTenantWhatsAppProviderClient = jest.fn();
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantChannelProviderClient: (...args: unknown[]) => mockGetTenantChannelProviderClient(...args),
  getTenantWhatsAppProviderClient: (...args: unknown[]) => mockGetTenantWhatsAppProviderClient(...args),
}));

const mockSendGovernedInitiated = jest.fn();
jest.mock('@/lib/whatsapp/v2/deliverability/governedSend', () => ({
  sendGovernedInitiated: (...args: unknown[]) => mockSendGovernedInitiated(...args),
}));

const mockBrandCustomerText = jest.fn();
jest.mock('@/lib/whatsapp/v2/outboundBranding', () => ({
  brandCustomerText: (...args: unknown[]) => mockBrandCustomerText(...args),
}));

jest.mock('@/lib/eventbus/eventBus', () => ({
  getEventBus: () => ({ publishEvent: jest.fn(async () => undefined) }),
}));

import {
  handlePaymentFailure,
  handlePaymentRefund,
  handlePaymentSuccess,
} from '@/lib/payments/lifecycle';

type AdminSeed = {
  txRaw?: Record<string, unknown> | null;
  order?: Record<string, unknown> | null;
  tenantSettings?: Record<string, unknown>;
  reservation?: Record<string, unknown> | null;
};

/**
 * Service-client fake for the webhook-driven lifecycle (A2). Every builder
 * method chains; terminal reads resolve per table. Records filters and writes.
 */
function makeAdmin(seed: AdminSeed = {}) {
  const writes: Array<{ table: string; op: string; payload: unknown; filters: Array<[string, string, unknown]> }> = [];
  const from = jest.fn((table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let op = 'select';
    let payload: unknown = null;
    const chain: Record<string, unknown> = {};
    const read = () => {
      if (table === 'transactions') {
        return seed.txRaw === null ? null : { amount: 1850, currency: 'NGN', raw: seed.txRaw ?? {
          retail_order_id: 'ord-1', external_customer_ref: '+2348000000000', channel: 'instagram',
        } };
      }
      if (table === 'retail_orders') {
        return seed.order === null ? null : {
          id: 'ord-1', tenant_id: 'tenant-1', total_cents: 185000, payment_status: 'pending_payment',
          external_customer_ref: '+2348000000000', currency: 'NGN',
          metadata: { payment: { channel: 'instagram', reference: 'ref-latest' } },
          ...(seed.order ?? {}),
        };
      }
      if (table === 'tenants') return { settings: seed.tenantSettings ?? {}, name: 'Biz', metadata: {} };
      if (table === 'reservations') return seed.reservation ?? null;
      return null;
    };
    const settle = () => {
      if (op !== 'select') writes.push({ table, op, payload, filters: [...filters] });
      return { data: op === 'select' ? read() : (op === 'update' && table === 'reservations' ? (seed.reservation ?? null) : null), error: null };
    };
    for (const m of ['select', 'order', 'limit']) chain[m] = jest.fn(() => chain);
    for (const m of ['eq', 'neq', 'not', 'in']) {
      chain[m] = jest.fn((c: string, v: unknown, w?: unknown) => { filters.push([m, c, w ?? v]); return chain; });
    }
    chain.update = jest.fn((p: unknown) => { op = 'update'; payload = p; return chain; });
    chain.insert = jest.fn((p: unknown) => { op = 'insert'; payload = p; return chain; });
    chain.maybeSingle = jest.fn(async () => settle());
    chain.single = jest.fn(async () => settle());
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej);
    return chain;
  });
  return { client: { from }, from, writes };
}

describe('retail payment lifecycle helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A2: the anon/cookie client must never be used by webhook-driven code.
    mockCreateServerSupabaseClient.mockImplementation(() => { throw new Error('anon client used in webhook context'); });
    mockCreateSupabaseAdminClient.mockReturnValue(makeAdmin().client);
    mockTransitionRetailOrder.mockResolvedValue({ id: 'ord-1', total_cents: 185000 });
    mockGetRetailOrderById.mockResolvedValue({ id: 'ord-1', total_cents: 185000 });
    mockGetConversation.mockResolvedValue({
      current_flow: 'managing',
      flow_data: { sales_journey: { stage: 'draft_order' }, retail_order: { order_id: 'ord-1' } },
    });
    mockUpdateConversation.mockResolvedValue(undefined);
    mockGetTenantChannelProviderClient.mockResolvedValue({
      sendTextMessage: mockSendTextMessage,
    });
    mockGetTenantWhatsAppProviderClient.mockResolvedValue({
      sendTextMessage: mockSendTextMessage,
      sendTemplateMessage: jest.fn(),
    });
    mockSendGovernedInitiated.mockResolvedValue({ sent: true, mode: 'freeform', reason: 'sent' });
    mockBrandCustomerText.mockResolvedValue('branded text');
    mockSendTextMessage.mockResolvedValue({ success: true, messageId: 'msg-1' });
    mockRecordFrontDeskEvent.mockResolvedValue(undefined);
    mockRecordAttribution.mockResolvedValue(undefined);
    mockCreateFulfillmentEscalation.mockResolvedValue({ id: 'esc-1', status: 'pending' });
    mockRecordBusinessMetric.mockResolvedValue(undefined);
    delete process.env.BOOKA_RETAIL_FULFILLMENT_MODE;
  });

  it('records a provider-verified processed amount for a paid reservation', async () => {
    const admin = makeAdmin();
    mockCreateSupabaseAdminClient.mockReturnValue(admin.client);

    await handlePaymentSuccess({
      tenantId: 'tenant-1',
      reference: 'ref-booking-1',
      provider: 'paystack',
      reservationId: 'booking-1',
      amountMinor: 4500000,
      currency: 'ngn',
    });

    expect(mockRecordAttribution).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      reservationId: 'booking-1',
      sourceEvent: 'payment.paystack.completed',
      attributionType: 'processed',
      verificationStatus: 'system_verified',
      amountCents: 4500000,
      currency: 'NGN',
      evidenceType: 'payment_completed',
    }));
    // A2: reservation confirmed through the service client, tenant-bound.
    const resUpdate = admin.writes.find((w) => w.table === 'reservations' && w.op === 'update');
    expect(resUpdate?.payload).toEqual({ status: 'confirmed' });
    expect(resUpdate?.filters).toEqual(expect.arrayContaining([['eq', 'id', 'booking-1'], ['eq', 'tenant_id', 'tenant-1']]));
  });

  it('marks a retail order paid and notifies the customer on payment success', async () => {
    await expect(
      handlePaymentSuccess({
        tenantId: 'tenant-1',
        reference: 'ref-retail-1',
        provider: 'paystack',
      }),
    ).resolves.toBeUndefined();

    expect(mockTransitionRetailOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        orderId: 'ord-1',
        action: 'mark_paid',
      }),
    );
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      '+2348000000000',
      'tenant-1',
      expect.objectContaining({
        flow_data: expect.objectContaining({
          sales_journey: expect.objectContaining({ stage: 'paid' }),
          retail_order: expect.objectContaining({ payment_status: 'paid' }),
        }),
      }),
      'instagram',
    );
    expect(mockGetTenantChannelProviderClient).toHaveBeenCalledWith('tenant-1', 'instagram');
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      '+2348000000000',
      expect.stringContaining('Payment received'),
    );
  });

  it('keeps payment truth and hands unresolved paid delivery to a human before sending the receipt', async () => {
    process.env.BOOKA_RETAIL_FULFILLMENT_MODE = 'live';
    const lifecycleAdmin = makeAdmin({ tenantSettings: {
      rollouts: { retailFulfillment: 'live' },
      retailFulfillment: { methods: ['third_party_manual'], thirdPartyProviders: ['bolt'], serviceAreas: [], feePolicy: 'manual' },
    } }).client;
    mockCreateSupabaseAdminClient.mockReturnValue(lifecycleAdmin);
    mockTransitionRetailOrder.mockResolvedValue({
      id: 'ord-1', tenant_id: 'tenant-1', total_cents: 185000, payment_status: 'paid',
      status: 'paid', fulfillment_status: 'unfulfilled', external_customer_ref: '+2348000000000',
      metadata: { retailFulfillment: {
        method: 'third_party_manual', provider: 'bolt', deliveryAddress: 'Private address', serviceArea: null,
        feeStatus: 'quote_required', deliveryFeeCents: null, arrangementStatus: 'not_started',
        conversationThreadId: null,
      } },
    });

    await handlePaymentSuccess({ tenantId: 'tenant-1', reference: 'ref-paid-unresolved', provider: 'paystack' });

    expect(mockTransitionRetailOrder).toHaveBeenCalledWith(expect.objectContaining({ action: 'mark_paid' }));
    expect(mockCreateFulfillmentEscalation).toHaveBeenCalledTimes(1);
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      '+2348000000000', 'tenant-1',
      expect.objectContaining({ flow_data: expect.objectContaining({
        sales_journey: expect.objectContaining({ stage: 'awaiting_fulfillment_handoff' }),
      }) }),
      'instagram',
    );
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      '+2348000000000',
      expect.stringMatching(/payment received.*teammate.*delivery/i),
    );
    expect(mockSendTextMessage).not.toHaveBeenCalledWith(
      '+2348000000000',
      expect.stringContaining('order is now confirmed'),
    );
  });

  it('observes unresolved post-payment fulfillment in shadow without creating a handoff', async () => {
    process.env.BOOKA_RETAIL_FULFILLMENT_MODE = 'shadow';
    const shadowAdmin = makeAdmin({ tenantSettings: {
      retailFulfillment: {
        methods: ['third_party_manual'], thirdPartyProviders: ['bolt'], serviceAreas: ['Lekki'], feePolicy: 'manual',
      },
    } });
    mockCreateSupabaseAdminClient.mockReturnValue(shadowAdmin.client);
    mockTransitionRetailOrder.mockResolvedValue({
      id: 'ord-1', tenant_id: 'tenant-1', total_cents: 185000, payment_status: 'paid',
      status: 'paid', fulfillment_status: 'unfulfilled', external_customer_ref: '+2348000000000',
      metadata: { retailFulfillment: {
        method: 'third_party_manual', provider: 'bolt', deliveryAddress: 'Private address', serviceArea: 'Lekki',
        feeStatus: 'quote_required', deliveryFeeCents: null, arrangementStatus: 'not_started',
        arrangementNote: 'Private note', conversationThreadId: null,
      } },
    });

    await handlePaymentSuccess({ tenantId: 'tenant-1', reference: 'ref-shadow', provider: 'paystack' });

    expect(mockCreateFulfillmentEscalation).not.toHaveBeenCalled();
    expect(shadowAdmin.writes.filter((w) => w.table === 'retail_orders')).toHaveLength(0);
    expect(mockRecordBusinessMetric).toHaveBeenCalledWith(
      'retail_fulfillment_decision_total',
      1,
      {
        mode: 'shadow',
        surface: 'payment_webhook',
        status: 'awaiting_human',
        reason: 'third_party_arrangement_required',
        provider: 'bolt',
      },
    );
    expect(JSON.stringify(mockRecordBusinessMetric.mock.calls)).not.toMatch(
      /Private address|2348000000000|Private note|185000|ref-shadow/,
    );
  });

  it('marks a retail order payment as failed and keeps the order in draft state', async () => {
    await expect(
      handlePaymentFailure({
        tenantId: 'tenant-1',
        reference: 'ref-retail-2',
        provider: 'paystack',
        reason: 'insufficient_funds',
      }),
    ).resolves.toBeUndefined();

    expect(mockTransitionRetailOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        action: 'mark_payment_failed',
      }),
    );
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      '+2348000000000',
      expect.stringContaining('didn’t go through'),
    );
  });

  it('routes a WhatsApp retail payment receipt through the governed send path', async () => {
    mockCreateSupabaseAdminClient.mockReturnValue(makeAdmin({ txRaw: {
      retail_order_id: 'ord-1', external_customer_ref: '+2348000000000', channel: 'whatsapp',
    } }).client);
    mockGetConversation.mockResolvedValue({
      current_flow: 'managing',
      flow_data: {},
      last_inbound_at: new Date().toISOString(),
      opted_out_at: null,
    });

    await handlePaymentSuccess({ tenantId: 'tenant-1', reference: 'ref-whatsapp-receipt', provider: 'paystack' });

    expect(mockSendGovernedInitiated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        recipient: '+2348000000000',
        messageType: 'payment_receipt',
      }),
    );
    expect(mockGetTenantChannelProviderClient).not.toHaveBeenCalledWith('tenant-1', 'whatsapp');
  });

  it('marks a retail order refunded and notifies the customer', async () => {
    await expect(
      handlePaymentRefund({
        tenantId: 'tenant-1',
        reference: 'ref-retail-3',
        provider: 'paystack',
      }),
    ).resolves.toBeUndefined();

    expect(mockTransitionRetailOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        action: 'mark_refunded',
      }),
    );
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      '+2348000000000',
      expect.stringContaining('refunded'),
    );
  });

  describe('settled subject routing (A1) and stale/double payment guards (B3)', () => {
    const settled = (over: Record<string, unknown> = {}) => ({
      tenantId: 'tenant-1', reference: 'bk_paid', provider: 'paystack' as const, reservationId: null,
      subjectType: 'retail_order' as const, subjectId: 'ord-1', amountMinor: 185000, currency: 'NGN', ...over,
    });

    it('resolves the order by subject_id even when transactions.raw has no retail fields', async () => {
      const admin = makeAdmin({ txRaw: { provider: 'paystack', ref: 'bk_paid', email: 'a@b.co', subject: { type: 'retail_order', id: 'ord-1' } } });
      mockCreateSupabaseAdminClient.mockReturnValue(admin.client);
      await handlePaymentSuccess(settled());
      expect(mockTransitionRetailOrder).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-1', orderId: 'ord-1', action: 'mark_paid', paymentReference: 'bk_paid',
      }));
      expect(admin.from).not.toHaveBeenCalledWith('transactions');
      // Channel comes from retail_orders.metadata.payment.channel.
      expect(mockGetTenantChannelProviderClient).toHaveBeenCalledWith('tenant-1', 'instagram');
    });

    it('defaults the channel to whatsapp when the order metadata has none', async () => {
      mockCreateSupabaseAdminClient.mockReturnValue(makeAdmin({ order: { metadata: {} } }).client);
      mockGetConversation.mockResolvedValue({ current_flow: 'managing', flow_data: {}, last_inbound_at: new Date().toISOString(), opted_out_at: null });
      await handlePaymentSuccess(settled());
      expect(mockSendGovernedInitiated).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipient: '+2348000000000' }));
    });

    it('an underpaid older checkout is not marked paid and opens a settlement escalation', async () => {
      const admin = makeAdmin();
      mockCreateSupabaseAdminClient.mockReturnValue(admin.client);
      await handlePaymentSuccess(settled({ amountMinor: 150000 }));
      expect(mockTransitionRetailOrder).not.toHaveBeenCalled();
      const esc = admin.writes.filter((w) => w.table === 'escalation_queue');
      expect(esc).toHaveLength(1);
      expect(esc[0].payload).toMatchObject({
        tenant_id: 'tenant-1', reason_code: 'payment_settlement', session_id: 'settlement:bk_paid',
        customer_phone: '+2348000000000', retail_order_id: 'ord-1', status: 'pending',
      });
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });

    it('an exact payment marks the order paid with no escalation', async () => {
      const admin = makeAdmin();
      mockCreateSupabaseAdminClient.mockReturnValue(admin.client);
      await handlePaymentSuccess(settled({ amountMinor: 185000 }));
      expect(mockTransitionRetailOrder).toHaveBeenCalledTimes(1);
      expect(admin.writes.filter((w) => w.table === 'escalation_queue')).toHaveLength(0);
    });

    it('a second verified payment for an already-paid order escalates as a possible double payment', async () => {
      const admin = makeAdmin({ order: { payment_status: 'paid', external_customer_ref: null, metadata: { paidReference: 'bk_first' } } });
      mockCreateSupabaseAdminClient.mockReturnValue(admin.client);
      await handlePaymentSuccess(settled({ reference: 'bk_second' }));
      expect(mockTransitionRetailOrder).not.toHaveBeenCalled();
      const esc = admin.writes.filter((w) => w.table === 'escalation_queue');
      expect(esc).toHaveLength(1);
      expect(esc[0].payload).toMatchObject({ session_id: 'settlement:bk_second', customer_phone: 'retail-order:ord-1', reason_code: 'payment_settlement' });
    });

    it('a re-delivery of the payment that already marked the order paid is a no-op', async () => {
      const admin = makeAdmin({ order: { payment_status: 'paid', metadata: { paidReference: 'bk_paid' } } });
      mockCreateSupabaseAdminClient.mockReturnValue(admin.client);
      await handlePaymentSuccess(settled());
      expect(mockTransitionRetailOrder).not.toHaveBeenCalled();
      expect(admin.writes.filter((w) => w.table === 'escalation_queue')).toHaveLength(0);
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });

    it('failure and refund for a settled retail subject route by subject_id', async () => {
      mockCreateSupabaseAdminClient.mockReturnValue(makeAdmin({ txRaw: {} }).client);
      await handlePaymentFailure(settled({ reason: 'Declined' }));
      expect(mockTransitionRetailOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ord-1', action: 'mark_payment_failed' }));
      await handlePaymentRefund(settled());
      expect(mockTransitionRetailOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ord-1', action: 'mark_refunded', paymentReference: 'bk_paid' }));
    });
  });
});
