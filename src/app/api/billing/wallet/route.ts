export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getTenantWalletSummary, topUpTenantWallet } from '@/lib/billing/ai-wallet';

const TopUpSchema = z.object({
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
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant context required');
    }

    const body = await ctx.request.json();
    const parsed = TopUpSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const result = await topUpTenantWallet(
      ctx.supabase,
      tenantId,
      parsed.data.amount_credits,
      parsed.data.description,
      parsed.data.reference
    );

    if (!result.allowed) {
      throw ApiErrorFactory.databaseError(new Error(result.reason || 'Failed to top up wallet'));
    }

    const summary = await getTenantWalletSummary(ctx.supabase, tenantId);
    return { success: true, ...summary };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);
