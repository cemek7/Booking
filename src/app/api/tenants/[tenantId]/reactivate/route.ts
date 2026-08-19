import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { reactivate } from '@/lib/offboarding/offboardService';

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'required' });
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');

    const admin = createSupabaseAdminClient();
    await reactivate(admin, {
      tenantId,
      actorUserId: ctx.user!.id,
      actorRole: ctx.user!.role,
    });
    return { success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'superadmin'] },
);
