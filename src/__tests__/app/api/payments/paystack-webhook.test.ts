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
// Since our mock returns data: null for transactions, the PaymentService
// constructor is never exercised — but mock it to prevent real HTTP calls.
jest.mock('@/lib/paymentService', () => ({
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
});
