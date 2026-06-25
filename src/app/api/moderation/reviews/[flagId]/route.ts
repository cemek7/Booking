export const dynamic = 'force-dynamic';

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { resolveFlag, type FlagStatus } from '@/lib/moderation/reviews';

/**
 * POST /api/moderation/reviews/[flagId]  { status: 'resolved' | 'dismissed' }
 * Resolve or dismiss a review flag. Owner/manager only, tenant-scoped.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const flagId = ctx.params?.flagId;
    if (!flagId) throw ApiErrorFactory.validationError({ flagId: 'flag id is required' });

    const body: { status?: FlagStatus } = await parseJsonBody<{ status?: FlagStatus }>(
      ctx.request,
    ).catch(() => ({}));
    if (body.status !== 'resolved' && body.status !== 'dismissed') {
      throw ApiErrorFactory.validationError({ status: "status must be 'resolved' or 'dismissed'" });
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('No tenant in context');

    const admin = createSupabaseAdminClient();
    await resolveFlag(admin, { tenantId, flagId, status: body.status });
    return { success: true, status: body.status };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);
