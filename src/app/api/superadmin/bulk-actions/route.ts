export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

type BulkActionBody = {
  action: 'suspend' | 'activate' | 'pro' | 'free';
  tenantIds: string[];
};

export const POST = createHttpHandler(
  async (ctx) => {
    const body = (await ctx.request.json().catch(() => ({}))) as Partial<BulkActionBody>;
    const action = body.action;
    const tenantIds = Array.isArray(body.tenantIds) ? body.tenantIds.filter((tenantId): tenantId is string => typeof tenantId === 'string' && tenantId.length > 0) : [];

    if (!action) throw ApiErrorFactory.badRequest('action is required');
    if (tenantIds.length === 0) throw ApiErrorFactory.badRequest('tenantIds are required');

    const admin = createSupabaseAdminClient();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (action === 'suspend') updates.status = 'suspended';
    if (action === 'activate') updates.status = 'active';
    if (action === 'pro') updates.plan = 'pro';
    if (action === 'free') updates.plan = 'free';

    const { error } = await admin.from('tenants').update(updates).in('id', tenantIds);
    if (error) throw error;

    return {
      ok: true,
      action,
      tenantIds,
      updated: tenantIds.length,
    };
  },
  'POST',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
