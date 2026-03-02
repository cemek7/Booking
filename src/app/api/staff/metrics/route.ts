import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/staff/metrics
 *
 * Returns per-staff-member metrics for a tenant: completed booking count,
 * revenue sum (from completed transactions), tips total, utilization rate,
 * average service duration, and avg customer rating from customer_feedback —
 * all scoped to the requested window (?days=N, default 30).
 * Uses X-Tenant-ID header (preferred) or tenant_id query param as fallback.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || url.searchParams.get('tenant_id');

    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id required');
    }

    // Role-based access: staff members can only see their own metrics
    const userRole = ctx.user?.role;
    const userId = ctx.user?.id;
    const isStaffOnly = userRole === 'staff';

    const daysParam = parseInt(url.searchParams.get('days') || '30', 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch staff list, completed reservations, revenue, and customer feedback in parallel
    const staffQuery = ctx.supabase
      .from('tenant_users')
      .select('user_id, role')
      .eq('tenant_id', tenantId)
      .neq('role', 'owner');

    // Staff role can only see their own record
    if (isStaffOnly && userId) {
      staffQuery.eq('user_id', userId);
    }

    const [staffResult, reservationsResult, revenueResult, feedbackResult] = await Promise.all([
      staffQuery,
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
      ctx.supabase
        .from('customer_feedback')
        .select('staff_user_id, score')
        .eq('tenant_id', tenantId)
        .gte('created_at', since),
    ]);

    if (staffResult.error) throw ApiErrorFactory.internalServerError(new Error('Failed to fetch staff'));

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

    // Sum revenue and tips per staff member (linked via metadata.staff_id)
    const revenueByUser: Record<string, number> = {};
    const tipsByUser: Record<string, number> = {};
    for (const t of revenueResult.data || []) {
      const row = t as Record<string, unknown>;
      const meta = row.metadata as Record<string, unknown> | undefined;
      const staffId = (row.staff_id as string | undefined)
        || (meta?.staff_id as string | undefined)
        || (meta?.user_id as string | undefined);
      if (!staffId) continue;
      revenueByUser[staffId] = (revenueByUser[staffId] || 0) + Number(t.amount || 0);
      // Tips may be stored in metadata.tips or metadata.tip_amount
      const tipAmount = Number(meta?.tips || meta?.tip_amount || 0);
      if (tipAmount > 0) {
        tipsByUser[staffId] = (tipsByUser[staffId] || 0) + tipAmount;
      }
    }

    // Build per-staff rating maps from customer_feedback table
    const ratingScoresByUser: Record<string, number[]> = {};
    for (const fb of feedbackResult.data || []) {
      const row = fb as { staff_user_id: string; score: number };
      if (!ratingScoresByUser[row.staff_user_id]) ratingScoresByUser[row.staff_user_id] = [];
      ratingScoresByUser[row.staff_user_id].push(row.score);
    }

    // Utilization: fraction of available minutes used (8 working hours/day × window days)
    const availableMinutes = 8 * 60 * days;
    const round1dp = (n: number) => Math.round(n * 10) / 10;

    const metrics = staff.map((s) => {
      const usedMinutes = durationByUser[s.user_id] || 0;
      const completedCount = completedByUser[s.user_id] || 0;
      const utilization_rate = availableMinutes > 0
        ? Math.min(100, (usedMinutes / availableMinutes) * 100)
        : 0;
      const avg_service_duration_min = completedCount > 0
        ? round1dp(usedMinutes / completedCount)
        : 0;
      const scores = ratingScoresByUser[s.user_id] || [];
      const rating = scores.length > 0
        ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
        : null;
      return {
        user_id: s.user_id,
        rating,
        rating_count: scores.length,
        completed: completedCount,
        revenue: revenueByUser[s.user_id] || 0,
        tips_total: tipsByUser[s.user_id] || 0,
        utilization_rate: round1dp(utilization_rate),
        avg_service_duration_min,
      };
    });

    return { metrics };
  },
  'GET',
  { auth: true }
);
