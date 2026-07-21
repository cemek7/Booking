export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { answerQuestion } from '@/lib/analytics/answer';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const AskSchema = z.object({
  question: z.string().trim().min(3),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const parsed = AskSchema.safeParse(await ctx.request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues));
    }

    const admin = createSupabaseAdminClient();
    return answerQuestion(admin, tenantId, parsed.data.question, {
      actorId: ctx.user?.tenantUserId ?? ctx.user?.id ?? null,
      permissions: ctx.user?.permissions ?? [],
    });
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.VIEW_ANALYTICS] },
);
