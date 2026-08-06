export const dynamic = 'force-dynamic';

import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { listRecommendations } from '@/lib/recommendations/outcomes';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const url = new URL(ctx.request.url);
    const admin = createSupabaseAdminClient();
    const recommendations = await listRecommendations(admin, tenantId, {
      status: url.searchParams.get('status') ?? undefined,
      type: url.searchParams.get('type') ?? undefined,
      includeSnoozed: url.searchParams.get('include_snoozed') === 'true',
    });
    return { recommendations };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.VIEW_ANALYTICS] },
);
