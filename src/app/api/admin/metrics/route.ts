import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { isGlobalAdmin } from '@/types/unified-permissions';

/**
 * GET /api/admin/metrics
 *
 * Admin-only endpoint for full platform aggregated metrics.
 * Per tenant it returns: LLM usage (call_count, total_tokens), user_count,
 * revenue_estimate (completed transactions), reservation counts, and active staff.
 * Only global admins can access.
 */

export const GET = createHttpHandler(
  async (ctx) => {
    // Verify global admin permission
    const ok = await isGlobalAdmin(ctx.supabase, ctx.user!.id, ctx.user!.email);
    if (!ok) throw ApiErrorFactory.insufficientPermissions(['admin']);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel for maximum performance
    const [llmResult, userResult, revenueResult, tenantResult, reservationResult, staffResult] =
      await Promise.all([
        // LLM call usage
        ctx.supabase
          .from('llm_calls')
          .select('tenant_id, total_tokens, created_at')
          .gte('created_at', since),
        // All tenant members (for user count)
        ctx.supabase
          .from('tenant_users')
          .select('tenant_id, role'),
        // Completed/paid transactions in window (for revenue estimate)
        ctx.supabase
          .from('transactions')
          .select('tenant_id, amount')
          .in('status', ['completed', 'paid'])
          .gte('created_at', since),
        // Tenant metadata for names
        ctx.supabase
          .from('tenants')
          .select('id, name'),
        // All reservations in window for booking stats
        ctx.supabase
          .from('reservations')
          .select('tenant_id, status')
          .gte('created_at', since),
        // Active staff (role='staff') — all time, not just 30d window
        ctx.supabase
          .from('tenant_users')
          .select('tenant_id')
          .eq('role', 'staff'),
      ]);

    if (llmResult.error) throw ApiErrorFactory.internal('Failed to fetch LLM metrics');

    // --- Build lookup maps ---

    const tenantNames: Record<string, string> = {};
    for (const t of tenantResult.data || []) {
      if (t.id) tenantNames[t.id] = t.name || t.id;
    }

    // user_count: all roles (owners + managers + staff)
    const userCounts: Record<string, number> = {};
    for (const u of userResult.data || []) {
      const t = u.tenant_id || 'unknown';
      userCounts[t] = (userCounts[t] || 0) + 1;
    }

    // revenue_estimate: sum of completed/paid transaction amounts
    const revenueByTenant: Record<string, number> = {};
    for (const r of revenueResult.data || []) {
      const t = r.tenant_id || 'unknown';
      revenueByTenant[t] = (revenueByTenant[t] || 0) + Number(r.amount || 0);
    }

    // reservation counts: total and completed in window
    const reservationCount: Record<string, number> = {};
    const completedReservations: Record<string, number> = {};
    for (const r of reservationResult.data || []) {
      const t = r.tenant_id || 'unknown';
      reservationCount[t] = (reservationCount[t] || 0) + 1;
      if (r.status === 'completed') {
        completedReservations[t] = (completedReservations[t] || 0) + 1;
      }
    }

    // active_staff_count: users with role='staff'
    const activeStaffCount: Record<string, number> = {};
    for (const s of staffResult.data || []) {
      const t = s.tenant_id || 'unknown';
      activeStaffCount[t] = (activeStaffCount[t] || 0) + 1;
    }

    // --- Build per-tenant aggregation starting with LLM data ---

    const byTenant: Record<string, {
      tenant_id: string;
      tenant_name?: string;
      total_tokens: number;
      call_count: number;
      user_count: number;
      revenue_estimate: number;
      reservation_count: number;
      completed_reservations: number;
      active_staff_count: number;
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
          reservation_count: reservationCount[t] || 0,
          completed_reservations: completedReservations[t] || 0,
          active_staff_count: activeStaffCount[t] || 0,
        };
      }
      byTenant[t].total_tokens += r.total_tokens || 0;
      byTenant[t].call_count += 1;
    }

    // Include tenants with other activity but no LLM calls in the window
    const allTenantIds = new Set([
      ...Object.keys(userCounts),
      ...Object.keys(revenueByTenant),
      ...Object.keys(reservationCount),
    ]);
    for (const tenantId of allTenantIds) {
      if (!byTenant[tenantId]) {
        byTenant[tenantId] = {
          tenant_id: tenantId,
          tenant_name: tenantNames[tenantId],
          total_tokens: 0,
          call_count: 0,
          user_count: userCounts[tenantId] || 0,
          revenue_estimate: revenueByTenant[tenantId] || 0,
          reservation_count: reservationCount[tenantId] || 0,
          completed_reservations: completedReservations[tenantId] || 0,
          active_staff_count: activeStaffCount[tenantId] || 0,
        };
      }
    }

    return { metrics: Object.values(byTenant) };
  },
  'GET',
  { auth: true, roles: ['admin'] }
);
