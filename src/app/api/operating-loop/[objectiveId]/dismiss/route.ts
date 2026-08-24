import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { dismissObjective } from '@/lib/operating-loop/service';

const DismissSchema = z.object({ reason: z.string().trim().min(1).max(1000).optional() });

export const dynamic = 'force-dynamic';

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = DismissSchema.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    return dismissObjective({
      tenantId: getVerifiedTenantId(ctx),
      actorId: ctx.user!.id,
      objectiveId: getRouteParam(ctx.params, 'objectiveId'),
      reason: parsed.data.reason,
    });
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
