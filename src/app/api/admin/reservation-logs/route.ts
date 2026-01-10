import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const queryReservationId = searchParams.get('reservation_id');
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.badRequest('Tenant ID is required');
    }

    let q = ctx.supabase
      .from('reservation_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (queryReservationId) {
      q = q.eq('reservation_id', queryReservationId);
    }

    const { data, error } = await q;
    if (error) {
      throw ApiErrorFactory.internal(error.message);
    }

    return { data };
  },
  'GET',
  { auth: true, roles: ['owner', 'admin', 'global_admin'] }
);
