export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { listReviewFlags, type FlagStatus } from '@/lib/moderation/reviews';

const VALID_STATUS: FlagStatus[] = ['pending', 'resolved', 'dismissed'];

/**
 * GET /api/moderation/reviews?status=pending
 * Moderation queue: review reports for the caller's tenant. Owner/manager only.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('No tenant in context');

    const raw = new URL(ctx.request.url).searchParams.get('status');
    const status = VALID_STATUS.includes(raw as FlagStatus) ? (raw as FlagStatus) : undefined;

    const admin = createSupabaseAdminClient();
    const flags = await listReviewFlags(admin, { tenantId, status });
    return { success: true, flags };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] },
);
