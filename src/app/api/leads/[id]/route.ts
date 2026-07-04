export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager', 'staff'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager', 'staff']);
    }

    const tenantId = ctx.user?.tenantId;
    const id = ctx.params?.id;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    if (!id) throw ApiErrorFactory.validationError({ id: 'Lead ID required' });

    const { data, error } = await ctx.supabase
      .from('leads')
      .select('id,name,phone,email,source,intent,notes,status,follow_up_at,followed_up_at,created_at,stage,qualified_at,last_contacted_at')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw ApiErrorFactory.databaseError(error);
    if (!data) throw ApiErrorFactory.notFound('Lead');

    return { data };
  },
  'GET',
  { auth: true }
);
