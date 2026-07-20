export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { enterCount, getCountSessionWithItems } from '@/lib/inventory/stockCountService';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const UpdateCountSchema = z.object({
  item_id: z.string().uuid(),
  counted_quantity: z.number().int().min(0),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const sessionId = getRouteParam(ctx.params, 'id');
    return getCountSessionWithItems(ctx.supabase, tenantId, sessionId);
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'], permissions: [BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS] }
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const sessionId = getRouteParam(ctx.params, 'id');
    const parsed = UpdateCountSchema.safeParse((await ctx.request.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const current = await getCountSessionWithItems(ctx.supabase, tenantId, sessionId);
    if (!current.items.some((item) => item.id === parsed.data.item_id)) {
      throw ApiErrorFactory.notFound('Stock count item');
    }

    const item = await enterCount(ctx.supabase, parsed.data.item_id, parsed.data.counted_quantity);
    return { item };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager', 'staff'], permissions: [BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS] }
);
