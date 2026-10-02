import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));
jest.mock('@/lib/paymentService', () => jest.fn());
jest.mock('@/lib/payments/tenantSettlement', () => ({ initializeTenantPayment: jest.fn() }));
jest.mock('@/lib/payments/paymentHandoff', () => ({ openReservationPaymentHandoff: jest.fn() }));

import { computeDepositMinor, maybeCreateBookingDeposit } from '@/lib/publicBookingService';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { initializeTenantPayment } from '@/lib/payments/tenantSettlement';
import { openReservationPaymentHandoff } from '@/lib/payments/paymentHandoff';

const mockInitializeTenantPayment = initializeTenantPayment as jest.MockedFunction<any>;
const mockOpenHandoff = openReservationPaymentHandoff as jest.MockedFunction<any>;

function mockSupabase() {
  const rows: Record<string, unknown> = {
    tenants: { settings: { requireDeposit: true, depositPercent: 20 }, metadata: {} },
    services: { price_cents: 1000000 },
  };
  (createSupabaseAdminClient as jest.Mock).mockReturnValue({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null }),
      };
      return chain;
    },
  });
}

describe('maybeCreateBookingDeposit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase();
  });

  it('returns paymentUnavailable and opens a handoff when settlement fails', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED', message: 'x' });
    const info = await maybeCreateBookingDeposit({ tenantId: 't1', reservationId: 'r1', serviceId: 's1', email: 'c@x.co' });
    expect(info).toEqual({ depositRequired: true, paymentUnavailable: true, depositAmountCents: 200000, currency: 'NGN' });
    expect(mockOpenHandoff).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'r1', reason: 'SETTLEMENT_NOT_CONFIGURED' }));
  });

  it('passes kobo unchanged to the boundary', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: true, transactionId: 'tx', reference: 'bk', authorizationUrl: 'https://co', snapshot: {} as never, reused: false });
    const info = await maybeCreateBookingDeposit({ tenantId: 't1', reservationId: 'r1', serviceId: 's1', email: 'c@x.co' });
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 200000, idempotencyKey: 'deposit:r1' }));
    expect(info).toMatchObject({ depositRequired: true, paymentUrl: 'https://co' });
    expect(mockOpenHandoff).not.toHaveBeenCalled();
  });

  it('fails closed when the boundary throws', async () => {
    mockInitializeTenantPayment.mockRejectedValue(new Error('boom'));
    const info = await maybeCreateBookingDeposit({ tenantId: 't1', reservationId: 'r1', serviceId: 's1', email: 'c@x.co' });
    expect(info).toMatchObject({ depositRequired: true, paymentUnavailable: true });
  });

  it('returns depositRequired false without service or email', async () => {
    expect(await maybeCreateBookingDeposit({ tenantId: 't1', reservationId: 'r1' })).toEqual({ depositRequired: false });
  });
});

describe('computeDepositMinor', () => {
  it('returns 0 when the tenant does not require a deposit', () => {
    expect(computeDepositMinor({ tenantSettings: {}, tenantMetadata: {}, servicePriceCents: 1000000 })).toBe(0);
    expect(computeDepositMinor({ tenantSettings: { depositPercent: 20 }, tenantMetadata: {}, servicePriceCents: 1000000 })).toBe(0);
  });

  it('computes the percentage of the service price', () => {
    expect(computeDepositMinor({
      tenantSettings: { requireDeposit: true, depositPercent: 20 }, tenantMetadata: {}, servicePriceCents: 1000000,
    })).toBe(200000);
  });

  it('honors metadata.ui_settings', () => {
    expect(computeDepositMinor({
      tenantSettings: {}, tenantMetadata: { ui_settings: { requireDeposit: true, depositPercent: 10 } }, servicePriceCents: 1000000,
    })).toBe(100000);
  });

  it('returns 0 for a zero percent', () => {
    expect(computeDepositMinor({
      tenantSettings: { requireDeposit: true, depositPercent: 0 }, tenantMetadata: {}, servicePriceCents: 1000000,
    })).toBe(0);
  });
});
