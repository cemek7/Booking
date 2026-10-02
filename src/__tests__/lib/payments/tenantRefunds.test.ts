import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));

import { refundTenantPayment, type RefundDeps } from '@/lib/payments/tenantRefunds';

const settled = {
  id: 'tx1', tenant_id: 't1', provider_reference: 'bk_1', amount_minor: 500000, platform_fee_minor: 5000,
  settlement_verification_status: 'verified', refund_amount: 0,
};

function setup(row: Record<string, unknown> | null = settled, ledgerError: { code?: string; message: string } | null = null) {
  const ledger: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = {
    from: jest.fn((table: string) => {
      if (table === 'transactions') {
        const filters: Record<string, unknown> = {};
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = (k: string, v: unknown) => { filters[k] = v; return q; };
        q.maybeSingle = async () => ({
          data: row && (filters.tenant_id === undefined || filters.tenant_id === row.tenant_id) ? row : null,
          error: null,
        });
        q.update = (patch: Record<string, unknown>) => { updates.push(patch); return { eq: async () => ({ error: null }) }; };
        return q;
      }
      return { insert: async (r: Record<string, unknown>) => { ledger.push(r); return { error: ledgerError }; } };
    }),
  };
  const refund = jest.fn<RefundDeps['refund']>().mockResolvedValue({ status: true });
  return { deps: { admin, refund } as unknown as RefundDeps, ledger, updates, refund };
}

describe('refundTenantPayment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refunds in minor units unchanged', async () => {
    const { deps, refund } = setup();
    await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 200000 }, deps);
    expect(refund).toHaveBeenCalledWith({ transaction: 'bk_1', amount: 200000 });
  });

  it('full refund reverses the Booka fee once', async () => {
    const { deps, ledger, updates } = setup();
    const r = await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1' }, deps);
    expect(r).toEqual({ ok: true, refundedMinor: 500000, full: true });
    expect(ledger).toEqual([expect.objectContaining({ revenue_type: 'refund', amount_credits: -50, reference: 'bk_1:fee_refund' })]);
    expect(updates[0]).toMatchObject({ status: 'refunded', refund_amount: 5000 });
  });

  it('treats a duplicate fee-reversal insert (23505) as success', async () => {
    const { deps } = setup(settled, { code: '23505', message: 'dup' });
    expect(await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1' }, deps)).toMatchObject({ ok: true });
  });

  it('partial refund keeps the fee', async () => {
    const { deps, ledger, updates } = setup();
    const r = await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 100000 }, deps);
    expect(r).toEqual({ ok: true, refundedMinor: 100000, full: false });
    expect(ledger).toHaveLength(0);
    expect(updates[0]).toMatchObject({ status: 'partially_refunded' });
  });

  it('a second partial that completes the total is a full refund', async () => {
    const { deps, ledger } = setup({ ...settled, refund_amount: 3000 });
    const r = await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 200000 }, deps);
    expect(r).toEqual({ ok: true, refundedMinor: 200000, full: true });
    expect(ledger).toHaveLength(1);
  });

  it('refuses unverified, foreign-tenant, or over-refunds', async () => {
    const a = setup({ ...settled, settlement_verification_status: 'pending' });
    expect(await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1' }, a.deps)).toMatchObject({ ok: false });
    const b = setup();
    expect(await refundTenantPayment({ tenantId: 'other', transactionId: 'tx1' }, b.deps)).toMatchObject({ ok: false });
    const c = setup();
    expect(await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 500001 }, c.deps)).toMatchObject({ ok: false });
    for (const s of [a, b, c]) expect(s.refund).not.toHaveBeenCalled();
  });

  it('rejects non-integer amounts', async () => {
    const { deps, refund } = setup();
    expect(await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1', amountMinor: 1.5 }, deps)).toMatchObject({ ok: false });
    expect(refund).not.toHaveBeenCalled();
  });

  it('returns ok:false (and writes nothing) when Paystack rejects or throws', async () => {
    const a = setup();
    a.refund.mockResolvedValue({ status: false, message: 'nope' });
    expect(await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1' }, a.deps)).toEqual({ ok: false, error: 'nope' });
    const b = setup();
    b.refund.mockRejectedValue(new Error('network'));
    expect(await refundTenantPayment({ tenantId: 't1', transactionId: 'tx1' }, b.deps)).toEqual({ ok: false, error: 'network' });
    expect(a.updates).toHaveLength(0);
    expect(b.updates).toHaveLength(0);
  });
});
