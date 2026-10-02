import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import crypto from 'crypto';

jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));
jest.mock('@/lib/payments/lifecycle', () => ({
  handlePaymentSuccess: jest.fn(),
  handlePaymentFailure: jest.fn(),
}));
jest.mock('@/lib/billing/walletTopup', () => ({ creditVerifiedTopup: jest.fn() }));
jest.mock('@/lib/paystack', () => ({ verifyTransaction: jest.fn() }));

import { processPaystackWebhook, settleVerifiedCharge, type WebhookDeps } from '@/lib/payments/paystackWebhookProcessor';

const SECRET = 'sk_test_dummy';
const sign = (raw: string) => crypto.createHmac('sha512', SECRET).update(raw).digest('hex');

type Row = Record<string, any>;

/** Minimal in-memory Supabase admin fake. */
function makeAdmin(seed: Record<string, Row[]>, opts: { failInsert?: Record<string, { code: string }> } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v;
  const tbl = (n: string) => (tables[n] ??= []);
  const calls: string[] = [];

  const from = (table: string) => {
    calls.push(table);
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    let wantSelect = false;

    const run = (): { data: any; error: any } => {
      const rows = tbl(table);
      if (op === 'insert') {
        const fail = opts.failInsert?.[table];
        if (fail) return { data: null, error: { code: fail.code, message: 'boom' } };
        if (table === 'webhook_events' && rows.some((r) => r.provider === payload.provider && r.external_id === payload.external_id)) {
          return { data: null, error: { code: '23505', message: 'dup' } };
        }
        const row = { id: `${table}_${rows.length + 1}`, ...payload };
        rows.push(row);
        return { data: wantSelect ? [row] : null, error: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        matched.forEach((r) => Object.assign(r, payload));
        return { data: wantSelect ? matched.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (op === 'delete') {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return { data: null, error: null };
      }
      return { data: matched, error: null };
    };

    const b: any = {
      insert: (p: Row) => { op = 'insert'; payload = p; return b; },
      update: (p: Row) => { op = 'update'; payload = p; return b; },
      delete: () => { op = 'delete'; return b; },
      select: () => { wantSelect = true; return b; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
      // SQL semantics: NULL never matches neq.
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== null && r[c] !== undefined && r[c] !== v); return b; },
      or: (expr: string) => {
        const parts = expr.split(',').map((p) => p.split('.'));
        filters.push((r) => parts.some(([c, o, v]) => (o === 'is' ? (r[c] === null || r[c] === undefined) : (r[c] !== null && r[c] !== undefined && r[c] !== v))));
        return b;
      },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { admin: { from } as any, tables, calls };
}

const baseTx = () => ({
  id: 'tx1', tenant_id: 't1', status: 'pending', provider_reference: 'bk_1', currency: 'NGN',
  subject_type: 'reservation', subject_id: 'r1', amount_minor: 500000, platform_fee_minor: 5000,
  tenant_gross_minor: 495000, settlement_subaccount_code: 'ACCT_1', settlement_policy_code: 'pilot_ngn_v1',
  settlement_policy_version: 1, settlement_verification_status: 'pending', raw: {},
});
const verifiedOk = { status: 'success', reference: 'bk_1', amountMinor: 500000, currency: 'NGN', feesMinor: 7600, subaccountCode: 'ACCT_1' };
const event = (data: object, ev = 'charge.success') => JSON.stringify({ event: ev, data });

function setup(opts: { tx?: Row | null; extra?: Record<string, Row[]>; verified?: any; failInsert?: Record<string, { code: string }> } = {}) {
  const tx = opts.tx === null ? [] : [opts.tx ?? baseTx()];
  const fake = makeAdmin({ transactions: tx, webhook_events: [], tenant_revenue_ledger: [], ...(opts.extra ?? {}) }, { failInsert: opts.failInsert });
  const verify = jest.fn(async () => ({ success: true, data: opts.verified ?? verifiedOk })) as any;
  const deps: WebhookDeps = {
    admin: fake.admin, verify,
    onSuccess: jest.fn(async () => undefined) as any,
    onFailure: jest.fn(async () => undefined) as any,
    creditTopup: jest.fn(async () => ({ credited: true, tenantId: 't1', amountCredits: 2500 })) as any,
    secret: SECRET,
  };
  const send = (raw: string) => processPaystackWebhook({ rawBody: raw, signature: sign(raw) }, deps);
  return { fake, deps, verify, send, txRow: () => fake.tables.transactions[0] };
}

describe('processPaystackWebhook', () => {
  beforeEach(() => jest.clearAllMocks());

  it('1. rejects a bad signature with 401 and touches no DB', async () => {
    const s = setup();
    const raw = event({ reference: 'bk_1' });
    const res = await processPaystackWebhook({ rawBody: raw, signature: 'deadbeef' }, s.deps);
    expect(res.status).toBe(401);
    expect(s.fake.calls).toHaveLength(0);
  });

  it('2. settles a verified match and writes the fee ledger row', async () => {
    const s = setup();
    const res = await s.send(event({ reference: 'bk_1' }));
    expect(res.status).toBe(200);
    expect(s.txRow()).toMatchObject({
      status: 'success', settlement_verification_status: 'verified',
      provider_amount_minor: 500000, provider_fee_minor: 7600, provider_subaccount_code: 'ACCT_1',
    });
    const ledger = s.fake.tables.tenant_revenue_ledger;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ revenue_type: 'platform_transaction_fee', amount_credits: 50, reference: 'bk_1' });
    expect(s.deps.onSuccess).toHaveBeenCalledTimes(1);
    expect(s.deps.onSuccess).toHaveBeenCalledWith({
      tenantId: 't1', reference: 'bk_1', provider: 'paystack', reservationId: 'r1',
      subjectType: 'reservation', amountMinor: 500000, currency: 'NGN',
    });
  });

  it('3. ignores payload metadata reservation_id', async () => {
    const s = setup();
    await s.send(event({ reference: 'bk_1', metadata: { reservation_id: 'EVIL', tenant_id: 'EVIL' } }));
    expect(s.deps.onSuccess).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', reservationId: 'r1' }));
  });

  it('4. replay does not repeat effects', async () => {
    const s = setup();
    const raw = event({ reference: 'bk_1' });
    await s.send(raw);
    const second = await s.send(raw);
    expect(second.body).toMatchObject({ replay: true });
    expect(s.fake.tables.tenant_revenue_ledger).toHaveLength(1);
    expect(s.deps.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('5. replay-marker failure other than 23505 returns 500 without verifying', async () => {
    const s = setup({ failInsert: { webhook_events: { code: 'XX000' } } });
    const res = await s.send(event({ reference: 'bk_1' }));
    expect(res.status).toBe(500);
    expect(s.verify).not.toHaveBeenCalled();
  });

  it('6. verify failure throws, leaves tx unchanged and releases the marker', async () => {
    const s = setup();
    s.verify.mockResolvedValueOnce({ success: false, error: 'network' });
    await expect(s.send(event({ reference: 'bk_1' }))).rejects.toThrow(/verify failed/);
    expect(s.txRow()).toMatchObject({ status: 'pending', settlement_verification_status: 'pending' });
    expect(s.fake.tables.webhook_events).toHaveLength(0);
    expect(s.deps.onSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { amountMinor: 50000000 }],
    ['currency', { currency: 'USD' }],
    ['subaccount', { subaccountCode: 'ACCT_OTHER' }],
  ])('7-9. %s mismatch flags the row and does not settle', async (_n, override) => {
    const s = setup({ verified: { ...verifiedOk, ...override } });
    const res = await s.send(event({ reference: 'bk_1' }));
    expect(res.status).toBe(200);
    expect(s.txRow()).toMatchObject({ settlement_verification_status: 'mismatch', status: 'pending' });
    expect(s.fake.tables.tenant_revenue_ledger).toHaveLength(0);
    expect(s.deps.onSuccess).not.toHaveBeenCalled();
  });

  it('10. already verified row is not settled twice', async () => {
    const s = setup({ tx: { ...baseTx(), status: 'success', settlement_verification_status: 'verified' } });
    const outcome = await settleVerifiedCharge('bk_1', s.deps);
    expect(outcome).toBe('already_verified');
    expect(s.fake.tables.tenant_revenue_ledger).toHaveLength(0);
    expect(s.deps.onSuccess).not.toHaveBeenCalled();
    expect(s.verify).not.toHaveBeenCalled();
  });

  it('11. legacy row without amount_minor goes to review, not confirmed', async () => {
    const s = setup({ tx: { ...baseTx(), amount_minor: null } });
    const outcome = await settleVerifiedCharge('bk_1', s.deps);
    expect(outcome).toBe('legacy_review');
    expect(s.txRow().status).toBe('pending');
    expect(s.verify).not.toHaveBeenCalled();
    expect(s.deps.onSuccess).not.toHaveBeenCalled();
  });

  it('12. wallet top-up credits via creditTopup and reads no transactions', async () => {
    const s = setup();
    const res = await s.send(event({ reference: 'bokawallet_abc', amount: 500000, customer: { email: 'a@b.co' }, authorization: { authorization_code: 'AUTH_1' } }));
    expect(res).toEqual({ status: 200, body: { ok: true, wallet_topup: true } });
    expect(s.deps.creditTopup).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'bokawallet_abc', amountMinor: 500000, customerEmail: 'a@b.co',
      authorization: { authorization_code: 'AUTH_1' },
    }));
    expect(s.fake.calls).not.toContain('transactions');
    expect(s.verify).not.toHaveBeenCalled();
  });

  it('12b. wallet top-up with no amount is ignored; credit failure releases the marker', async () => {
    const s = setup();
    const res = await s.send(event({ reference: 'bokawallet_noamt' }));
    expect(res.body).toMatchObject({ wallet_topup: false, reason: 'no_amount' });
    (s.deps.creditTopup as jest.Mock).mockRejectedValueOnce(new Error('rpc down') as never);
    await expect(s.send(event({ reference: 'bokawallet_fail', amount: 100 }))).rejects.toThrow('rpc down');
    expect(s.fake.tables.webhook_events.find((e) => e.external_id === 'bokawallet_fail:charge.success')).toBeUndefined();
  });

  it('13. a policy change after checkout does not change the stored fee', async () => {
    const s = setup({ extra: { payment_fee_policies: [{ code: 'pilot_ngn_v1', version: 2, bps: 200 }] } });
    await s.send(event({ reference: 'bk_1' }));
    expect(s.fake.tables.tenant_revenue_ledger[0].amount_credits).toBe(50);
  });

  it('14. charge.failed calls onFailure with tenant and reservation from the row', async () => {
    const s = setup();
    await s.send(event({ reference: 'bk_1', gateway_response: 'Declined', metadata: { reservation_id: 'EVIL' } }, 'charge.failed'));
    expect(s.deps.onFailure).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', reservationId: 'r1', reference: 'bk_1' }));
    expect(s.txRow().status).toBe('failed');
  });

  it('14b. charge.failed also marks legacy rows with NULL verification status, never a verified row', async () => {
    const legacy = setup({ tx: { ...baseTx(), settlement_verification_status: null } });
    await legacy.send(event({ reference: 'bk_1' }, 'charge.failed'));
    expect(legacy.txRow().status).toBe('failed');

    const done = setup({ tx: { ...baseTx(), status: 'success', settlement_verification_status: 'verified' } });
    await done.send(event({ reference: 'bk_1' }, 'charge.failed'));
    expect(done.txRow().status).toBe('success');
  });

  it('15. verifies even if the checkout URL was never stored on the row', async () => {
    const s = setup({ tx: { ...baseTx(), raw: {} } });
    const outcome = await settleVerifiedCharge('bk_1', s.deps);
    expect(outcome).toBe('verified');
  });

  it('16. a late charge.success for a failed/abandoned row still settles when it matches', async () => {
    const s = setup({ tx: { ...baseTx(), status: 'failed', settlement_verification_status: 'not_applicable' } });
    const outcome = await settleVerifiedCharge('bk_1', s.deps);
    expect(outcome).toBe('verified');
    expect(s.txRow()).toMatchObject({ status: 'success', settlement_verification_status: 'verified' });
    expect(s.deps.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('17. onSuccess failure after the claim is logged, released and rethrown', async () => {
    const s = setup();
    (s.deps.onSuccess as jest.Mock).mockRejectedValueOnce(new Error('confirm failed') as never);
    await expect(s.send(event({ reference: 'bk_1' }))).rejects.toThrow('confirm failed');
    expect(s.fake.tables.webhook_events).toHaveLength(0);
    // Retry sees already_verified and does not repeat effects.
    const retry = await s.send(event({ reference: 'bk_1' }));
    expect(retry.body).toMatchObject({ outcome: 'already_verified' });
    expect(s.fake.tables.tenant_revenue_ledger).toHaveLength(1);
  });

  it('18. a non-success provider status never settles, even if the payload says success', async () => {
    const s = setup({ verified: { ...verifiedOk, status: 'abandoned' } });
    const res = await s.send(event({ reference: 'bk_1', status: 'success' }));
    expect(res.body).toMatchObject({ outcome: 'not_successful' });
    expect(s.txRow().status).toBe('pending');
  });
});
