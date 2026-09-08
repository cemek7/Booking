import { randomInt } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashPromoCode } from './walletPromo';

/**
 * Superadmin management of promotional codes.
 *
 * 146 stores only a SHA-256 hash of each code, which is the right call for a
 * credential — and it has one consequence that shapes this whole file: **a code
 * cannot be recovered.** Not by a superadmin, not from a backup, not by us.
 * So `createPromoCode` returns the plaintext exactly once, at creation, and the
 * UI has to treat that response as the only chance to copy it.
 *
 * Everything a superadmin can do afterwards — list, deactivate, reactivate —
 * works on the hash and the metadata, never the code.
 */

/**
 * Ambiguous glyphs are excluded. These codes get read off a slide, a printed
 * flyer or a support call, and 0/O and 1/I/L are where that goes wrong.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GENERATED_CODE_LENGTH = 10;

/** randomInt, not Math.random: these are credentials worth real money. */
export function generatePromoCode(): string {
  let out = '';
  for (let i = 0; i < GENERATED_CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

export type PromoCodeInput = {
  campaign: string;
  amountCredits: number;
  code?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
  maxRedemptionsPerTenant?: number;
};

export type PromoCodeRow = {
  id: string;
  campaign: string;
  amount_credits: number | string;
  starts_at: string | null;
  expires_at: string | null;
  max_redemptions: number | null;
  max_redemptions_per_tenant: number;
  active: boolean;
  created_at: string;
};

export type PromoCodeSummary = PromoCodeRow & { redemptions: number };

export class PromoCodeConflictError extends Error {
  constructor() {
    super('That code already exists. Choose another, or let one be generated.');
    this.name = 'PromoCodeConflictError';
  }
}

/** Postgres unique_violation. A duplicate code is a user mistake, not a 500. */
const UNIQUE_VIOLATION = '23505';

export async function createPromoCode(params: {
  admin: SupabaseClient;
  input: PromoCodeInput;
}): Promise<{ row: PromoCodeRow; code: string }> {
  const code = (params.input.code?.trim() || generatePromoCode()).toUpperCase();

  const { data, error } = await params.admin
    .from('wallet_promo_codes')
    .insert({
      code_hash: hashPromoCode(code),
      campaign: params.input.campaign.trim(),
      amount_credits: params.input.amountCredits,
      starts_at: params.input.startsAt ?? null,
      expires_at: params.input.expiresAt ?? null,
      max_redemptions: params.input.maxRedemptions ?? null,
      max_redemptions_per_tenant: params.input.maxRedemptionsPerTenant ?? 1,
    })
    .select('*')
    .single();

  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new PromoCodeConflictError();
    }
    throw new Error(`Could not create promo code: ${error.message}`);
  }

  // The only time this value exists outside the redeemer's hands.
  return { row: data as PromoCodeRow, code };
}

export async function listPromoCodes(params: {
  admin: SupabaseClient;
  limit?: number;
}): Promise<PromoCodeSummary[]> {
  const limit = Math.min(100, Math.max(1, params.limit ?? 25));

  const { data, error } = await params.admin
    .from('wallet_promo_codes')
    .select('id, campaign, amount_credits, starts_at, expires_at, max_redemptions, max_redemptions_per_tenant, active, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not load promo codes: ${error.message}`);

  const rows = (data ?? []) as PromoCodeRow[];

  // One bounded COUNT per listed code. Exact, and capped by the page size
  // above — - unlike fetching redemption rows, which grows with the campaign.
  const counts = await Promise.all(
    rows.map(async (row) => {
      const { count, error: countError } = await params.admin
        .from('wallet_promo_redemptions')
        .select('*', { count: 'exact', head: true })
        .eq('promo_code_id', row.id);
      if (countError) throw new Error(`Could not count redemptions: ${countError.message}`);
      return count ?? 0;
    }),
  );

  return rows.map((row, i) => ({ ...row, redemptions: counts[i] }));
}

/**
 * Deactivating is the only "delete" offered. A redeemed code is an accounting
 * record — 146 puts ON DELETE RESTRICT on the redemption reference for the same
 * reason — so retiring a campaign must not be able to erase the grants it made.
 */
export async function setPromoCodeActive(params: {
  admin: SupabaseClient;
  id: string;
  active: boolean;
}): Promise<PromoCodeRow> {
  const { data, error } = await params.admin
    .from('wallet_promo_codes')
    .update({ active: params.active })
    .eq('id', params.id)
    .select('*')
    .single();

  if (error) throw new Error(`Could not update promo code: ${error.message}`);
  return data as PromoCodeRow;
}
