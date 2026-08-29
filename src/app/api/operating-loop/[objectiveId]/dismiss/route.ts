import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { dismissObjective } from '@/lib/operating-loop/service';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';

const DismissSchema = z.object({ reason: z.string().trim().min(1).max(1000).optional() });

export const dynamic = 'force-dynamic';

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = DismissSchema.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    const tenantId = getVerifiedTenantId(ctx);
    const result = await dismissObjective({
      tenantId,
      actorId: ctx.user!.id,
      objectiveId: getRouteParam(ctx.params, 'objectiveId'),
      reason: parsed.data.reason,
    });
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.OPERATING_OBJECTIVE_DISMISSED,
      properties: { tenant_id: tenantId, channel: 'web', flow: 'retention', metadata: { outcome: 'dismissed' } },
      distinctId: ctx.user!.id,
    });
    return result;
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
