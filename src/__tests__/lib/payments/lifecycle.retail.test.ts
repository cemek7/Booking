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

function makeSupabaseForRetailTx() {
  return {
    from: jest.fn((table: string) => {
      if (table === 'transactions') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(async () => ({
                  data: {
                    amount: 1850,
                    currency: 'NGN',
                    raw: {
                      retail_order_id: 'ord-1',
                      external_customer_ref: '+2348000000000',
                      channel: 'instagram',
                    },
                  },
                  error: null,
                })),
              })),
            })),
          })),
        };
      }

      return {
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      };
    }),
  };
}

describe('retail payment lifecycle helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateServerSupabaseClient.mockReturnValue(makeSupabaseForRetailTx());
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
    const reservationBuilder: Record<string, jest.Mock> = {};
    const reservationChain = () => reservationBuilder;
    for (const method of ['update', 'eq', 'not', 'select']) {
      reservationBuilder[method] = jest.fn(reservationChain);
    }
    reservationBuilder.maybeSingle = jest.fn(async () => ({ data: null, error: null }));

    const transactionBuilder: Record<string, jest.Mock> = {};
    const transactionChain = () => transactionBuilder;
    for (const method of ['update', 'eq']) {
      transactionBuilder[method] = jest.fn(transactionChain);
    }
    transactionBuilder.then = jest.fn((resolve) => resolve({ data: null, error: null }));

    mockCreateServerSupabaseClient.mockReturnValue({
      from: jest.fn((table: string) => table === 'reservations' ? reservationBuilder : transactionBuilder),
    });

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
    const lifecycleAdmin = {
      from: jest.fn((table: string) => {
        if (table === 'tenants') {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn(async () => ({
            data: { settings: {
              rollouts: { retailFulfillment: 'live' },
              retailFulfillment: { methods: ['third_party_manual'], thirdPartyProviders: ['bolt'], serviceAreas: [], feePolicy: 'manual' },
            } }, error: null,
          })) })) })) };
        }
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })) })) };
      }),
    };
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
    const adminFrom = jest.fn((table: string) => {
      if (table === 'tenants') {
        return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn(async () => ({
          data: { settings: {
            retailFulfillment: {
              methods: ['third_party_manual'], thirdPartyProviders: ['bolt'], serviceAreas: ['Lekki'], feePolicy: 'manual',
            },
          } }, error: null,
        })) })) })) };
      }
      return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })) })) };
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from: adminFrom });
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
    expect(adminFrom).not.toHaveBeenCalledWith('retail_orders');
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
    mockCreateServerSupabaseClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'transactions') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  maybeSingle: jest.fn(async () => ({
                    data: {
                      amount: 1850,
                      currency: 'NGN',
                      raw: {
                        retail_order_id: 'ord-1',
                        external_customer_ref: '+2348000000000',
                        channel: 'whatsapp',
                      },
                    },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })) })) };
      }),
    });
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
});
