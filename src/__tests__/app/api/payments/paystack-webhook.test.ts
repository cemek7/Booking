/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory Supabase/route fakes */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
  createSupabaseAdminClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/payments/lifecycle', () => ({
  handlePaymentSuccess: jest.fn(async () => undefined),
  handlePaymentFailure: jest.fn(async () => undefined),
  handlePaymentRefund: jest.fn(async () => undefined),
}));
const mockProcess = jest.fn();
jest.mock('@/lib/payments/paystackWebhookProcessor', () => ({
  processPaystackWebhook: (...args: unknown[]) => mockProcess(...args),
}));
jest.mock('@/lib/eventbus/eventBus', () => ({ getEventBus: () => ({ publishEvent: jest.fn(async () => undefined) }) }));
jest.mock('@/lib/paymentService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ getProvider: jest.fn(() => undefined) })),
}));

import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { handlePaymentSuccess } from '@/lib/payments/lifecycle';
import { POST as webhookPOST } from '@/app/api/payments/webhook/route';
import { POST as paystackPOST } from '@/app/api/payments/paystack/route';

const RAW = JSON.stringify({ event: 'charge.success', data: { reference: 'bk_1' } });
const req = (path: string, headers: Record<string, string>, body = RAW) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });

describe('Paystack webhook routes delegate to the single processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue({ from: jest.fn() });
    mockProcess.mockResolvedValue({ status: 200, body: { ok: true, outcome: 'verified' } });
  });

  it.each([
    ['/api/payments/webhook', webhookPOST],
    ['/api/payments/paystack', paystackPOST],
  ])('%s passes the exact raw body and signature through and returns the result unchanged', async (path, handler) => {
    const res = await (handler as any)(req(path, { 'x-paystack-signature': 'abc123' }));
    expect(mockProcess).toHaveBeenCalledWith({ rawBody: RAW, signature: 'abc123' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'verified' });
  });

  it.each([
    ['/api/payments/webhook', webhookPOST],
    ['/api/payments/paystack', paystackPOST],
  ])('%s relays a non-200 processor result (e.g. 401) unchanged', async (path, handler) => {
    mockProcess.mockResolvedValueOnce({ status: 401, body: { error: 'Invalid signature', code: 'INVALID_SIGNATURE' } });
    const res = await (handler as any)(req(path, { 'x-paystack-signature': 'bad' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it('/api/payments/webhook rejects a request with no recognised signature header (400)', async () => {
    const res = await (webhookPOST as any)(req('/api/payments/webhook', {}, JSON.stringify({ provider: 'paystack', reference: 'r1', status: 'success' })));
    expect(res.status).toBe(400);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('a processor failure surfaces as 5xx so Paystack retries', async () => {
    mockProcess.mockRejectedValueOnce(new Error('verify failed'));
    const res = await (paystackPOST as any)(req('/api/payments/paystack', { 'x-paystack-signature': 'abc' }));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe('generic (Stripe/Flutterwave) webhook path never settles a Paystack-settled row (C2)', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  function routeClient(amountMinor: number | null) {
    const txUpdates: unknown[] = [];
    const from = jest.fn((table: string) => {
      const chain: any = {};
      for (const m of ['select', 'eq']) chain[m] = jest.fn(() => chain);
      chain.insert = jest.fn(() => chain);
      chain.update = jest.fn((p: unknown) => { if (table === 'transactions') txUpdates.push(p); return chain; });
      chain.maybeSingle = jest.fn(async () => (table === 'transactions'
        ? { data: { id: 'tx1', status: 'pending', raw: {}, tenant_id: 'ten_1', amount_minor: amountMinor }, error: null }
        : { data: null, error: null }));
      chain.then = (res: any, rej: any) => Promise.resolve({ data: [{ id: 'evt' }], error: null }).then(res, rej);
      return chain;
    });
    return { client: { from }, txUpdates };
  }

  const flwBody = JSON.stringify({ provider: 'flutterwave', reference: 'bk_settled', status: 'successful' });

  it('skips a row with non-null amount_minor: no status write, no confirmation', async () => {
    process.env.FLUTTERWAVE_WEBHOOK_SECRET = 'flw_test_dummy';
    const rc = routeClient(500000);
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(rc.client);
    const res = await (webhookPOST as any)(req('/api/payments/webhook', { 'verif-hash': 'flw_test_dummy' }, flwBody));
    expect(res.status).toBe(200);
    expect(rc.txUpdates).toHaveLength(0);
    expect(handlePaymentSuccess).not.toHaveBeenCalled();
  });

  it('still updates a legacy row (amount_minor null)', async () => {
    process.env.FLUTTERWAVE_WEBHOOK_SECRET = 'flw_test_dummy';
    const rc = routeClient(null);
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(rc.client);
    const res = await (webhookPOST as any)(req('/api/payments/webhook', { 'verif-hash': 'flw_test_dummy' }, flwBody));
    expect(res.status).toBe(200);
    expect(rc.txUpdates).toHaveLength(1);
  });
});
