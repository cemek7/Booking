import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: jest.fn(() => ({ from: jest.fn(), rpc: jest.fn() })),
}));
jest.mock('@opentelemetry/api', () => ({
  trace: { getTracer: jest.fn(() => ({ startSpan: jest.fn(() => ({ setAttribute: jest.fn(), recordException: jest.fn(), end: jest.fn() })) })) },
  metrics: { getMeter: jest.fn(() => ({ createCounter: jest.fn(() => ({ add: jest.fn() })), createHistogram: jest.fn(() => ({ record: jest.fn() })) })) },
}));
jest.mock('@/lib/eventBus', () => ({ publishEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/metrics', () => ({
  observeRequest: jest.fn(), refundProcessed: jest.fn(), transactionRetried: jest.fn(),
  reconciliationDiscrepancy: jest.fn(), depositIdempotencyHit: jest.fn(),
}));
jest.mock('@/lib/paymentSecurityService', () => ({ __esModule: true, default: jest.fn() }));
const mockSettle = jest.fn<(ref: string) => Promise<string>>();
jest.mock('@/lib/payments/paystackWebhookProcessor', () => ({
  settleVerifiedCharge: (ref: string) => mockSettle(ref),
}));

import PaymentService from '@/lib/paymentService';

function makeSupabase(tx: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: string[] = [];
  const supabase = {
    from: jest.fn((table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: tx, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        if (table === 'transactions') updates.push(patch);
        return { eq: () => ({ eq: async () => ({ error: null }), then: (r: (v: unknown) => void) => r({ error: null }) }) };
      },
      insert: async () => { inserts.push(table); return { error: null }; },
    })),
  };
  return { supabase, updates, inserts };
}

describe('retryFailedTransaction through the verifier', () => {
  const settled = { id: 'tx1', tenant_id: 't1', amount_minor: 500000, provider_reference: 'bk_1', retry_count: 0, raw: {} };
  beforeEach(() => jest.clearAllMocks());

  it.each(['verified', 'already_verified'])('succeeds on %s', async (outcome) => {
    mockSettle.mockResolvedValue(outcome);
    const { supabase, updates, inserts } = makeSupabase(settled);
    const r = await new PaymentService(supabase as never).retryFailedTransaction('tx1');
    expect(mockSettle).toHaveBeenCalledWith('bk_1');
    expect(r).toEqual({ success: true });
    expect(updates[0]).toMatchObject({ retry_count: 1 });
    expect(inserts).not.toContain('transaction_retries');
  });

  it('fails on mismatch', async () => {
    mockSettle.mockResolvedValue('mismatch');
    const { supabase } = makeSupabase(settled);
    expect(await new PaymentService(supabase as never).retryFailedTransaction('tx1')).toMatchObject({ success: false });
  });

  it('returns failure and still bumps retry_count when the verifier throws', async () => {
    mockSettle.mockRejectedValue(new Error('paystack down'));
    const { supabase, updates } = makeSupabase(settled);
    const r = await new PaymentService(supabase as never).retryFailedTransaction('tx1');
    expect(r).toEqual({ success: false, error: 'paystack down' });
    expect(updates[0]).toMatchObject({ retry_count: 1 });
  });

  it('legacy rows (amount_minor null) skip the verifier', async () => {
    const { supabase } = makeSupabase({ ...settled, amount_minor: null, raw: { provider: 'unknown' } });
    const r = await new PaymentService(supabase as never).retryFailedTransaction('tx1');
    expect(mockSettle).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
  });
});
