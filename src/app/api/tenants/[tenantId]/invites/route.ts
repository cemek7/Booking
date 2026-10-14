export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiError, ApiErrorFactory } from '@/lib/error-handling/api-error';
import {
  InvitationIssueError,
  issueTenantInvitation,
} from '@/lib/auth/issue-tenant-invitation';
import { getPublicOrigin } from '@/lib/http/public-origin';

const InviteBodySchema = z.object({
  email: z.string().trim().email().transform(val => val.toLowerCase()),
  role: z.enum(['manager', 'staff']).optional().default('staff'),
});

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

    try {
      return await issueTenantInvitation({
        tenantId,
        actorUserId: ctx.user!.id,
        actorRole: ctx.user!.role as 'owner' | 'manager',
        actorEmail: ctx.user?.email ?? null,
        invitedEmail: email,
        invitedRole,
        publicOrigin: getPublicOrigin(ctx.request),
        source: 'dashboard',
      });
    } catch (error) {
      if (error instanceof InvitationIssueError) {
        throw new ApiError(error.code, 'Unable to send this invitation', error.statusCode);
      }
      throw error;
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
