export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * Owner-facing auto-recharge settings.
 *
 * The authorization code itself is NEVER returned. It is a bearer credential
 * for charging the tenant's card, and the browser has no use for it — the brand
 * and last four are all an owner needs to recognise their own card.
 *
 * Turning auto-recharge on is the tenant saying "yes, charge me": it stays off
 * by default for every tenant and is never enabled on their behalf.
 */

const SELECT =
  'auto_recharge_enabled, auto_recharge_threshold_credits, auto_recharge_amount_credits, '
  + 'paystack_authorization_code, paystack_card_brand, paystack_card_last4, '
  + 'paystack_authorization_saved_at, auto_recharge_failed_at, auto_recharge_failure_reason';

type WalletRow = {
  auto_recharge_enabled?: boolean | null;
  auto_recharge_threshold_credits?: number | string | null;
  auto_recharge_amount_credits?: number | string | null;
  paystack_authorization_code?: string | null;
  paystack_card_brand?: string | null;
  paystack_card_last4?: string | null;
  paystack_authorization_saved_at?: string | null;
  auto_recharge_failed_at?: string | null;
  auto_recharge_failure_reason?: string | null;
};

function present(row: WalletRow | null) {
  return {
    enabled: !!row?.auto_recharge_enabled,
    threshold_credits: row?.auto_recharge_threshold_credits != null
      ? Number(row.auto_recharge_threshold_credits) : null,
    amount_credits: row?.auto_recharge_amount_credits != null
      ? Number(row.auto_recharge_amount_credits) : null,
    // Deliberately a boolean, not the code.
    has_saved_card: !!row?.paystack_authorization_code,
    card_brand: row?.paystack_card_brand ?? null,
    card_last4: row?.paystack_card_last4 ?? null,
    card_saved_at: row?.paystack_authorization_saved_at ?? null,
    last_failure_at: row?.auto_recharge_failed_at ?? null,
    last_failure_reason: row?.auto_recharge_failure_reason ?? null,
  };
}

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('ai_wallets')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw ApiErrorFactory.databaseError(error);
    }

    return { success: true, ...present(data as WalletRow | null) };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  threshold_credits: z.number().positive().max(10_000_000).optional(),
  amount_credits: z.number().positive().max(10_000_000).optional(),
});

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const body = await ctx.request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const admin = createSupabaseAdminClient();
    const { data: current, error: readErr } = await admin
      .from('ai_wallets')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (readErr && readErr.code !== 'PGRST116') {
      throw ApiErrorFactory.databaseError(readErr);
    }
    const row = current as WalletRow | null;

    const next = {
      enabled: parsed.data.enabled ?? !!row?.auto_recharge_enabled,
      threshold: parsed.data.threshold_credits
        ?? (row?.auto_recharge_threshold_credits != null
          ? Number(row.auto_recharge_threshold_credits) : null),
      amount: parsed.data.amount_credits
        ?? (row?.auto_recharge_amount_credits != null
          ? Number(row.auto_recharge_amount_credits) : null),
    };

    if (next.enabled) {
      // Refuse to arm something that cannot fire. An owner who flips this on
      // with no card would believe they are covered and find out at the moment
      // their bot goes quiet — the exact failure this whole feature prevents.
      if (!row?.paystack_authorization_code) {
        throw ApiErrorFactory.validationError({
          card: 'Top up once by card first — auto top-up needs a saved card to charge.',
        });
      }
      if (!next.amount || next.amount <= 0) {
        throw ApiErrorFactory.validationError({
          amount_credits: 'Set how many credits to add each time.',
        });
      }
    }

    const { error } = await admin
      .from('ai_wallets')
      .update({
        auto_recharge_enabled: next.enabled,
        auto_recharge_threshold_credits: next.threshold,
        auto_recharge_amount_credits: next.amount,
      })
      .eq('tenant_id', tenantId);

    if (error) throw ApiErrorFactory.databaseError(error);

    const { data: after } = await admin
      .from('ai_wallets')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    return { success: true, ...present(after as WalletRow | null) };
  },
  'PATCH',
  { auth: true, roles: ['owner'] }
);
