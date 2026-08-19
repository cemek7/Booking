export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { resolveActiveGlobalAdmin } from '@/lib/auth/global-admin';

/**
 * POST /api/admin/check
 * 
 * Check if an email belongs to a global admin or a tenant member.
 * 
 * Request body: { email: string }
 */

export const POST = createHttpHandler(
  async (ctx) => {
    const { email } = await ctx.request.json();

    if (!email || typeof email !== 'string') {
      throw ApiErrorFactory.badRequest('email is required');
    }

    const userId = ctx.user!.id;

    // Query admin by email, and tenant membership by authenticated user ID.
    const [adminByEmail, tu] = await Promise.all([
      resolveActiveGlobalAdmin(ctx.supabase, email),
      ctx.supabase.from('tenant_users').select('tenant_id,role,user_id').eq('user_id', userId).limit(1).maybeSingle(),
    ]);

    if (tu.error) throw ApiErrorFactory.internalServerError(new Error('Failed to check tenant membership'));

    if (adminByEmail) {
      return { found: { admin: true, email: adminByEmail.email, user_id: userId } };
    }

    if (tu.data) {
      return { found: {
        tenant_id: tu.data.tenant_id,
        role: tu.data.role || 'staff',
        email: email,
        user_id: tu.data.user_id,
      } };
    }

    return { found: null };
  },
  'POST',
  { auth: true, requireTenantMembership: false }
);
