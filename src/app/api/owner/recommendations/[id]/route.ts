export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { decideRecommendation } from '@/lib/recommendations/outcomes';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const PatchSchema = z.object({
  decision: z.enum(['accept', 'dismiss', 'snooze']),
  snooze_until: z.string().datetime().optional(),
  note: z.string().trim().max(1000).optional(),
});

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const recommendationId = getRouteParam(ctx.params, 'id');
    const parsed = PatchSchema.safeParse((await ctx.request.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }
    if (parsed.data.decision === 'snooze' && !parsed.data.snooze_until) {
      throw ApiErrorFactory.validationError('snooze_until is required when snoozing a recommendation');
    }

    const admin = createSupabaseAdminClient();
    const result = await decideRecommendation(admin, {
      tenantId,
      recommendationId,
      decision: parsed.data.decision,
      actorId: ctx.user?.id ?? null,
      permissions: ctx.user?.permissions ?? [],
      snoozeUntil: parsed.data.snooze_until ?? null,
      note: parsed.data.note ?? null,
    });
    return result;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.VIEW_ANALYTICS] },
);
