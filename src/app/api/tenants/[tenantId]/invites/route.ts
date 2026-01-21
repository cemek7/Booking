import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const InviteBodySchema = z.object({
  email: z.string().email().transform(val => val.trim().toLowerCase()),
  role: z.string().optional().default('staff').transform(val => val.toLowerCase()),
});

interface TenantSettings {
  allowedInviterRoles?: string[];
  allowInvitesFromStaffPage?: boolean;
}

/**
 * POST /api/tenants/:tenantId/invites
 * Create an invite for a new user to join the tenant.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const body = await ctx.request.json();
    const bodyValidation = InviteBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const { email, role: invitedRole } = bodyValidation.data;

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    // Fetch caller's role in this tenant
    const { data: tenantUser, error: tuError } = await ctx.supabase
      .from('tenant_users')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', ctx.user?.id)
      .single();

    if (tuError || !tenantUser) {
      throw ApiErrorFactory.forbidden('You are not a member of this tenant');
    }

    const callerRole = (tenantUser.role || '').toLowerCase();

    // Load tenant settings to check inviter permissions
    const { data: tenant, error: tenantError } = await ctx.supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();

    if (tenantError) {
      throw ApiErrorFactory.databaseError(tenantError);
    }

    const settings = (tenant?.settings || {}) as TenantSettings;
    const allowedRoles: string[] = Array.isArray(settings.allowedInviterRoles)
      ? settings.allowedInviterRoles.map((x: string) => String(x).toLowerCase())
      : ['owner', 'manager'];
    const allowFromStaff = settings.allowInvitesFromStaffPage !== false;

    if (!allowedRoles.includes(callerRole) || !allowFromStaff) {
      throw ApiErrorFactory.forbidden('You do not have permission to send invites');
    }

    // Create invite token
    const tokenValue = crypto.randomUUID();
    const { error: insertError } = await ctx.supabase
      .from('invites')
      .insert({ token: tokenValue, tenant_id: tenantId, email, role: invitedRole });

    if (insertError) {
      throw ApiErrorFactory.databaseError(insertError);
    }

    const inviteUrl = `/accept-invite?token=${encodeURIComponent(tokenValue)}`;
    return { ok: true, token: tokenValue, url: inviteUrl };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
