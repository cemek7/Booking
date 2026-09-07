export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

export const PATCH = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id;
    if (!id) throw ApiErrorFactory.badRequest('User ID required');

    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.badRequest('tenant_id required');

    const payload = await ctx.request.json().catch(() => ({}));
    const nextStatus = (payload?.status || '').toString();

    if (!nextStatus || !['active', 'on_leave'].includes(nextStatus)) {
      throw ApiErrorFactory.badRequest('Invalid status. Must be "active" or "on_leave"');
    }

    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .update({ status: nextStatus })
      .eq('tenant_id', tenantId)
      .eq('user_id', id)
      .select('user_id,status')
      .single();

    if (error) {
      throw ApiErrorFactory.internalServerError(new Error('Failed to update status'));
    }

    return { ok: true, user_id: data?.user_id, status: data?.status };
  },
  'PATCH',
  { auth: true, permissions: [BOOKA_PERMISSIONS.MANAGE_STAFF] }
);
