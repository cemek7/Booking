export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * DELETE /api/staff/[id]
 * Remove a staff member from the caller's tenant.
 * The [id] param is the user_id in tenant_users.
 * Owners only — cannot delete another owner.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const userId = ctx.params?.id as string;

    if (!userId) {
      throw ApiErrorFactory.validationError({ id: 'Staff user ID is required' });
    }

    // Prevent removing an owner
    const { data: target, error: fetchError } = await ctx.supabase
      .from('tenant_users')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !target) {
      throw ApiErrorFactory.notFound('Staff member not found in this tenant');
    }

    if (target.role === 'owner') {
      throw ApiErrorFactory.forbidden('Cannot remove the tenant owner');
    }

    const { error } = await ctx.supabase
      .from('tenant_users')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
