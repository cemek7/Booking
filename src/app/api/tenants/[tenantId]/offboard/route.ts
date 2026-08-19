import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { enterOffboarding } from '@/lib/offboarding/offboardService';

const Body = z.object({ confirmText: z.string().min(1) });

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'required' });
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');
    const parsed = Body.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError({ issues: parsed.error.issues });

    const admin = createSupabaseAdminClient();
    const { data: tenant } = await admin.from('tenants').select('id, name').eq('id', tenantId).single();
    if (!tenant) throw ApiErrorFactory.notFound('Tenant not found');
    if (parsed.data.confirmText.trim() !== (tenant.name as string)) {
      throw ApiErrorFactory.validationError({ confirmText: 'Type the exact tenant name to confirm' });
    }
    const res = await enterOffboarding(admin, {
      tenantId, reason: 'voluntary', actorUserId: ctx.user!.id, actorRole: ctx.user!.role,
    });
    return { success: true, lifecycleState: res.lifecycleState };
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
