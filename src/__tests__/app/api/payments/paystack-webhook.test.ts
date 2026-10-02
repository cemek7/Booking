import { describe, it, expect, beforeEach, jest } from '@jest/globals';
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
