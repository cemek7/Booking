export const dynamic = 'force-dynamic';

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const POST = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id;
    const tenantId = ctx.user?.tenantId;
    if (!id || !tenantId) {
      throw ApiErrorFactory.validationError({ id: 'id + tenant required' });
    }

    const body: { status?: string } = await parseJsonBody<{ status?: string }>(ctx.request).catch(() => ({}));
    if (body.status !== 'engaged' && body.status !== 'dismissed') {
      throw ApiErrorFactory.validationError({ status: "status must be 'engaged' or 'dismissed'" });
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('social_mentions')
      .update({ status: body.status })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) {
      throw error;
    }

    return { success: true, status: body.status };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
