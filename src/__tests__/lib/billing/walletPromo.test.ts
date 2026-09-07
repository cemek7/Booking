import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Promotional credit is the one route that adds value to a wallet without a
 * payment, so the invariants under test are: the caller cannot influence the
 * amount, the plaintext code never leaves this process, and a failure tells
 * the caller nothing it could use to hunt for valid codes.
 */

import { hashPromoCode, redeemWalletPromo } from '@/lib/billing/walletPromo';
import type { SupabaseClient } from '@supabase/supabase-js';

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

const admin = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return rpcResult;
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = {
    data: [{ redeemed: true, balance_credits: 1500, amount_credits: 500, reason: null }],
    error: null,
  };
  jest.clearAllMocks();
});

describe('hashPromoCode', () => {
  it('is case- and whitespace-insensitive so a code typed off a slide still works', () => {
    expect(hashPromoCode('  summer26 ')).toBe(hashPromoCode('SUMMER26'));
  });

  it('produces a sha256 hex digest rather than anything reversible', () => {
    expect(hashPromoCode('SUMMER26')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates codes that differ', () => {
    expect(hashPromoCode('SUMMER26')).not.toBe(hashPromoCode('SUMMER27'));
  });
});

describe('redeemWalletPromo', () => {
  it('sends only the tenant, the hash and the redeemer — never an amount', async () => {
    await redeemWalletPromo({ admin, tenantId: 't1', code: 'SUMMER26', redeemerUserId: 'u1' });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('redeem_wallet_promo');
    expect(rpcCalls[0].args).toEqual({
      p_tenant_id: 't1',
      p_code_hash: hashPromoCode('SUMMER26'),
      p_redeemer_user_id: 'u1',
    });
  });

  it('never transmits the plaintext code', async () => {
    await redeemWalletPromo({ admin, tenantId: 't1', code: 'SUMMER26' });
    expect(JSON.stringify(rpcCalls[0].args)).not.toContain('SUMMER26');
  });

  it('returns the granted amount and new balance from the database, not the caller', async () => {
    const result = await redeemWalletPromo({ admin, tenantId: 't1', code: 'SUMMER26' });
    expect(result).toEqual({
      redeemed: true,
      balanceCredits: 1500,
      amountCredits: 500,
      reason: null,
    });
  });

  it('reports a rejected code without crediting anything', async () => {
    rpcResult = {
      data: [{ redeemed: false, balance_credits: 0, amount_credits: 0, reason: 'invalid_promo' }],
      error: null,
    };
    const result = await redeemWalletPromo({ admin, tenantId: 't1', code: 'EXPIRED' });
    expect(result.redeemed).toBe(false);
    expect(result.amountCredits).toBe(0);
  });

  it('defaults an absent redeemer to null rather than sending undefined', async () => {
    await redeemWalletPromo({ admin, tenantId: 't1', code: 'SUMMER26' });
    expect(rpcCalls[0].args.p_redeemer_user_id).toBeNull();
  });

  it('surfaces a database error instead of reporting a silent success', async () => {
    rpcResult = { data: null, error: { message: 'permission denied' } };
    await expect(redeemWalletPromo({ admin, tenantId: 't1', code: 'SUMMER26' }))
      .rejects.toThrow('permission denied');
  });
});
