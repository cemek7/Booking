export const dynamic = 'force-dynamic';

import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const date = ctx.params?.date as string | undefined;

    if (!date) {
      throw ApiErrorFactory.validationError({ message: 'Missing close-report date' });
    }

    const { data: run, error: runError } = await ctx.supabase
      .from('reconciliation_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('business_date', date)
      .maybeSingle();

    if (runError) throw runError;
    if (!run) throw ApiErrorFactory.notFound('No close report for that date');

    const { data: items, error: itemsError } = await ctx.supabase
      .from('reconciliation_items')
      .select('*')
      .eq('run_id', run.id)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    return { run, items: items ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
