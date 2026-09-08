export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  createPromoCode,
  listPromoCodes,
  PromoCodeConflictError,
} from '@/lib/billing/walletPromoAdmin';

/**
 * Promotional codes are the one route that adds wallet value without a
 * payment, so creating them is superadmin-only and never reachable by a tenant
 * owner — the same boundary the wallet top-up route draws.
 */

const CreateSchema = z.object({
  campaign: z.string().trim().min(1, 'Name the campaign').max(80),
  amount_credits: z.number().positive('Amount must be greater than zero').max(1_000_000),
  // Blank means "generate one for me", which is the safer default.
  code: z.string().trim().min(4).max(64).regex(
    /^[A-Za-z0-9-]+$/,
    'Use letters, numbers and hyphens only',
  ).optional().nullable(),
  starts_at: z.string().datetime({ offset: true }).optional().nullable(),
  expires_at: z.string().datetime({ offset: true }).optional().nullable(),
  max_redemptions: z.number().int().positive().optional().nullable(),
  max_redemptions_per_tenant: z.number().int().positive().max(1000).default(1),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const limit = Number(url.searchParams.get('limit') || '25') || 25;
    const admin = createSupabaseAdminClient();
    return { data: await listPromoCodes({ admin, limit }) };
  },
  'GET',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false },
);

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = CreateSchema.safeParse(await ctx.request.json());
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    // The database enforces this too; checking here returns a usable message
    // instead of a constraint violation.
    if (parsed.data.starts_at && parsed.data.expires_at
        && new Date(parsed.data.expires_at) <= new Date(parsed.data.starts_at)) {
      throw ApiErrorFactory.validationError({ expires_at: 'Expiry must be after the start date' });
    }

    const admin = createSupabaseAdminClient();
    try {
      const { row, code } = await createPromoCode({
        admin,
        input: {
          campaign: parsed.data.campaign,
          amountCredits: parsed.data.amount_credits,
          code: parsed.data.code ?? null,
          startsAt: parsed.data.starts_at ?? null,
          expiresAt: parsed.data.expires_at ?? null,
          maxRedemptions: parsed.data.max_redemptions ?? null,
          maxRedemptionsPerTenant: parsed.data.max_redemptions_per_tenant,
        },
      });

      // `code` is returned exactly once. Only its hash is stored, so nothing —
      // here or in the database — can produce it again.
      return { success: true, data: { ...row, redemptions: 0 }, code };
    } catch (err) {
      if (err instanceof PromoCodeConflictError) {
        throw ApiErrorFactory.validationError({ code: err.message });
      }
      throw err;
    }
  },
  'POST',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false },
);
