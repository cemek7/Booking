import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/supabase/bearer-client', () => ({ createSupabaseBearerClient: jest.fn() }));
// Hoist the initializePayment spy so we can assert on it after the happy-path POST.
const mockInitializePayment = jest.fn(async () => ({
  success: true,
  transactionId: 'txn_1',
  authorizationUrl: 'https://pay/redirect',
}));

jest.mock('@/lib/paymentService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    initializePayment: mockInitializePayment,
  })),
}));
jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({
    sendErrorAlert: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({
    logRequest: jest.fn(),
    logError: jest.fn(),
    warn: jest.fn(),
  })),
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import PaymentService from '@/lib/paymentService';
import { POST } from '@/app/api/payments/deposits/route';

// ─── Admin client mock ────────────────────────────────────────────────────────
// The route-handler wrapper calls createSupabaseAdminClient() TWICE:
//   1. auth.getUser(token)
//   2. from('tenant_users').select().eq('user_id').eq('tenant_id').maybeSingle()
//      (membership/role check)
// It also calls resolveIsGlobalAdmin which checks the 'admins' table.
function adminMock() {
  const chain = (final: any): any => ({
    select: () => chain(final),
    eq: () => chain(final),
    maybeSingle: async () => final,
    single: async () => final,
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'usr_1', email: 'o@test.com' } },
        error: null,
      }),
    },
    from: jest.fn((t: string) => {
      if (t === 'tenant_users') {
        return chain({ data: { tenant_id: 'ten_1', role: 'owner' }, error: null });
      }
      // admins table — user is NOT a global admin
      return chain({ data: null, error: null });
    }),
  };
}

// ─── Bearer client mock ───────────────────────────────────────────────────────
// ctx.supabase (bearer-scoped) is what the handler body uses:
//   from('tenant_users').select().eq('user_id').single()       → { tenant_id }
//   from('reservations').select().eq('id').eq('tenant_id').single()  → { id, status }
//   from('transactions').select().eq().eq().eq().in().single() → existing deposit or null
//   from('tenants').select().eq('id').single()                 → { metadata }
function bearerMock(o: { reservationStatus?: string; existingDeposit?: object | null } = {}) {
  const chain = (final: any): any => ({
    select: () => chain(final),
    eq: () => chain(final),
    in: () => chain(final),
    single: async () => final,
    maybeSingle: async () => final,
  });

  return {
    from: jest.fn((t: string) => {
      if (t === 'tenant_users') {
        return chain({ data: { tenant_id: 'ten_1' }, error: null });
      }
      if (t === 'reservations') {
        return chain({
          data: { id: 'res_1', status: o.reservationStatus ?? 'pending' },
          error: null,
        });
      }
      if (t === 'transactions') {
        return chain({ data: o.existingDeposit ?? null, error: null });
      }
      if (t === 'tenants') {
        return chain({ data: { metadata: {} }, error: null });
      }
      return chain({ data: null, error: null });
    }),
  };
}

// ─── Request factory ──────────────────────────────────────────────────────────
function req(body: unknown) {
  return new NextRequest('http://localhost:3000/api/payments/deposits', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      'x-tenant-id': 'ten_1',
    },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('deposit init (auth:true)', () => {
  const body = { amount: 10000, email: 'salon@test.com', reservationId: 'res_1' };

  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminMock());
  });

  it('initializes a Paystack deposit and returns the authorization URL', async () => {
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock());

    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      transactionId: 'txn_1',
      authorizationUrl: 'https://pay/redirect',
    });

    // CRITICAL 1: assert initializePayment was called with the correct args
    expect(mockInitializePayment).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: 'res_1',
      amount: 10000,
      email: 'salon@test.com',
      tenantId: 'ten_1',
    }));
  });

  it('is idempotent — returns the existing deposit instead of creating a new one', async () => {
    const existingDeposit = {
      id: 'txn_old',
      status: 'pending',
      provider_reference: 'r',
      raw: { provider_response: { authorizationUrl: 'https://old' } },
    };
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(
      bearerMock({ existingDeposit }),
    );

    const res = await POST(req(body) as unknown as NextRequest);
    expect(await res.json()).toMatchObject({ duplicate: true, transactionId: 'txn_old', authorizationUrl: 'https://old' });
  });

  it('refuses a deposit for a cancelled reservation (4xx)', async () => {
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(
      bearerMock({ reservationStatus: 'cancelled' }),
    );

    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
