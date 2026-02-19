import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { isGlobalAdmin } from '@/types/unified-permissions';

/**
 * GET /api/admin/metrics
 *
 * Admin-only endpoint for aggregated metrics. Retrieves token usage, call count,
 * user count, and revenue estimate per tenant for the last 30 days.
 * Only global admins can access.
 */

export const GET = createHttpHandler(
  async (ctx) => {
    // Verify global admin permission
    const ok = await isGlobalAdmin(ctx.supabase, ctx.user!.id, ctx.user!.email);
    if (!ok) throw ApiErrorFactory.insufficientPermissions(['admin']);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [llmResult, userResult, revenueResult, tenantResult] = await Promise.all([
      ctx.supabase
        .from('llm_calls')
        .select('tenant_id, total_tokens, created_at')
        .gte('created_at', since),
      ctx.supabase
        .from('tenant_users')
        .select('tenant_id'),
      ctx.supabase
        .from('transactions')
        .select('tenant_id, amount')
        .eq('status', 'completed')
        .gte('created_at', since),
      ctx.supabase
        .from('tenants')
        .select('id, name'),
    ]);

    if (llmResult.error) throw ApiErrorFactory.internal('Failed to fetch metrics');

    // Build lookup maps
    const tenantNames: Record<string, string> = {};
    for (const t of tenantResult.data || []) {
      if (t.id) tenantNames[t.id] = t.name || t.id;
    }

    const userCounts: Record<string, number> = {};
    for (const u of userResult.data || []) {
      const t = u.tenant_id || 'unknown';
      userCounts[t] = (userCounts[t] || 0) + 1;
    }

    const revenueByTenant: Record<string, number> = {};
    for (const r of revenueResult.data || []) {
      const t = r.tenant_id || 'unknown';
      revenueByTenant[t] = (revenueByTenant[t] || 0) + Number(r.amount || 0);
    }

    // Aggregate llm_calls by tenant and merge with user/revenue data
    const byTenant: Record<string, {
      tenant_id: string;
      tenant_name?: string;
      total_tokens: number;
      call_count: number;
      user_count: number;
      revenue_estimate: number;
    }> = {};

    for (const r of llmResult.data || []) {
      const t = r.tenant_id || 'unknown';
      if (!byTenant[t]) {
        byTenant[t] = {
          tenant_id: t,
          tenant_name: tenantNames[t],
          total_tokens: 0,
          call_count: 0,
          user_count: userCounts[t] || 0,
          revenue_estimate: revenueByTenant[t] || 0,
        };
      }
      byTenant[t].total_tokens += r.total_tokens || 0;
      byTenant[t].call_count += 1;
    }

    // Include tenants that have users/revenue but no llm_calls in the window
    for (const tenantId of new Set([
      ...Object.keys(userCounts),
      ...Object.keys(revenueByTenant),
    ])) {
      if (!byTenant[tenantId]) {
        byTenant[tenantId] = {
          tenant_id: tenantId,
          tenant_name: tenantNames[tenantId],
          total_tokens: 0,
          call_count: 0,
          user_count: userCounts[tenantId] || 0,
          revenue_estimate: revenueByTenant[tenantId] || 0,
        };
      }
    }

    return { metrics: Object.values(byTenant) };
  },
  'GET',
  { auth: true, roles: ['admin'] }
);
