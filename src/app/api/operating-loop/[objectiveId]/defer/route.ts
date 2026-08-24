import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { deferObjective } from '@/lib/operating-loop/service';

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
    return deferObjective({
      tenantId: getVerifiedTenantId(ctx),
      actorId: ctx.user!.id,
      objectiveId: getRouteParam(ctx.params, 'objectiveId'),
      scheduledFor: parsed.data.scheduledFor,
    });
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
