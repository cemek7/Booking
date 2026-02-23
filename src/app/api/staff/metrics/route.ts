import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/staff/metrics
 *
 * Returns per-staff-member metrics for a tenant: completed booking count,
 * revenue sum (from completed transactions), and utilization rate.
 * Uses X-Tenant-ID header (preferred) or tenant_id query param as fallback.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID')
      || new URL(ctx.request.url).searchParams.get('tenant_id');

    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id required');
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch staff list, their completed reservations, and their revenue in parallel
    const [staffResult, reservationsResult, revenueResult] = await Promise.all([
      ctx.supabase
        .from('tenant_users')
        .select('user_id, role')
        .eq('tenant_id', tenantId)
        .neq('role', 'owner'),
      ctx.supabase
        .from('reservations')
        .select('raw, status, start_at, end_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .gte('created_at', since),
      ctx.supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('tenant_id', tenantId)
        .in('status', ['completed', 'paid'])
        .gte('created_at', since),
    ]);

    if (staffResult.error) throw ApiErrorFactory.internal('Failed to fetch staff');

    const staff = (staffResult.data || []) as Array<{ user_id: string; role: string }>;

    // Count completed reservations per staff member
    // staff_id may live in raw JSONB or a direct column depending on schema variant
    const completedByUser: Record<string, number> = {};
    const durationByUser: Record<string, number> = {};

    for (const r of reservationsResult.data || []) {
      const row = r as Record<string, unknown>;
      const raw = row.raw as Record<string, unknown> | undefined;
      const staffId = (row.staff_id as string | undefined)
        || (raw?.staff_id as string | undefined)
        || (raw?.user_id as string | undefined);
      if (!staffId) continue;
      completedByUser[staffId] = (completedByUser[staffId] || 0) + 1;
      const start = r.start_at ? new Date(r.start_at).getTime() : 0;
      const end = r.end_at ? new Date(r.end_at).getTime() : 0;
      if (start && end && end > start) {
        durationByUser[staffId] = (durationByUser[staffId] || 0) + (end - start) / 60000;
      }
    }

    // Sum revenue per staff member (linked via metadata.staff_id)
    const revenueByUser: Record<string, number> = {};
    for (const t of revenueResult.data || []) {
      const row = t as Record<string, unknown>;
      const meta = row.metadata as Record<string, unknown> | undefined;
      const staffId = (row.staff_id as string | undefined)
        || (meta?.staff_id as string | undefined)
        || (meta?.user_id as string | undefined);
      if (!staffId) continue;
      revenueByUser[staffId] = (revenueByUser[staffId] || 0) + Number(t.amount || 0);
    }

    // Utilization: fraction of available minutes used (8 working hours/day × 30-day window)
    const MONTHLY_AVAILABLE_MINUTES = 8 * 60 * 30; // 8h/day × 30 days = 14 400 min

    const metrics = staff.map((s) => {
      const usedMinutes = durationByUser[s.user_id] || 0;
      const utilization_rate = MONTHLY_AVAILABLE_MINUTES > 0
        ? Math.min(100, (usedMinutes / MONTHLY_AVAILABLE_MINUTES) * 100)
        : 0;
      return {
        user_id: s.user_id,
        rating: null as number | null,
        completed: completedByUser[s.user_id] || 0,
        revenue: revenueByUser[s.user_id] || 0,
        utilization_rate: Math.round(utilization_rate * 10) / 10,
      };
    });

    return { metrics };
  },
  'GET',
  { auth: true }
);
