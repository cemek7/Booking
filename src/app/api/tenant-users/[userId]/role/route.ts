import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const UpdateRoleBodySchema = z.object({
  role: z.string().min(1, 'Role is required'),
});

/**
 * PATCH /api/tenant-users/:userId/role?tenant_id=...
 * Update a user's role within a tenant.
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const tenantId = url.searchParams.get('tenant_id');

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenant_id: 'tenant_id query parameter is required' });
    }

    const userId = ctx.params?.userId;
    if (!userId) {
      throw ApiErrorFactory.validationError({ userId: 'User ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateRoleBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { role } = bodyValidation.data;

    const { error } = await ctx.supabase
      .from('tenant_users')
      .update({ role })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { ok: true, userId, role };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);
