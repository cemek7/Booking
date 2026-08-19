import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
  createSupabaseAdminClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/payments/lifecycle', () => ({ handlePaymentSuccess: jest.fn(async () => undefined) }));
jest.mock('@/lib/eventbus/eventBus', () => ({ getEventBus: () => ({ publishEvent: jest.fn(async () => undefined) }) }));
// PaymentService is instantiated in the route when a transaction is found.
// __esModule: true is required so the default import resolves correctly.
jest.mock('@/lib/paymentService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getProvider: jest.fn(() => undefined),
  })),
}));

import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { POST } from '@/app/api/payments/webhook/route';

const SECRET = 'sk_test_dummy';
const sign = (raw: string) => crypto.createHmac('sha512', SECRET).update(raw).digest('hex');

const signedWebhook = (bodyObj: unknown) => {
  const raw = JSON.stringify(bodyObj);
  return new NextRequest('http://localhost:3000/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(raw) },
    body: raw,
  });
};
const unsignedWebhook = (bodyObj: unknown) =>
  new NextRequest('http://localhost:3000/api/payments/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyObj),
  });

const makeSupabase = (opts: { insertError?: { code: string } | null } = {}) => ({
  from: jest.fn((table: string) => {
    if (table === 'webhook_events') return {
      insert: () => ({ select: async () => ({ data: opts.insertError ? null : [{ id: 'evt1' }], error: opts.insertError ?? null }) }),
    };
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
  }),
});

/**
 * Supabase mock that returns a matching transaction row.
 * The route issues these queries against `transactions`:
 *   1. .select('id, status, provider, tenant_id').eq('provider_reference', ref).maybeSingle()
 *      → returns the transaction row
 *   2. .update({...}).eq('id', transaction.id)
 *      → resolves { error: null }
 */
const makeSupabaseWithTransaction = () => ({
  from: jest.fn((table: string) => {
    if (table === 'webhook_events') return {
      insert: () => ({ select: async () => ({ data: [{ id: 'evt1' }], error: null }) }),
    };
    if (table === 'transactions') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'txn1', status: 'pending', provider: 'paystack', tenant_id: 'db_tenant' },
            }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      };
    }
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
  }),
});

describe('Paystack webhook (auth:false)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(makeSupabase());
  });

  it('rejects a request with no recognised signature header (400)', async () => {
    const res = await POST(unsignedWebhook({ provider: 'paystack', reference: 'r1', status: 'success' }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed webhook (200, ok:true)', async () => {
    const res = await POST(signedWebhook({ provider: 'paystack', reference: 'r_ok', status: 'success' }) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('treats a duplicate webhook_events insert (23505) as a replay', async () => {
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(makeSupabase({ insertError: { code: '23505' } }));
    const res = await POST(signedWebhook({ provider: 'paystack', reference: 'r_dup', status: 'success' }) as unknown as NextRequest);
    expect(await res.json()).toMatchObject({ ok: true, replay: true });
  });

  // CRITICAL 2: derive tenantId from DB transaction, not payload
  it('derives tenantId from the DB transaction, not the payload, and calls handlePaymentSuccess', async () => {
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(makeSupabaseWithTransaction());
    const body = { provider: 'paystack', reference: 'r_ok', status: 'success', metadata: { tenant_id: 'attacker_tenant' } };
    const res = await POST(signedWebhook(body) as unknown as NextRequest);
    expect(res.status).toBe(200);
    const { handlePaymentSuccess } = jest.requireMock('@/lib/payments/lifecycle');
    expect(handlePaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'db_tenant' }));
  });
});
