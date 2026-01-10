import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

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

    // Check admins table for global admin
    const { data: adminRow, error: adminErr } = await ctx.supabase
      .from('admins')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (adminErr) throw ApiErrorFactory.internal('Failed to check admin status');

    if (adminRow) {
      return { found: { admin: true, email: adminRow.email } };
    }

    // Check tenant_users for tenant membership
    const { data: tu, error: tuErr } = await ctx.supabase
      .from('tenant_users')
      .select('tenant_id,role,email,user_id')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (tuErr) throw ApiErrorFactory.internal('Failed to check tenant membership');

    if (tu) {
      return { found: { 
        tenant_id: tu.tenant_id, 
        role: tu.role || 'staff',  // Default to 'staff' if role is null
        email: tu.email || email,
        user_id: tu.user_id
      } };
    }

    return { found: null };
  },
  'POST',
  { auth: false }
);
