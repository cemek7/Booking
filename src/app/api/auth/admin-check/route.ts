import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * Check if a user (by email) is an admin or has tenant membership
 * POST /api/auth/admin-check
 *
 * Used during auth callback to determine post-login routing.
 * Public endpoint - no authentication required.
 *
 * Expected body: { email: string }
 *
 * Returns:
 * - 200: { found: { admin: true, email: string } } - Global admin
 * - 200: { found: { tenant_id: string, role: string } } - Tenant member
 * - 200: { found: null } - No membership found
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const { email } = body ?? {};

    if (!email || typeof email !== 'string') {
      throw ApiErrorFactory.validationError('Missing or invalid email');
    }

    try {
      // Check admins table first
      const { data: adminRow, error: adminErr } = await ctx.supabase
        .from('admins')
        .select('email')
        .eq('email', email)
        .maybeSingle();

      if (adminErr) {
        console.error('[auth/admin-check] admin query failed:', adminErr);
        throw ApiErrorFactory.internalServerError('Failed to check admin status');
      }

      if (adminRow) {
        return {
          found: {
            admin: true,
            email: adminRow.email,
          },
        };
      }

      // Check tenant_users for membership
      const { data: tenantUser, error: tuErr } = await ctx.supabase
        .from('tenant_users')
        .select('tenant_id,role')
        .eq('email', email)
        .limit(1)
        .maybeSingle();

      if (tuErr) {
        console.error('[auth/admin-check] tenant_users query failed:', tuErr);
        throw ApiErrorFactory.internalServerError('Failed to check tenant membership');
      }

      if (tenantUser) {
        return {
          found: {
            tenant_id: tenantUser.tenant_id,
            role: tenantUser.role,
          },
        };
      }

      // No membership found
      return {
        found: null,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Failed')) {
        throw error;
      }
      console.error('[auth/admin-check] unexpected error:', error);
      throw ApiErrorFactory.internalServerError('Failed to check admin status');
    }
  },
  'POST',
  { auth: false } // Public endpoint - used during auth callback
);
