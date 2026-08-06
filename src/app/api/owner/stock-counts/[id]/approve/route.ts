export const dynamic = 'force-dynamic';

import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { approveSession } from '@/lib/inventory/stockCountService';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

export const POST = createHttpHandler(
  async (ctx) => {
    const sessionId = getRouteParam(ctx.params, 'id');
    const tenantId = getVerifiedTenantId(ctx);
    const session = await approveSession(ctx.supabase, sessionId, ctx.user?.id ?? 'unknown', tenantId);
    return { session };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.ADJUST_INVENTORY] }
);
