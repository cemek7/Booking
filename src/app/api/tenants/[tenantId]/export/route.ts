import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'required' });
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');

    const admin = createSupabaseAdminClient();
    const { data: task } = await admin.from('offboarding_tasks')
      .select('payload').eq('tenant_id', tenantId).eq('task_type', 'export_data').maybeSingle();
    const url = (task?.payload as { export_url?: string } | null)?.export_url;
    if (!url) throw ApiErrorFactory.notFound('Export not ready');
    return { url };
  },
  'GET',
  { auth: true, roles: ['owner'] },
);
