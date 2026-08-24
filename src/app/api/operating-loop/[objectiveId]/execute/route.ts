import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { executeObjective } from '@/lib/operating-loop/service';

export const dynamic = 'force-dynamic';

export const POST = createHttpHandler(
  async (ctx) => executeObjective({
    tenantId: getVerifiedTenantId(ctx),
    actorId: ctx.user!.id,
    objectiveId: getRouteParam(ctx.params, 'objectiveId'),
  }),
  'POST',
  { auth: true, roles: ['owner'] },
);
