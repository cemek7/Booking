import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateReservation = jest.fn();
const mockInitializePayment = jest.fn();
const mockExecuteAction = jest.fn();
const effectResults = new Map<string, unknown>();
const mockRunIdempotentEffect = jest.fn(async (input: { idempotencyKey: string; execute: () => Promise<unknown> }) => {
  if (effectResults.has(input.idempotencyKey)) return effectResults.get(input.idempotencyKey);
  const value = await input.execute();
  effectResults.set(input.idempotencyKey, value);
  return value;
});

function queryFor(table: string) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.insert = jest.fn(async () => ({ error: null }));
  chain.maybeSingle = jest.fn(async () => {
    if (table === 'services') return { data: { price: 25000 }, error: null };
    if (table === 'customers') return { data: { id: 'customer-1', total_bookings: 0, email: 'customer@example.com' }, error: null };
    if (table === 'tenants') return { data: { name: 'Glo Salon', metadata: {}, tone_config: null }, error: null };
    return { data: null, error: null };
  });
  return chain;
}

const mockAdmin = { from: jest.fn((table: string) => queryFor(table)) };

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockAdmin,
}));
jest.mock('@/lib/reservationService', () => ({ createReservation: mockCreateReservation }));
jest.mock('@/lib/booking/action-validator', () => ({ executeAction: mockExecuteAction }));
jest.mock('@/lib/paymentService', () => jest.fn().mockImplementation(() => ({ initializePayment: mockInitializePayment })));
jest.mock('@/lib/whatsapp/v2/conversationEffects', () => ({
  ConversationEffectBlockedError: class ConversationEffectBlockedError extends Error {},
  runIdempotentEffect: mockRunIdempotentEffect,
}));
jest.mock('@/lib/customers/identity', () => ({
  resolveCustomer: jest.fn(async () => 'customer-1'),
  findCustomerByPhone: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  updateConversation: jest.fn(),
  resetConversation: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/slotEngine', () => ({
  getAvailableSlots: jest.fn(),
  lockSlot: jest.fn(),
  releaseLock: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/waitlist', () => ({ addToWaitlist: jest.fn() }));
jest.mock('@/lib/ai/front-desk-events', () => ({ recordFrontDeskEvent: jest.fn() }));
jest.mock('@/lib/analytics/server', () => ({ captureServerAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/chats/journey-service', () => ({ updateChatJourneyByExternalId: jest.fn(async () => undefined) }));
jest.mock('@/lib/observability/sentry', () => ({ captureBookaException: jest.fn() }));
jest.mock('@/lib/logger', () => ({ defaultLogger: { warn: jest.fn(), error: jest.fn() } }));

import { handleCustomerBooking } from '@/lib/whatsapp/v2/flows/customerBooking';

describe('customer booking idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    effectResults.clear();
    mockCreateReservation.mockResolvedValue({ id: 'reservation-1' });
    mockInitializePayment.mockResolvedValue({
      success: true,
      transactionId: 'payment-1',
      authorizationUrl: 'https://pay.example/deposit-1',
    });
    mockExecuteAction.mockResolvedValue({ success: true, data: { reservationId: 'reservation-1' } });
  });

  it('creates one reservation and one deposit intent when the same batch is replayed', async () => {
    const conv = {
      id: 'conversation-1',
      tenant_id: 'tenant-1',
      phone_number: '+2348000000000',
      external_id: '+2348000000000',
      channel: 'whatsapp' as const,
      role: 'customer' as const,
      current_flow: 'booking',
      flow_step: 4,
      flow_data: {
        pending_confirmation: {
          service_id: 'service-1',
          tenant_staff_id: 'staff-1',
          date: '2026-10-01',
          start_time: '10:00',
          end_time: '11:00',
          customer_name: 'Ada',
          lock_id: 'lock-1',
          deposit_required: true,
          deposit_amount_cents: 500000,
        },
      },
      last_inbound_at: null,
      opted_out_at: null,
    };
    const context = { correlationKey: 'conversation-batch:abc', threadId: 'thread-1' };

    const first = await handleCustomerBooking('+2348000000000', 'tenant-1', { action: 'affirm' }, conv, 'yes', context);
    const replay = await handleCustomerBooking('+2348000000000', 'tenant-1', { action: 'affirm' }, conv, 'yes', context);

    expect(first).toContain('https://pay.example/deposit-1');
    expect(replay).toBe(first);
    expect(mockCreateReservation).toHaveBeenCalledTimes(1);
    expect(mockInitializePayment).toHaveBeenCalledTimes(1);
    expect(mockRunIdempotentEffect).toHaveBeenCalledWith(expect.objectContaining({
      effectType: 'create_booking',
      tenantId: 'tenant-1',
      threadId: 'thread-1',
    }));
    expect(mockRunIdempotentEffect).toHaveBeenCalledWith(expect.objectContaining({ effectType: 'initialize_deposit' }));
  });

  it.each(['cancel_booking', 'reschedule_booking'] as const)('executes %s once when the same batch is replayed', async (action) => {
    const conv = {
      id: 'conversation-1', tenant_id: 'tenant-1', phone_number: '+2348000000000',
      external_id: '+2348000000000', channel: 'whatsapp' as const, role: 'customer' as const,
      current_flow: 'managing', flow_step: 0, flow_data: {}, last_inbound_at: null, opted_out_at: null,
    };
    const input = {
      action,
      params: { reservation_id: 'reservation-1', ...(action === 'reschedule_booking' ? { new_start_at: '2026-10-02T10:00:00Z' } : {}) },
      reply: action === 'cancel_booking' ? 'Cancelled.' : 'Rescheduled.',
      confidence: 'high' as const,
    };
    const context = { correlationKey: `conversation-batch:${action}`, threadId: 'thread-1' };

    await handleCustomerBooking('+2348000000000', 'tenant-1', input, conv, action, context);
    await handleCustomerBooking('+2348000000000', 'tenant-1', input, conv, action, context);

    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
    expect(mockRunIdempotentEffect).toHaveBeenCalledWith(expect.objectContaining({
      effectType: action,
      tenantId: 'tenant-1',
      threadId: 'thread-1',
    }));
  });

  it('creates one retail payment-link intent when the same batch is replayed', async () => {
    mockExecuteAction.mockResolvedValue({
      success: true,
      data: {
        orderId: 'order-1',
        reference: 'retail-payment-1',
        paymentUrl: 'https://pay.example/retail-1',
        totalCents: 250000,
      },
    });
    const conv = {
      id: 'conversation-1', tenant_id: 'tenant-1', phone_number: '+2348000000000',
      external_id: '+2348000000000', channel: 'whatsapp' as const, role: 'customer' as const,
      current_flow: 'managing', flow_step: 0, flow_data: {}, last_inbound_at: null, opted_out_at: null,
    };
    const input = {
      action: 'create_retail_payment_link' as const,
      params: { order_id: 'order-1' },
      reply: 'Pay here.',
      confidence: 'high' as const,
    };
    const context = { correlationKey: 'conversation-batch:retail', threadId: 'thread-1' };

    const first = await handleCustomerBooking('+2348000000000', 'tenant-1', input, conv, 'pay', context);
    const replay = await handleCustomerBooking('+2348000000000', 'tenant-1', input, conv, 'pay', context);

    expect(first).toBe(replay);
    expect(first).toContain('https://pay.example/retail-1');
    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
  });
});
