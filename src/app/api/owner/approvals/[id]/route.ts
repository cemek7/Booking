export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, getRouteParam } from '@/lib/error-handling/route-handler';
import { decideApproval } from '@/lib/approvals/requests';

const DecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const PATCH = createHttpHandler(
  async (ctx) => {
    const requestId = getRouteParam(ctx.params, 'id');
    const parsed = DecisionSchema.safeParse((await ctx.request.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues));
    }

    const approval = await decideApproval(ctx.supabase, {
      requestId,
      actorId: ctx.user?.tenantUserId ?? ctx.user?.id ?? 'unknown',
      actorPerms: ctx.user?.permissions ?? [],
      decision: parsed.data.decision,
      note: parsed.data.note ?? null,
    });

    return { approval };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);
