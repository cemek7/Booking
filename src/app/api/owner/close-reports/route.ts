export const dynamic = 'force-dynamic';

import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const { data, error } = await ctx.supabase
      .from('reconciliation_runs')
      .select(
        'id, business_date, status, currency, expected_revenue_cents, adjusted_expected_cents, recorded_payments_cents, approved_outstanding_cents, revenue_gap_cents, delivered_at, computed_at'
      )
      .eq('tenant_id', tenantId)
      .order('business_date', { ascending: false })
      .limit(90);

    if (error) throw error;

    return { runs: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
