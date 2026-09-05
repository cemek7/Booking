export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantWalletSummary, topUpTenantWallet } from '@/lib/billing/ai-wallet';

/**
 * POST is a SUPERADMIN operation and credits the wallet with no payment in the
 * loop, so it must never be reachable by a tenant owner.
 *
 * It used to be `roles: ['owner']`, which let any authenticated owner mint
 * themselves unlimited message credits — and book them as revenue, because
 * topUpTenantWallet also writes a `wallet_topup` row to the revenue ledger.
 * Migration 142 revoked EXECUTE on `topup_ai_wallet` to `service_role`, which
 * closed that hole but also broke this route: it passed `ctx.supabase`, an
 * anon-key client running as `authenticated`, so the RPC began returning
 * permission denied. Hence the admin client below.
 *
 * The owner-facing, *paid* top-up is a separate route: it initializes a
 * Paystack transaction and credits the wallet only from the verified webhook.
 */
const TopUpSchema = z.object({
  tenant_id: z.string().uuid('tenant_id must be a UUID'),
  amount_credits: z.number().positive('Amount must be greater than zero'),
  description: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(120).optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant context required');
    }

    const summary = await getTenantWalletSummary(ctx.supabase, tenantId);
    if (!summary) {
      throw ApiErrorFactory.databaseError(new Error('Unable to load wallet summary'));
    }

    return { success: true, ...summary };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const parsed = TopUpSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    // service_role: topup_ai_wallet is granted to service_role only (142).
    const admin = createSupabaseAdminClient();

    const result = await topUpTenantWallet(
      admin,
      parsed.data.tenant_id,
      parsed.data.amount_credits,
      parsed.data.description ?? 'Superadmin manual top-up',
      parsed.data.reference
    );

    if (!result.allowed) {
      throw ApiErrorFactory.databaseError(new Error(result.reason || 'Failed to top up wallet'));
    }

    const summary = await getTenantWalletSummary(admin, parsed.data.tenant_id);
    return { success: true, ...summary };
  },
  'POST',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
