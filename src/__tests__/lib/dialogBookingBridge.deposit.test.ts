import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInitializeTenantPayment = jest.fn();
const mockOpenHandoff = jest.fn();
const mockCreateReservation = jest.fn();
const mockUpdateSlots = jest.fn();
let tenantSettings: Record<string, unknown> = {};

function client() {
  return {
    from: jest.fn((table: string) => {
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => {
        if (table === 'services') return { data: { price: 10000, currency: 'NGN' }, error: null };
        if (table === 'tenants') return { data: { settings: tenantSettings, metadata: {} }, error: null };
        return { data: null, error: null };
      });
      return chain;
    }),
  };
}

jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => client(),
  createSupabaseAdminClient: () => client(),
}));
jest.mock('@/lib/paymentService', () => jest.fn());
jest.mock('@/lib/reservationService', () => ({ createReservation: mockCreateReservation }));
jest.mock('@/lib/dialogManager', () => ({ updateSlots: mockUpdateSlots }));
jest.mock('@/lib/payments/tenantSettlement', () => ({ initializeTenantPayment: mockInitializeTenantPayment }));
jest.mock('@/lib/payments/paymentHandoff', () => ({
  openReservationPaymentHandoff: mockOpenHandoff,
  PAYMENT_HANDOFF_CUSTOMER_MESSAGE: 'HANDOFF_MESSAGE',
}));

import { DialogBookingBridge, type BookingDialogState } from '@/lib/dialogBookingBridge';

function makeBridge() {
  const bridge = new DialogBookingBridge();
  const priv = bridge as unknown as Record<string, jest.Mock | unknown>;
  priv.autoAssignStaff = jest.fn(async () => 'staff-1');
  priv.calculateEndTime = jest.fn(async () => '2026-10-05T11:00:00.000Z');
  priv.notifyOwnerOfNewBooking = jest.fn(async () => undefined);
  const sendConfirmed = jest.fn(async () => ({ response: 'CONFIRMED', completed: true }));
  priv.sendBookingConfirmedResponse = sendConfirmed;
  return { bridge, sendConfirmed };
}

function run(bridge: DialogBookingBridge) {
  const state: BookingDialogState = {
    step: 'confirmation', serviceId: 'svc-1', serviceName: 'Braids', startTime: '2026-10-05T10:00:00.000Z',
    customerName: 'Ada', customerPhone: '+2348000000000',
  };
  return (bridge as unknown as {
    attemptBooking: (t: string, s: string, st: BookingDialogState) => Promise<{ response: string; completed: boolean }>;
  }).attemptBooking('tenant-1', 'session-1', state);
}

describe('dialog bridge deposits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tenantSettings = { requireDeposit: true, depositPercent: 20 };
    mockCreateReservation.mockResolvedValue({ id: 'res_1' });
    mockUpdateSlots.mockResolvedValue(undefined);
    mockOpenHandoff.mockResolvedValue(undefined);
  });

  it('charges the deposit percentage, not the full price, via the settlement boundary', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: true, transactionId: 'tx', reference: 'r', authorizationUrl: 'https://co', snapshot: {}, reused: false });
    const { bridge } = makeBridge();
    const out = await run(bridge);
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 200000,
      subject: { type: 'reservation', id: 'res_1' },
      idempotencyKey: 'deposit:res_1',
    }));
    expect(out.response).toContain('https://co');
  });

  it('hands off to staff when settlement is unavailable', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_DISABLED', message: 'x' });
    const { bridge, sendConfirmed } = makeBridge();
    const out = await run(bridge);
    expect(out.response).toBe('HANDOFF_MESSAGE');
    expect(mockOpenHandoff).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', reservationId: 'res_1', reason: 'SETTLEMENT_DISABLED', customerPhone: '+2348000000000',
    }));
    expect(sendConfirmed).not.toHaveBeenCalled();
  });

  it('skips the initializer when no deposit is required', async () => {
    tenantSettings = {};
    const { bridge, sendConfirmed } = makeBridge();
    const out = await run(bridge);
    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
    expect(sendConfirmed).toHaveBeenCalled();
    expect(out.response).toBe('CONFIRMED');
  });
});
