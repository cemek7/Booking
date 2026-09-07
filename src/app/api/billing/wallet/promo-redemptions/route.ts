export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { redeemWalletPromo } from '@/lib/billing/walletPromo';

/**
 * Owner-facing promo redemption. The request carries a code and nothing else —
 * no amount, no tenant, no campaign — so there is no value here for a caller
 * to tamper with. The grant comes from the code row.
 */
const RedeemSchema = z.object({
  code: z.string().trim().min(1, 'Enter a promo code').max(128),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant context required');
    }

    const body = await ctx.request.json();
    const parsed = RedeemSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    // service_role: redeem_wallet_promo is granted to service_role only (146).
    const admin = createSupabaseAdminClient();

    const result = await redeemWalletPromo({
      admin,
      tenantId,
      code: parsed.data.code,
      redeemerUserId: ctx.user?.id ?? null,
    });

    if (!result.redeemed) {
      // The RPC returns one undifferentiated reason for every failure so a
      // caller cannot probe for valid codes; keep it that way in the response.
      throw ApiErrorFactory.validationError({
        code: 'That code is not valid, has expired, or has already been used.',
      });
    }

    return {
      success: true,
      amount_credits: result.amountCredits,
      balance_credits: result.balanceCredits,
    };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);
