export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { startWalletCheckout, resolveTopupEmail } from '@/lib/billing/walletTopup';

/**
 * Owner-facing wallet top-up. Returns a Paystack checkout URL; nothing is
 * credited here. The wallet moves only when the signed `charge.success`
 * webhook arrives and `credit_wallet_topup` claims the matching intent.
 *
 * 1 credit = NGN 1.
 */
const CheckoutSchema = z.object({
  amount_credits: z.number().positive('Amount must be greater than zero').max(10_000_000),
  // Optional so an owner without a stored email can still pay; the address is
  // needed because Paystack keys the reusable authorization to it.
  email: z.string().email().optional(),
  callback_url: z.string().url().optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant context required');
    }

    const body = await ctx.request.json();
    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    // service_role: the intents table is written by the service role only, so
    // an owner cannot forge an intent and credit themselves.
    const admin = createSupabaseAdminClient();

    const email = parsed.data.email ?? await resolveTopupEmail(admin, tenantId);
    if (!email) {
      throw ApiErrorFactory.validationError({
        email: 'No email on file for this account. Send one with the request.',
      });
    }

    const result = await startWalletCheckout({
      admin,
      tenantId,
      amountCredits: parsed.data.amount_credits,
      email,
      callbackUrl: parsed.data.callback_url,
    });

    if (!result.success) {
      throw ApiErrorFactory.externalServiceError(result.error ?? 'Could not start checkout');
    }

    return {
      success: true,
      authorization_url: result.authorizationUrl,
      reference: result.reference,
    };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);
