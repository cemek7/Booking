import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateServerSupabaseClient = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
}));

const mockRecordFrontDeskEvent = jest.fn();
jest.mock('@/lib/ai/front-desk-events', () => ({
  recordFrontDeskEvent: (...args: unknown[]) => mockRecordFrontDeskEvent(...args),
}));

const mockTransitionRetailOrder = jest.fn();
const mockGetRetailOrderById = jest.fn();
jest.mock('@/lib/commerce/retail-orders', () => ({
  transitionRetailOrder: (...args: unknown[]) => mockTransitionRetailOrder(...args),
  getRetailOrderById: (...args: unknown[]) => mockGetRetailOrderById(...args),
}));

const mockGetConversation = jest.fn();
const mockUpdateConversation = jest.fn();
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
}));

const mockSendTextMessage = jest.fn();
const mockGetTenantChannelProviderClient = jest.fn();
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantChannelProviderClient: (...args: unknown[]) => mockGetTenantChannelProviderClient(...args),
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
    mockSendTextMessage.mockResolvedValue({ success: true, messageId: 'msg-1' });
    mockRecordFrontDeskEvent.mockResolvedValue(undefined);
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
      'whatsapp',
    );
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      '+2348000000000',
      expect.stringContaining('Payment received'),
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
