export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { listCountSessions, startCountSession } from '@/lib/inventory/stockCountService';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const CreateSessionSchema = z.object({
  location_id: z.string().uuid().nullable().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const sessions = await listCountSessions(ctx.supabase, tenantId);
    return { sessions };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'], permissions: [BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const parsed = CreateSessionSchema.safeParse((await ctx.request.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const session = await startCountSession(
      ctx.supabase,
      tenantId,
      parsed.data.location_id ?? null,
      ctx.user?.id ?? 'unknown'
    );

    return { session };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'], permissions: [BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS] }
);
