import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/supabase/bearer-client', () => ({ createSupabaseBearerClient: jest.fn() }));
const mockInitializeTenantPayment = jest.fn();
jest.mock('@/lib/payments/tenantSettlement', () => ({
  initializeTenantPayment: (...a: unknown[]) => mockInitializeTenantPayment(...a),
  SETTLEMENT_CUSTOMER_MESSAGE: 'Online payment is not available for this business right now.',
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
jest.mock('@/lib/ai/front-desk-events', () => ({
  recordFrontDeskEvent: jest.fn().mockResolvedValue(undefined),
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { POST } from '@/app/api/payments/deposits/route';

type QueryResult = { data: unknown; error: null };
type QueryChain = {
  select: () => QueryChain;
  eq: () => QueryChain;
  in: () => QueryChain;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
};

// ─── Admin client mock ────────────────────────────────────────────────────────
// The route-handler wrapper calls createSupabaseAdminClient() TWICE:
//   1. auth.getUser(token)
//   2. from('tenant_users').select().eq('user_id').eq('tenant_id').maybeSingle()
//      (membership/role check)
// It also calls resolveIsGlobalAdmin which checks the 'admins' table.
function adminMock() {
  const chain = (final: QueryResult): QueryChain => ({
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
  const chain = (final: QueryResult): QueryChain => ({
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
const RES_ID = '11111111-1111-4111-8111-111111111111';

describe('deposit init (auth:true)', () => {
  const body = { amountMinor: 500000, email: 'salon@test.com', reservationId: RES_ID };

  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminMock());
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock());
    mockInitializeTenantPayment.mockResolvedValue({
      ok: true,
      transactionId: 'txn_1',
      reference: 'bk_1',
      authorizationUrl: 'https://pay/redirect',
      snapshot: {},
      reused: false,
    });
  });

  it('initializes a deposit through the settlement boundary in kobo', async () => {
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      transactionId: 'txn_1',
      authorizationUrl: 'https://pay/redirect',
      duplicate: false,
    });
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'ten_1',
      amountMinor: 500000,
      currency: 'NGN',
      customerEmail: 'salon@test.com',
      subject: { type: 'reservation', id: RES_ID },
      idempotencyKey: `deposit:${RES_ID}`,
    }));
    expect(recordFrontDeskEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'ten_1',
      eventType: 'payment_requested',
      reservationId: RES_ID,
      amount: 5000,
      currency: 'NGN',
    }));
  });

  it('rejects the legacy major-unit amount field (400)', async () => {
    const res = await POST(req({ amount: 5000, email: 'salon@test.com', reservationId: RES_ID }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
  });

  it('rejects a non-integer amountMinor (400)', async () => {
    const res = await POST(req({ ...body, amountMinor: 1.5 }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
  });

  it('returns 409 with a Settings -> Payments message when settlement is not configured', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED', message: 'x' });
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('SETTLEMENT_NOT_CONFIGURED');
    expect(JSON.stringify(json)).toMatch(/Settings → Payments/);
    expect(recordFrontDeskEvent).not.toHaveBeenCalled();
  });

  it('returns 409 on an idempotency conflict', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'IDEMPOTENCY_CONFLICT', message: 'amount differs' });
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('returns 502 with the boundary message on a transient provider failure', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'PROVIDER_INITIALIZATION_FAILED', message: 'try again' });
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('try again');
  });

  it('flags a reused checkout as duplicate', async () => {
    mockInitializeTenantPayment.mockResolvedValue({
      ok: true, transactionId: 'txn_old', reference: 'r', authorizationUrl: 'https://old', snapshot: {}, reused: true,
    });
    const res = await POST(req(body) as unknown as NextRequest);
    expect(await res.json()).toMatchObject({ duplicate: true, transactionId: 'txn_old', authorizationUrl: 'https://old' });
  });

  it('refuses a deposit for a cancelled reservation (4xx)', async () => {
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock({ reservationStatus: 'cancelled' }));
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
  });
});
