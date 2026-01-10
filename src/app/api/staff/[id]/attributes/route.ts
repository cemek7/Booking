import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const PATCH = createHttpHandler(
  async (ctx) => {
    const id = ctx.request.url.split('/').slice(-2, -1)[0];
    if (!id) throw ApiErrorFactory.badRequest('Staff ID required');
    
    const body = await ctx.request.json();
    const { role, staff_type } = body || {};
    
    if (!role && !staff_type) {
      throw ApiErrorFactory.badRequest('Nothing to update');
    }
    
    const patch: Record<string, any> = {};
    if (role) patch.role = role;
    if (typeof staff_type === 'string') patch.staff_type = staff_type;
    
    const { error } = await ctx.supabase
      .from('tenant_users')
      .update(patch)
      .eq('tenant_id', ctx.user!.tenantId)
      .eq('user_id', id);
    
    if (error) throw ApiErrorFactory.internal('Failed to update staff attributes');
    
    return { ok: true };
  },
  'PATCH',
  { auth: true }
);