import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/staff
 * Fetch staff members for a tenant
 *
 * Query params:
 * - tenant_id: Tenant ID (optional, uses ctx.user.tenantId if not provided)
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const tenantId = url.searchParams.get('tenant_id') || ctx.user!.tenantId;

    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .select('user_id,role,email,name')
      .eq('tenant_id', tenantId)
      .neq('role', 'owner')
      .order('role', { ascending: true });

    if (error) throw ApiErrorFactory.databaseError(error);

    const staff = (data || []).map((row: any) => ({
      id: row.user_id,
      name: row.name || row.email || row.user_id,
      email: row.email,
      role: row.role,
      status: 'active',
      staff_type: null
    }));

    return { staff };
  },
  'GET',
  { auth: true }
);
