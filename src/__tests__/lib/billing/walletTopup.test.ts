import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * The invariant under test: credits enter a wallet ONLY from a payment this
 * server can prove happened, and a Paystack webhook retry — which is routine —
 * never credits twice. Everything else here is subordinate to that.
 */

const mockInitialize = jest.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>();
const mockCharge = jest.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>();
jest.mock('@/lib/paystack', () => ({
  initializeTransaction: (...a: unknown[]) => mockInitialize(...a),
  chargeAuthorization: (...a: unknown[]) => mockCharge(...a),
}));
jest.mock('@/lib/billing/walletAlerts', () => ({
  resolveTenantOwner: async () => ({ email: 'ada@salon.ng', phone: '234801' }),
}));

import {
  createTopupIntent, startWalletCheckout, creditVerifiedTopup, attemptAutoRecharge,
  creditsToMinor,
} from '@/lib/billing/walletTopup';

// ── admin harness ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const inserts: Array<{ table: string; row: Row }> = [];
const updates: Array<{ table: string; patch: Row }> = [];
const rpcCalls: Array<{ fn: string; args: Row }> = [];
let insertResult: { data: unknown; error: unknown } = { data: { id: 'intent-1' }, error: null };
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

function makeQuery(table: string) {
  const q: Record<string, unknown> = {};
  let isUpdate = false;
  Object.assign(q, {
    insert: (row: Row) => { inserts.push({ table, row }); return q; },
    update: (patch: Row) => { isUpdate = true; updates.push({ table, patch }); return q; },
    select: () => q,
    eq: () => q,
    single: async () => insertResult,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(isUpdate ? { data: null, error: null } : { data: null, error: null }).then(res, rej),
  });
  return q;
}

const admin = {
  from: (table: string) => makeQuery(table),
  rpc: async (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return rpcResult; },
} as never;

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  rpcCalls.length = 0;
  insertResult = { data: { id: 'intent-1' }, error: null };
  rpcResult = { data: null, error: null };
  mockInitialize.mockReset().mockResolvedValue({
    success: true, authorizationUrl: 'https://checkout.paystack.com/abc',
  });
  mockCharge.mockReset().mockResolvedValue({ success: true, chargeStatus: 'success' });
});

describe('creditsToMinor', () => {
  it('converts credits to kobo at 1 credit = NGN 1', () => {
    expect(creditsToMinor(500)).toBe(50_000);
    expect(creditsToMinor(0.5)).toBe(50);
  });
});

describe('createTopupIntent', () => {
  it('records the tenant and amount before any charge is started', async () => {
    const intent = await createTopupIntent({
      admin, tenantId: 'tenant-1', amountCredits: 500, email: 'ada@salon.ng',
    });

    // The webhook reads tenant and amount from this row, never from the
    // payload — so the row has to exist before the customer pays.
    expect(inserts[0].table).toBe('wallet_topup_intents');
    expect(inserts[0].row).toMatchObject({
      tenant_id: 'tenant-1', amount_credits: 500, amount_minor: 50_000, origin: 'manual',
    });
    expect(intent!.reference).toMatch(/^bokawallet_[0-9a-f]{32}$/);
  });

  it('returns null rather than a reference when the row could not be written', async () => {
    insertResult = { data: null, error: { message: 'boom' } };

    const intent = await createTopupIntent({
      admin, tenantId: 'tenant-1', amountCredits: 500, email: 'ada@salon.ng',
    });

    // Charging with no intent would take the customer's money with nothing to
    // attribute it to.
    expect(intent).toBeNull();
  });
});

describe('startWalletCheckout', () => {
  it('asks Paystack for card only, and passes the intent reference', async () => {
    const res = await startWalletCheckout({
      admin, tenantId: 'tenant-1', amountCredits: 500, email: 'ada@salon.ng',
    });

    const sent = mockInitialize.mock.calls[0][0] as Record<string, unknown>;
    // A bank-transfer or USSD authorization is never reusable, so a non-card
    // top-up could never become auto-recharge.
    expect(sent.channels).toEqual(['card']);
    expect(sent.amountMinor).toBe(50_000);
    expect(sent.reference).toBe((inserts[0].row as Row).reference);
    expect(res.authorizationUrl).toBe('https://checkout.paystack.com/abc');
  });

  it('abandons the intent when checkout could not be opened', async () => {
    mockInitialize.mockResolvedValue({ success: false, error: 'provider down' });

    const res = await startWalletCheckout({
      admin, tenantId: 'tenant-1', amountCredits: 500, email: 'ada@salon.ng',
    });

    expect(res.success).toBe(false);
    // Otherwise a pending intent lingers for a checkout that never opened.
    expect(updates).toContainEqual({ table: 'wallet_topup_intents', patch: { status: 'abandoned' } });
  });

  it('never credits the wallet itself', async () => {
    await startWalletCheckout({
      admin, tenantId: 'tenant-1', amountCredits: 500, email: 'ada@salon.ng',
    });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('creditVerifiedTopup', () => {
  it('credits through the RPC and reports the tenant', async () => {
    rpcResult = { data: [{ credited: true, tenant_id: 'tenant-1', amount_credits: '500' }], error: null };

    const res = await creditVerifiedTopup({ admin, reference: 'bokawallet_x', amountMinor: 50_000 });

    expect(rpcCalls[0]).toEqual({
      fn: 'credit_wallet_topup',
      args: { p_reference: 'bokawallet_x', p_amount_minor: 50_000 },
    });
    expect(res).toMatchObject({ credited: true, tenantId: 'tenant-1', amountCredits: 500 });
  });

  it('treats a replayed webhook as a no-op, not a failure', async () => {
    rpcResult = { data: [{ credited: false, reason: 'no_pending_intent' }], error: null };

    const res = await creditVerifiedTopup({ admin, reference: 'bokawallet_x', amountMinor: 50_000 });

    expect(res.credited).toBe(false);
    expect(res.reason).toBe('no_pending_intent');
    expect(updates).toHaveLength(0);
  });

  it('throws on an RPC error so the provider retries delivery', async () => {
    rpcResult = { data: null, error: { message: 'deadlock' } };

    // Swallowing this would drop a payment the customer already made.
    await expect(
      creditVerifiedTopup({ admin, reference: 'bokawallet_x', amountMinor: 50_000 }),
    ).rejects.toThrow(/credit_wallet_topup/);
  });

  it('stores a reusable card authorization', async () => {
    rpcResult = { data: [{ credited: true, tenant_id: 'tenant-1', amount_credits: 500 }], error: null };

    await creditVerifiedTopup({
      admin, reference: 'bokawallet_x', amountMinor: 50_000,
      customerEmail: 'ada@salon.ng',
      authorization: { authorization_code: 'AUTH_1', reusable: true, last4: '4081', card_type: 'visa' },
    });

    expect(updates).toContainEqual(expect.objectContaining({
      table: 'ai_wallets',
      patch: expect.objectContaining({
        paystack_authorization_code: 'AUTH_1',
        paystack_authorization_email: 'ada@salon.ng',
      }),
    }));
  });

  it('refuses to store a NON-reusable authorization', async () => {
    rpcResult = { data: [{ credited: true, tenant_id: 'tenant-1', amount_credits: 500 }], error: null };

    await creditVerifiedTopup({
      admin, reference: 'bokawallet_x', amountMinor: 50_000,
      customerEmail: 'ada@salon.ng',
      authorization: { authorization_code: 'AUTH_1', reusable: false },
    });

    // Storing it would arm auto-recharge with a card Paystack declines every
    // time it matters.
    expect(updates).toHaveLength(0);
  });

  it('refuses to store an authorization with no email', async () => {
    rpcResult = { data: [{ credited: true, tenant_id: 'tenant-1', amount_credits: 500 }], error: null };

    await creditVerifiedTopup({
      admin, reference: 'bokawallet_x', amountMinor: 50_000,
      customerEmail: null,
      authorization: { authorization_code: 'AUTH_1', reusable: true },
    });

    // Paystack rejects a charge sent with any other email, so a code without
    // its email is unusable.
    expect(updates).toHaveLength(0);
  });
});

describe('attemptAutoRecharge', () => {
  const armed = {
    auto_recharge_enabled: true,
    auto_recharge_amount_credits: 1000,
    paystack_authorization_code: 'AUTH_1',
    paystack_authorization_email: 'ada@salon.ng',
  };

  it('does nothing when the flag is off', async () => {
    expect(await attemptAutoRecharge({
      admin, tenantId: 'tenant-1', wallet: { ...armed, auto_recharge_enabled: false },
    })).toBe(false);
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('does nothing when there is no saved card', async () => {
    expect(await attemptAutoRecharge({
      admin, tenantId: 'tenant-1', wallet: { ...armed, paystack_authorization_code: null },
    })).toBe(false);
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('charges the saved card with its own email and credits the wallet', async () => {
    rpcResult = { data: [{ credited: true, tenant_id: 'tenant-1', amount_credits: 1000 }], error: null };

    const ok = await attemptAutoRecharge({ admin, tenantId: 'tenant-1', wallet: armed });

    const sent = mockCharge.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.email).toBe('ada@salon.ng');
    expect(sent.amountMinor).toBe(100_000);
    expect((inserts[0].row as Row).origin).toBe('auto_recharge');
    expect(ok).toBe(true);
  });

  it('treats a declined card as a failure even though the API call succeeded', async () => {
    // Paystack returns HTTP 200 with data.status 'failed' for a decline, so
    // trusting `success` alone would credit a wallet nobody paid for.
    mockCharge.mockResolvedValue({
      success: true, chargeStatus: 'failed', gatewayResponse: 'Insufficient funds',
    });

    const ok = await attemptAutoRecharge({ admin, tenantId: 'tenant-1', wallet: armed });

    expect(ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
    expect(updates).toContainEqual(expect.objectContaining({
      table: 'ai_wallets',
      patch: expect.objectContaining({ auto_recharge_failure_reason: 'Insufficient funds' }),
    }));
  });

  it('backs off after a recent decline instead of retrying every send', async () => {
    const ok = await attemptAutoRecharge({
      admin, tenantId: 'tenant-1',
      wallet: { ...armed, auto_recharge_failed_at: new Date(Date.now() - 60_000).toISOString() },
    });

    expect(ok).toBe(false);
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it('retries once the backoff has elapsed', async () => {
    rpcResult = { data: [{ credited: true, tenant_id: 'tenant-1', amount_credits: 1000 }], error: null };

    const ok = await attemptAutoRecharge({
      admin, tenantId: 'tenant-1',
      wallet: {
        ...armed,
        auto_recharge_failed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      },
    });

    expect(mockCharge).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it('does not throw when the charge itself throws', async () => {
    mockCharge.mockRejectedValue(new Error('network'));

    // Called from the reserve path: a throw here would break an inbound send.
    await expect(
      attemptAutoRecharge({ admin, tenantId: 'tenant-1', wallet: armed }),
    ).resolves.toBe(false);
  });
});
