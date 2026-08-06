export const dynamic = 'force-dynamic';

import { createHttpHandler, getRouteParam } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { confirmExtraction } from '@/lib/capture/confirm';
import { getPermissionForAction } from '@/lib/booking/capabilityMap';
import type { AIResponse } from '@/lib/booking/action-validator';

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Missing tenant context');

    const recordId = getRouteParam(ctx.params, 'id');
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('extracted_records')
      .select('tenant_id, proposed_action')
      .eq('id', recordId)
      .single();
    const record = data as { tenant_id: string; proposed_action?: AIResponse | null } | null;

    if (error || !record) throw ApiErrorFactory.notFound('Extracted record');
    if (record.tenant_id !== tenantId) throw ApiErrorFactory.forbidden('Access denied');

    const action = record.proposed_action?.action;
    const requiredPermission = action ? getPermissionForAction(action) : undefined;
    const permissionSet = new Set(ctx.user?.permissions ?? []);

    if (
      requiredPermission
      && ctx.user?.role !== 'owner'
      && ctx.user?.role !== 'superadmin'
      && !permissionSet.has(requiredPermission)
    ) {
      throw ApiErrorFactory.forbidden('Insufficient permission to confirm this capture');
    }

    const result = await confirmExtraction(admin, recordId, ctx.user?.id ?? 'system', ctx.user?.permissions ?? []);
    return { ok: true, ...result };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);
