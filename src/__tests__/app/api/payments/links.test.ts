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
  getAlertService: jest.fn(() => ({ sendErrorAlert: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({ logRequest: jest.fn(), logError: jest.fn(), warn: jest.fn() })),
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { POST } from '@/app/api/payments/links/route';

type QueryResult = { data: unknown; error: null };
type QueryChain = {
  select: () => QueryChain;
  eq: () => QueryChain;
  in: () => QueryChain;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
};
const transactionsInsert = jest.fn();

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
      if (t === 'transactions') return { insert: transactionsInsert };
      // admins table — user is NOT a global admin
      return chain({ data: null, error: null });
    }),
  };
}

const bearerMock = () => ({ from: jest.fn() });

// ─── Request factory ──────────────────────────────────────────────────────────
function req(body: unknown) {
  return new NextRequest('http://localhost:3000/api/payments/links', {
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
describe('payment link create (auth:true)', () => {
  const body = { amount: 2500.5, description: 'x', customer_email: 'buyer@test.com' };

  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminMock());
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock());
    mockInitializeTenantPayment.mockResolvedValue({
      ok: true, transactionId: 'txn_1', reference: 'bk_ref', authorizationUrl: 'https://pay/link', snapshot: {}, reused: false,
    });
  });

  it('settles through the boundary, converting naira to kobo once', async () => {
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, paymentUrl: 'https://pay/link', reference: 'bk_ref', amount: 2500.5, currency: 'NGN',
    });
    expect(mockInitializeTenantPayment).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'ten_1',
      amountMinor: 250050,
      currency: 'NGN',
      customerEmail: 'buyer@test.com',
      description: 'x',
      subject: { type: 'payment_link', id: expect.any(String) },
    }));
    const call = mockInitializeTenantPayment.mock.calls[0][0] as { subject: { id: string }; idempotencyKey: string };
    expect(call.idempotencyKey).toBe(`payment_link:${call.subject.id}`);
  });

  it('requires a real customer email (400)', async () => {
    const res = await POST(req({ amount: 100, description: 'x' }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    const blank = await POST(req({ amount: 100, description: 'x', customer_email: '' }) as unknown as NextRequest);
    expect(blank.status).toBe(400);
    expect(mockInitializeTenantPayment).not.toHaveBeenCalled();
  });

  it('returns 400 with the Settings -> Payments message when settlement is not configured', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_DISABLED', message: 'x' });
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Settings → Payments/);
  });

  it('returns the boundary message on a transient failure (400)', async () => {
    mockInitializeTenantPayment.mockResolvedValue({ ok: false, code: 'SETTLEMENT_UNAVAILABLE', message: 'try again shortly' });
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/try again shortly/);
  });

  it('never inserts a transactions row itself (the boundary writes it)', async () => {
    await POST(req(body) as unknown as NextRequest);
    expect(transactionsInsert).not.toHaveBeenCalled();
  });
});
