import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { isGlobalAdmin } from '@/lib/enhanced-rbac';
import { normalizeRole } from '@/types';

/**
 * Get current user profile and tenant memberships
 * GET /api/auth/me
 */
export const GET = createHttpHandler(
  async (ctx) => {
    if (!ctx.user?.id) {
      throw ApiErrorFactory.missingAuthorization();
    }

    const userId = ctx.user.id;
    const email = ctx.user.email;

    try {
      // Check if user is superadmin
      const isSuperadmin = await isGlobalAdmin(ctx.supabase, userId, email);

      // Fetch tenant memberships
      const { data: tenantData, error: tenantError } = await ctx.supabase
        .from('tenant_users')
        .select('tenant_id,role')
        .eq('user_id', userId);

      if (tenantError) {
        console.error('[auth/me] tenant roles fetch failed:', tenantError);
        throw ApiErrorFactory.internalServerError(new Error('Failed to fetch tenant roles'));
      }

      // Normalize roles
      const tenantRoles = (tenantData || [])
        .map((item: { tenant_id: string; role: string }) => {
          try {
            return {
              tenant_id: item.tenant_id,
              role: normalizeRole(item.role),
            };
          } catch (e) {
            console.warn(
              `[auth/me] Invalid role ${item.role} for user ${userId} in tenant ${item.tenant_id}`
            );
            return null;
          }
        })
        .filter(Boolean) as { tenant_id: string; role: string }[];

      // Determine primary membership
      const primaryMembership = tenantRoles.length > 0 ? tenantRoles[0] : null;

      return {
        userId,
        email,
        role: primaryMembership?.role || null,
        tenantId: primaryMembership?.tenant_id || null,
        tenantRoles,
        isSuperadmin,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Failed')) {
        throw error;
      }
      console.error('[auth/me] unexpected error:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to get user profile'));
    }
  },
  'GET',
  { auth: true }
);
