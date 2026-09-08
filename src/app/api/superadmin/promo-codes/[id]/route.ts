export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { setPromoCodeActive } from '@/lib/billing/walletPromoAdmin';

const PatchSchema = z.object({ active: z.boolean() });

/**
 * Deactivation, not deletion. A redeemed code is an accounting record, and 146
 * blocks deleting one that has grants against it.
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id;
    if (!id) throw ApiErrorFactory.validationError({ id: 'Promo code id is required' });

    const parsed = PatchSchema.safeParse(await ctx.request.json());
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const admin = createSupabaseAdminClient();
    const row = await setPromoCodeActive({ admin, id, active: parsed.data.active });
    return { success: true, data: row };
  },
  'PATCH',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false },
);
