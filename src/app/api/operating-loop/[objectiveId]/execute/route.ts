import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { executeObjective } from '@/lib/operating-loop/service';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const result = await executeObjective({
    tenantId,
    actorId: ctx.user!.id,
    objectiveId: getRouteParam(ctx.params, 'objectiveId'),
    });
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.OPERATING_OBJECTIVE_EXECUTED,
      properties: { tenant_id: tenantId, channel: 'web', flow: 'retention', metadata: { outcome: result.status } },
      distinctId: ctx.user!.id,
    });
    return result;
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
