import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { deferObjective } from '@/lib/operating-loop/service';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';

const DeferSchema = z.object({
  scheduledFor: z.string().refine((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now(), {
    message: 'scheduledFor must be a future timestamp',
  }),
});

export const dynamic = 'force-dynamic';

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = DeferSchema.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    const tenantId = getVerifiedTenantId(ctx);
    const result = await deferObjective({
      tenantId,
      actorId: ctx.user!.id,
      objectiveId: getRouteParam(ctx.params, 'objectiveId'),
      scheduledFor: parsed.data.scheduledFor,
    });
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.OPERATING_OBJECTIVE_DEFERRED,
      properties: { tenant_id: tenantId, channel: 'web', flow: 'retention', metadata: { outcome: 'deferred' } },
      distinctId: ctx.user!.id,
    });
    return result;
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
