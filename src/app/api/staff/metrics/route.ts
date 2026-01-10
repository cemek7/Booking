import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const tenantId = url.searchParams.get('tenant_id');
    
    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id required');
    }

    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .select('user_id, role')
      .eq('tenant_id', tenantId)
      .neq('role', 'owner');

    if (error) {
      throw ApiErrorFactory.internal('Failed to fetch staff');
    }

    const staff = (data || []) as Array<{ user_id: string; role: string }>;
    const metrics = staff.map(s => ({
      user_id: s.user_id,
      rating: null as number | null,
      completed: 0,
      revenue: 0
    }));

    return { metrics };
  },
  'GET',
  { auth: true }
);
