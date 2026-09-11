import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Promotional wallet credits.
 *
 * `walletTopup.ts` enforces that credits enter a wallet only from a payment we
 * can prove. This file is the one deliberate exception: a code the business
 * hands out — a trial grant, a campaign, a goodwill gesture — redeemed once by
 * a tenant for a fixed amount.
 *
 * It stays a narrow exception in three ways:
 *
 * 1. The amount lives on the code row, not in the request. The caller supplies
 *    a code and nothing else, so there is no field to inflate.
 * 2. Validation, capping, crediting and the audit record happen inside one
 *    RPC, under a row lock on the code. Two simultaneous redemptions cannot
 *    both slip past the cap.
 * 3. The RPC is granted to service_role only, so it is unreachable with the
 *    anon key even if a route were mis-scoped.
 *
 * The plaintext code is never persisted. We hash it here and look up by hash.
 */

/**
 * Codes are matched case-insensitively — people type them off a slide or an
 * email — so normalize before hashing or "SUMMER" and "summer" become
 * different codes.
 */
export function hashPromoCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export type PromoRedemptionResult = {
  redeemed: boolean;
  balanceCredits: number;
  amountCredits: number;
  reason: string | null;
};

/**
 * @param admin MUST be the service-role client. redeem_wallet_promo is granted
 *   to service_role only; an anon-key client gets permission denied.
 */
export async function redeemWalletPromo(params: {
  admin: SupabaseClient;
  tenantId: string;
  code: string;
  redeemerUserId?: string | null;
}): Promise<PromoRedemptionResult> {
  const { data, error } = await params.admin.rpc('redeem_wallet_promo', {
    p_tenant_id: params.tenantId,
    p_code_hash: hashPromoCode(params.code),
    p_redeemer_user_id: params.redeemerUserId ?? null,
  });

  if (error) {
    throw new Error(`redeem_wallet_promo failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { redeemed?: boolean; balance_credits?: number; amount_credits?: number; reason?: string | null }
    | null
    | undefined;

  return {
    redeemed: Boolean(row?.redeemed),
    balanceCredits: Number(row?.balance_credits ?? 0),
    amountCredits: Number(row?.amount_credits ?? 0),
    reason: row?.reason ?? null,
  };
}
