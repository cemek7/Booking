export const dynamic = 'force-dynamic';

import { z } from 'zod';

import { createHttpHandler, getRouteParam } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import { mergeCustomers } from '@/lib/customers/merge';

const MergeSchema = z.object({
  loser_id: z.string().uuid(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const survivorId = getRouteParam(ctx.params, 'id');
    const parsed = MergeSchema.safeParse(await ctx.request.json().catch(() => ({})));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const tenantId = ctx.user!.tenantId!;
    const admin = createSupabaseAdminClient();
    const merged = await mergeCustomers(admin, {
      tenantId,
      survivorId,
      loserId: parsed.data.loser_id,
      actorId: ctx.user!.id,
    });

    return { merged };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.MERGE_CUSTOMERS] },
);
