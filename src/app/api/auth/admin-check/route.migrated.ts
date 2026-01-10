import { createHttpHandler, createApiHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { UnifiedAuthOrchestrator } from '@/lib/auth/unified-auth-orchestrator';
import { parseJsonBody } from '@/lib/error-handling/migration-helpers';

/**
 * POST /api/auth/admin-check
 * 
 * Check if a user (by email) is an admin or has tenant membership.
 * Used during auth callback to determine post-login routing.
 * 
 * Body: { email: string }
 * 
 * Returns:
 * - { found: { admin: true, email } } - Global admin
 * - { found: { tenant_id, role } } - Tenant member
 * - { found: null } - No membership
 * 
 * Public endpoint (no auth required for initial login flow)
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const { email } = await parseJsonBody(ctx.request, { email: 'string' });

    if (!email) {
      throw ApiErrorFactory.validationError('email', 'Email is required');
    }

    // Check admins table first
    const { data: adminRow, error: adminErr } = await ctx.supabase
      .from('admins')
      .select('email, role')
      .eq('email', email)
      .maybeSingle();

    if (adminErr) {
      throw ApiErrorFactory.databaseError(adminErr);
    }

    if (adminRow) {
      return {
        found: {
          admin: true,
          email: adminRow.email,
          role: adminRow.role
        }
      };
    }

    // Check tenant_users for tenant membership
    const { data: tu, error: tuErr } = await ctx.supabase
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (tuErr) {
      throw ApiErrorFactory.databaseError(tuErr);
    }

    if (tu) {
      return {
        found: {
          tenant_id: tu.tenant_id,
          role: tu.role
        }
      };
    }

    // No membership found
    return {
      found: null
    };
  },
  'POST',
  { auth: false } // Public endpoint for login flow
);
