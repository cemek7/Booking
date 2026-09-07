export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const queryReservationId = searchParams.get('reservation_id');
    const requestedTenantId = searchParams.get('tenant_id');
    const isSuperadmin = ctx.user?.role === 'superadmin';
    const tenantId = isSuperadmin ? requestedTenantId : getVerifiedTenantId(ctx);
    const client = isSuperadmin ? createSupabaseAdminClient() : ctx.supabase;

    let q = client
      .from('reservation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (tenantId) q = q.eq('tenant_id', tenantId);

    if (queryReservationId) {
      q = q.eq('reservation_id', queryReservationId);
    }

    const { data, error } = await q;
    if (error) {
      throw ApiErrorFactory.internalServerError(new Error(error.message));
    }

    return { data };
  },
  'GET',
  { auth: true, roles: ['owner', 'superadmin'] }
);
