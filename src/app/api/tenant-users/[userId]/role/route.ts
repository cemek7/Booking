export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const VALID_ROLES = ['owner', 'manager', 'staff'] as const;

const UpdateRoleBodySchema = z.object({
  role: z.enum(VALID_ROLES),
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

    // Prevent self-promotion
    if (ctx.user?.id === userId) {
      throw ApiErrorFactory.forbidden('Cannot modify your own role');
    }

    // Verify the caller has access to this tenant
    const tenantOk = ctx.user?.role === 'superadmin' || ctx.user?.tenantId === tenantId;
    if (!tenantOk) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateRoleBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { role } = bodyValidation.data;

    // Only owners (or superadmin) can assign the 'owner' role
    if (role === 'owner' && ctx.user?.role !== 'owner' && ctx.user?.role !== 'superadmin') {
      throw ApiErrorFactory.forbidden('Only owners can assign the owner role');
    }

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
  { auth: true, roles: ['owner', 'superadmin'], permissions: [BOOKA_PERMISSIONS.MANAGE_STAFF] }
);
