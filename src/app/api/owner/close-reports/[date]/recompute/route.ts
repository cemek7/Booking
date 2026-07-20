export const dynamic = 'force-dynamic';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { computeDailyClose } from '@/lib/reconciliation/reconciliationService';

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const date = ctx.params?.date as string | undefined;

    if (!date) {
      throw new Error('Missing close-report date');
    }

    const admin = createSupabaseAdminClient();
    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .select('timezone')
      .eq('id', tenantId)
      .single();

    if (tenantError) throw tenantError;

    const { runId } = await computeDailyClose(
      admin,
      tenantId,
      date,
      tenant?.timezone ?? 'Africa/Lagos'
    );

    return { runId };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
