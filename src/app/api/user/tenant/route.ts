import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { normalizeRole, Role } from '@/types';

/**
 * POST /api/user/tenant
 *
 * For signin flow: Read-only lookup of user's tenant membership
 * Request body:
 * {
 *   tenant_id: string (required)
 *   email: string (required)
 * }
 * 
 * Returns the user's role for that tenant from existing tenant_users record.
 * This does NOT create records - that only happens in signup flow.
 */

interface UserTenantPayload {
  tenant_id: string;
  email: string;
}

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await parseJsonBody<UserTenantPayload>(ctx.request);
    const { tenant_id: tenantId, email } = body;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenant_id: 'tenant_id is required' });
    }

    if (!email) {
      throw ApiErrorFactory.validationError({ email: 'email is required' });
    }

    // Look up existing record by tenant_id + email
    // This should already exist from signup
    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .select('user_id, role, email, tenant_id')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .maybeSingle();

    if (error) {
      console.error('[user/tenant] lookup failed', error);
      throw ApiErrorFactory.databaseError(error);
    }

    if (!data) {
      // User not found in this tenant - this is expected if they haven't been added via signup/invite
      throw ApiErrorFactory.forbidden('User is not a member of this tenant');
    }

    return { data };
  },
  'POST',
  { auth: false }
);
