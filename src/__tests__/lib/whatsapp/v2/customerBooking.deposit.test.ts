import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateReservation = jest.fn();
const mockInitializeTenantPayment = jest.fn();
const mockOpenHandoff = jest.fn();
const mockExecuteAction = jest.fn();
const mockUpdateThreadState = jest.fn();
const mockTransitionThread = jest.fn();
const mockReleaseLock = jest.fn();
const mockSetHuman = jest.fn();
const mockResetConversation = jest.fn();
const mockLoggerError = jest.fn();
const reservationUpdates: Array<Record<string, unknown>> = [];

function queryFor(table: string) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.update = jest.fn((patch: Record<string, unknown>) => {
    if (table === 'reservations') reservationUpdates.push(patch);
    return chain;
  });
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

jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => mockAdmin }));
jest.mock('@/lib/reservationService', () => ({ createReservation: mockCreateReservation }));
jest.mock('@/lib/booking/action-validator', () => ({ executeAction: mockExecuteAction }));
jest.mock('@/lib/payments/tenantSettlement', () => ({ initializeTenantPayment: mockInitializeTenantPayment }));
jest.mock('@/lib/payments/paymentHandoff', () => ({
  openReservationPaymentHandoff: mockOpenHandoff,
  PAYMENT_HANDOFF_CUSTOMER_MESSAGE: 'HANDOFF_MESSAGE',
}));
jest.mock('@/lib/whatsapp/v2/conversationEffects', () => ({
  ConversationEffectBlockedError: class ConversationEffectBlockedError extends Error {},
  runIdempotentEffect: jest.fn(async (input: { execute: () => Promise<unknown> }) => input.execute()),
}));
jest.mock('@/lib/customers/identity', () => ({
  resolveCustomer: jest.fn(async () => 'customer-1'),
  findCustomerByPhone: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({ updateConversation: jest.fn(), resetConversation: (...args: unknown[]) => mockResetConversation(...args) }));
jest.mock('@/lib/whatsapp/v2/conversationThread', () => ({
  updateThreadState: (...args: unknown[]) => mockUpdateThreadState(...args),
  transitionThread: (...args: unknown[]) => mockTransitionThread(...args),
}));
jest.mock('@/lib/whatsapp/v2/humanTakeover', () => ({ setHumanHandlingUntilReleased: (...args: unknown[]) => mockSetHuman(...args) }));
jest.mock('@/lib/whatsapp/v2/slotEngine', () => ({
  getAvailableSlots: jest.fn(),
  lockSlot: jest.fn(),
  releaseLock: (...args: unknown[]) => mockReleaseLock(...args),
}));
jest.mock('@/lib/whatsapp/v2/waitlist', () => ({ addToWaitlist: jest.fn() }));
jest.mock('@/lib/ai/front-desk-events', () => ({ recordFrontDeskEvent: jest.fn() }));
jest.mock('@/lib/analytics/server', () => ({ captureServerAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/chats/journey-service', () => ({ updateChatJourneyByExternalId: jest.fn(async () => undefined) }));
jest.mock('@/lib/observability/sentry', () => ({ captureBookaException: jest.fn() }));
jest.mock('@/lib/logger', () => ({ defaultLogger: { warn: jest.fn(), error: (...args: unknown[]) => mockLoggerError(...args) } }));

import { handleCustomerBooking } from '@/lib/whatsapp/v2/flows/customerBooking';

async function runConfirmWithDeposit({ depositAmountCents }: { depositAmountCents: number }) {
  const conv = {
    id: 'conversation-1', tenant_id: 't1', phone_number: '+2348000000000', external_id: '+2348000000000',
    channel: 'whatsapp' as const, role: 'customer' as const, current_flow: 'booking', flow_step: 4,
    flow_data: {
      pending_confirmation: {
        service_id: 'service-1', tenant_staff_id: 'staff-1', date: '2026-10-01', start_time: '10:00',
        end_time: '11:00', customer_name: 'Ada', lock_id: 'lock-1',
        deposit_required: true, deposit_amount_cents: depositAmountCents,
      },
    },
    last_inbound_at: null, opted_out_at: null,
  };
  return handleCustomerBooking('+2348000000000', 't1', { action: 'affirm' }, conv, 'yes',
    { correlationKey: 'conversation-batch:dep', threadId: 'thread-1' });
}

describe('customer booking deposit settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reservationUpdates.length = 0;
    mockCreateReservation.mockResolvedValue({ id: 'res_1' });
    mockExecuteAction.mockResolvedValue({ success: true, data: { reservationId: 'res_1' } });
    mockUpdateThreadState.mockResolvedValue({ stateVersion: 1 });
    mockTransitionThread.mockResolvedValue(undefined);
    mockOpenHandoff.mockResolvedValue(undefined);
    mockSetHuman.mockResolvedValue(undefined);
    mockResetConversation.mockResolvedValue(undefined);
  });

  it('initializes the deposit through the settlement boundary in kobo', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: true, transactionId: 'tx', reference: 'bk_x', authorizationUrl: 'https://co', snapshot: {} as never, reused: false });
    const reply = await runConfirmWithDeposit({ depositAmountCents: 500000 });
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', amountMinor: 500000, currency: 'NGN', subject: { type: 'reservation', id: 'res_1' },
      idempotencyKey: 'deposit:res_1',
    }));
    expect(reply).toContain('https://co');
  });

  it('keeps the reservation pending and hands off when settlement fails', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED', message: 'x' });
    const reply = await runConfirmWithDeposit({ depositAmountCents: 500000 });
    expect(mockOpenHandoff).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', reservationId: 'res_1', reason: 'SETTLEMENT_NOT_CONFIGURED', customerPhone: '+2348000000000',
    }));
    expect(reservationUpdates.map((u) => u.status)).not.toContain('cancelled');
    expect(mockReleaseLock).not.toHaveBeenCalled();
    expect(mockSetHuman).toHaveBeenCalledWith({
      externalId: '+2348000000000', tenantId: 't1', threadId: 'thread-1', channel: 'whatsapp',
    });
    expect(mockResetConversation).toHaveBeenCalledWith('+2348000000000', 't1', 'whatsapp');
    expect(reply).toBe('HANDOFF_MESSAGE');
  });

  it('still mutes the bot and replies when opening the handoff throws', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_DISABLED', message: 'x' });
    mockOpenHandoff.mockRejectedValue(new Error('db down'));
    const reply = await runConfirmWithDeposit({ depositAmountCents: 500000 });
    expect(mockLoggerError).toHaveBeenCalled();
    expect(mockSetHuman).toHaveBeenCalled();
    expect(reply).toBe('HANDOFF_MESSAGE');
  });

  it('does not re-run booking or payment on a later "yes" after handoff', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_DISABLED', message: 'x' });
    await runConfirmWithDeposit({ depositAmountCents: 500000 });
    // The pending confirmation was cleared (resetConversation) and the thread is muted,
    // so the next turn arrives with no pending_confirmation.
    const cleared = {
      id: 'conversation-1', tenant_id: 't1', phone_number: '+2348000000000', external_id: '+2348000000000',
      channel: 'whatsapp' as const, role: 'customer' as const, current_flow: 'idle', flow_step: 0,
      flow_data: {}, last_inbound_at: null, opted_out_at: null,
    };
    mockCreateReservation.mockClear();
    mockInitializeTenantPayment.mockClear();
    await handleCustomerBooking('+2348000000000', 't1', { action: 'affirm' }, cleared, 'yes',
      { correlationKey: 'conversation-batch:dep2', threadId: 'thread-1' });
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
  });
});
