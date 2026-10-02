import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockInit = jest.fn();
jest.mock('@/lib/paystack', () => ({ initializeSplitTransaction: (...a: unknown[]) => mockInit(...a) }));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultStore, initializeTenantPayment, type SettlementStore } from '@/lib/payments/tenantSettlement';

const account = { subaccountCode: 'ACCT_1', status: 'active' as const, accepted: true, policyCode: 'pilot_ngn_v1', policyVersion: 1 };
const policy = { code: 'pilot_ngn_v1', version: 1, basisPoints: 100, capMinor: 200000, feeBearer: 'subaccount' as const };

function makeStore(over: Partial<SettlementStore> = {}): SettlementStore & { inserted: unknown[]; failed: string[]; initialized: string[] } {
  const s = {
    inserted: [] as unknown[], failed: [] as string[], initialized: [] as string[],
    loadAccount: jest.fn(async () => account),
    loadPolicy: jest.fn(async () => policy),
    findByIdempotencyKey: jest.fn(async () => null),
    insertPending: jest.fn(async (row: unknown) => { s.inserted.push(row); return { id: 'tx_1' }; }),
    markInitialized: jest.fn(async (id: string) => { s.initialized.push(id); }),
    markFailed: jest.fn(async (id: string) => { s.failed.push(id); }),
    releaseKey: jest.fn(async () => {}),
    ...over,
  };
  return s as never;
}

const input = {
  tenantId: 't1', amountMinor: 500000, currency: 'NGN' as const, customerEmail: 'c@x.co',
  subject: { type: 'reservation' as const, id: 'r1' }, idempotencyKey: 'deposit:r1',
};

describe('initializeTenantPayment', () => {
  beforeEach(() => { mockInit.mockReset(); process.env.BOOKA_TENANT_PAYMENTS = 'live'; });

  it('fails closed when collection is disabled, with no DB or provider call', async () => {
    process.env.BOOKA_TENANT_PAYMENTS = 'off';
    const store = makeStore();
    const r = await initializeTenantPayment(input, store);
    expect(r).toMatchObject({ ok: false, code: 'SETTLEMENT_DISABLED' });
    expect(store.loadAccount).not.toHaveBeenCalled();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, -5, Number.NaN])('rejects amount %p before any insert', async (amountMinor) => {
    const store = makeStore();
    expect(await initializeTenantPayment({ ...input, amountMinor }, store)).toMatchObject({ ok: false, code: 'INVALID_AMOUNT_MINOR' });
    expect(store.inserted).toHaveLength(0);
  });

  it('rejects non-NGN currency', async () => {
    expect(await initializeTenantPayment({ ...input, currency: 'USD' as never }, makeStore())).toMatchObject({ ok: false, code: 'CURRENCY_NOT_SUPPORTED' });
  });

  it('rejects empty or placeholder email', async () => {
    expect(await initializeTenantPayment({ ...input, customerEmail: '' }, makeStore())).toMatchObject({ code: 'CUSTOMER_EMAIL_REQUIRED' });
    expect(await initializeTenantPayment({ ...input, customerEmail: 'noemail@example.com' }, makeStore())).toMatchObject({ code: 'CUSTOMER_EMAIL_REQUIRED' });
  });

  it('fails closed with no account, making zero provider calls', async () => {
    const store = makeStore({ loadAccount: jest.fn(async () => null) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: false, code: 'SETTLEMENT_NOT_CONFIGURED' });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...account, status: 'pending' as const }],
    [{ ...account, status: 'suspended' as const }],
  ])('fails closed for non-active account %#', async (acct) => {
    expect(await initializeTenantPayment(input, makeStore({ loadAccount: jest.fn(async () => acct) }))).toMatchObject({ code: 'SETTLEMENT_NOT_CONFIGURED' });
  });

  it('fails closed when the policy is not accepted', async () => {
    const store = makeStore({ loadAccount: jest.fn(async () => ({ ...account, accepted: false })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ code: 'POLICY_NOT_ACCEPTED' });
  });

  it('inserts the snapshot before calling Paystack, then sends the split', async () => {
    const order: string[] = [];
    const store = makeStore({
      insertPending: jest.fn(async () => { order.push('insert'); return { id: 'tx_1' }; }),
    });
    mockInit.mockImplementation(async () => { order.push('provider'); return { success: true, authorizationUrl: 'https://co' }; });
    const r = await initializeTenantPayment(input, store);
    expect(order).toEqual(['insert', 'provider']);
    expect(r).toMatchObject({ ok: true, transactionId: 'tx_1', authorizationUrl: 'https://co', reused: false,
      snapshot: { amountMinor: 500000, platformFeeMinor: 5000, tenantGrossMinor: 495000, subaccountCode: 'ACCT_1', feeBearer: 'subaccount', policyCode: 'pilot_ngn_v1', policyVersion: 1 } });
    const row = (store.insertPending as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ tenant_id: 't1', amount: 5000, amount_minor: 500000, platform_fee_minor: 5000,
      tenant_gross_minor: 495000, settlement_subaccount_code: 'ACCT_1', settlement_fee_bearer: 'subaccount',
      settlement_policy_code: 'pilot_ngn_v1', settlement_policy_version: 1, settlement_idempotency_key: 'deposit:r1',
      settlement_verification_status: 'pending', status: 'pending', type: 'deposit', subject_type: 'reservation', subject_id: 'r1', currency: 'NGN' });
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 500000, subaccountCode: 'ACCT_1', transactionChargeMinor: 5000, currency: 'NGN' }));
    expect(store.initialized).toEqual(['tx_1']);
  });

  it('sends 500000 for NGN 5,000, never 50000000', async () => {
    mockInit.mockResolvedValue({ success: true, authorizationUrl: 'u' });
    await initializeTenantPayment(input, makeStore());
    expect((mockInit.mock.calls[0][0] as { amountMinor: number }).amountMinor).toBe(500000);
  });

  it('does not call Paystack when the insert fails', async () => {
    const store = makeStore({ insertPending: jest.fn(async () => { throw new Error('db down'); }) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ code: 'TRANSACTION_INSERT_FAILED' });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('marks the row failed when Paystack rejects', async () => {
    mockInit.mockResolvedValue({ success: false, error: 'Invalid subaccount' });
    const store = makeStore();
    expect(await initializeTenantPayment(input, store)).toMatchObject({ code: 'PROVIDER_INITIALIZATION_FAILED' });
    expect(store.failed).toEqual(['tx_1']);
  });

  it('reuses an existing pending checkout with an identical snapshot', async () => {
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => ({
      id: 'tx_old', status: 'pending', providerReference: 'bk_old', authorizationUrl: 'https://old',
      subjectType: 'reservation', subjectId: 'r1', amountMinor: 500000, platformFeeMinor: 5000,
      subaccountCode: 'ACCT_1', policyCode: 'pilot_ngn_v1', policyVersion: 1,
    })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: true, transactionId: 'tx_old', reused: true });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('refuses to reuse when the amount changed', async () => {
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => ({
      id: 'tx_old', status: 'pending', providerReference: 'bk_old', authorizationUrl: 'https://old',
      subjectType: 'reservation', subjectId: 'r1', amountMinor: 400000, platformFeeMinor: 4000,
      subaccountCode: 'ACCT_1', policyCode: 'pilot_ngn_v1', policyVersion: 1,
    })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('uses a reference Paystack accepts and never the wallet prefix', async () => {
    mockInit.mockResolvedValue({ success: true, authorizationUrl: 'u' });
    await initializeTenantPayment(input, makeStore());
    const ref = (mockInit.mock.calls[0][0] as { reference: string }).reference;
    expect(ref).toMatch(/^bk_[a-z0-9]{32}$/);
  });

  const old = (over: Record<string, unknown>) => ({
    id: 'tx_old', status: 'pending', providerReference: null, authorizationUrl: null,
    subjectType: 'reservation', subjectId: 'r1', amountMinor: 500000, platformFeeMinor: 5000,
    subaccountCode: 'ACCT_1', policyCode: 'pilot_ngn_v1', policyVersion: 1,
    createdAt: new Date().toISOString(), ...over,
  });

  it('releases the key of a failed row and creates a new payment', async () => {
    mockInit.mockResolvedValue({ success: true, authorizationUrl: 'https://new' });
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => old({ status: 'failed' })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: true, transactionId: 'tx_1', reused: false });
    expect(store.releaseKey).toHaveBeenCalledWith('tx_old');
    expect(store.inserted).toHaveLength(1);
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('abandons a stale pending row without a URL and continues', async () => {
    mockInit.mockResolvedValue({ success: true, authorizationUrl: 'https://new' });
    const createdAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => old({ createdAt })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: true, reused: false });
    expect(store.markFailed).toHaveBeenCalledWith('tx_old', 'abandoned');
    expect(store.inserted).toHaveLength(1);
  });

  it('treats a young pending row without a URL as in flight', async () => {
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => old({})) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(mockInit).not.toHaveBeenCalled();
    expect(store.inserted).toHaveLength(0);
  });

  it('still conflicts on a succeeded row', async () => {
    const store = makeStore({ findByIdempotencyKey: jest.fn(async () => old({ status: 'success', providerReference: 'r', authorizationUrl: 'u' })) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('returns SETTLEMENT_UNAVAILABLE when a pre-insert lookup throws', async () => {
    const store = makeStore({ loadAccount: jest.fn(async () => { throw new Error('db down'); }) });
    expect(await initializeTenantPayment(input, store)).toMatchObject({ ok: false, code: 'SETTLEMENT_UNAVAILABLE' });
    expect(mockInit).not.toHaveBeenCalled();
    expect(store.inserted).toHaveLength(0);
  });

  describe('default store', () => {
    function adminWith(readResult: { data: unknown; error: unknown }) {
      const updates: Record<string, unknown>[] = [];
      const admin = {
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => readResult }) }),
          update: (u: Record<string, unknown>) => { updates.push(u); return { eq: async () => ({ error: null }) }; },
        }),
      };
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin);
      return updates;
    }

    it('markFailed and releaseKey null the idempotency key', async () => {
      const updates = adminWith({ data: null, error: null });
      const st = defaultStore();
      await st.markFailed('tx', 'x');
      await st.releaseKey('tx');
      expect(updates[0]).toMatchObject({ status: 'failed', settlement_idempotency_key: null });
      expect(updates[1]).toEqual({ settlement_idempotency_key: null });
    });

    it('markInitialized does not overwrite raw when the read fails', async () => {
      const updates = adminWith({ data: null, error: { message: 'boom' } });
      await defaultStore().markInitialized('tx', 'https://u');
      expect(updates).toHaveLength(0);
    });

    it('markInitialized preserves existing raw', async () => {
      const updates = adminWith({ data: { raw: { ref: 'r' } }, error: null });
      await defaultStore().markInitialized('tx', 'https://u');
      expect(updates[0]).toEqual({ raw: { ref: 'r', authorization_url: 'https://u' } });
    });
  });
});
