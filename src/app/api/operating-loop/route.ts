import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { getLoop } from '@/lib/operating-loop/service';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const loop = await getLoop(tenantId);
    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.OPERATING_LOOP_VIEWED,
      properties: { tenant_id: tenantId, channel: 'web', flow: 'retention', metadata: { state: loop.state, has_primary_objective: Boolean(loop.primaryObjective) } },
      distinctId: ctx.user!.id,
    });
    return loop;
  },
  'GET',
  { auth: true, roles: ['owner'] },
);
