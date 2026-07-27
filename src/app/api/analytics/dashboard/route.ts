export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import AnalyticsService from '@/lib/analyticsService';
import { getAnalyticsScope, validateAnalyticsRequest } from '@/lib/unified-analytics-permissions';
import { getTenantCurrency } from '@/lib/tenant-currency';
import { SIAS_OUTCOME_ATRIBUTION } from '@/lib/sias';
import type { Role } from '@/types/roles';
import type { DashboardMetric } from '@/types/analytics-api';
import type { SupabaseClient } from '@supabase/supabase-js';

const PERIOD_MS: Record<'day' | 'week' | 'month' | 'quarter', number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  quarter: 90 * 24 * 60 * 60 * 1000,
};

type ReservationRow = {
  id: string;
  status: string | null;
  staff_id: string | null;
  customer_id?: string | null;
  phone?: string | null;
  customer_name?: string | null;
};

type TransactionRow = {
  amount: number | string | null;
  user_id?: string | null;
  staff_id?: string | null;
  metadata?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
};

function getTransactionStaffId(row: TransactionRow): string | null {
  // transactions has no user_id/staff_id/metadata columns — attribution
  // lives inside the `raw` jsonb payload.
  const meta = (row.raw && typeof row.raw === 'object' ? row.raw : null)
    ?? (row.metadata && typeof row.metadata === 'object' ? row.metadata : null);
  const fromMeta = meta
    ? (meta.staff_id as string | undefined) || (meta.user_id as string | undefined)
    : undefined;
  return row.staff_id || row.user_id || fromMeta || null;
}

async function getTeamDashboardMetrics(
  ctx: { supabase: SupabaseClient; user?: { role?: string; id?: string } },
  tenantId: string,
  period: 'day' | 'week' | 'month' | 'quarter'
): Promise<DashboardMetric[]> {
  const role = String(ctx.user?.role || '').toLowerCase();

  let teamQuery = ctx.supabase
    .from('tenant_users')
    .select('user_id, role')
    .eq('tenant_id', tenantId);

  if (role === 'manager') {
    // Current schema has no explicit manager-team mapping; scope to staff members.
    teamQuery = teamQuery.eq('role', 'staff');
  } else {
    teamQuery = teamQuery.in('role', ['staff', 'manager']);
  }

  const { data: teamRows, error: teamError } = await teamQuery;
  if (teamError) {
    throw ApiErrorFactory.internalServerError(new Error(`Failed to fetch team members: ${teamError.message}`));
  }

  const staffIds = (teamRows || []).map((row: { user_id: string }) => row.user_id);
  const now = new Date();
  const start = new Date(now.getTime() - PERIOD_MS[period]);
  const previousStart = new Date(start.getTime() - PERIOD_MS[period]);

  if (staffIds.length === 0) {
    const ts = now.toISOString();
    return [
      { id: 'total_bookings', name: 'Team Bookings', value: 0, trend: 0, type: 'count', period, last_updated: ts },
      { id: 'total_revenue', name: 'Team Revenue', value: 0, trend: 0, type: 'currency', period, last_updated: ts },
      { id: 'no_show_rate', name: 'Team No-Show Rate', value: 0, trend: 0, type: 'percentage', period, last_updated: ts },
      { id: 'avg_booking_value', name: 'Team Avg Booking Value', value: 0, trend: 0, type: 'currency', period, last_updated: ts },
      { id: 'new_customers', name: 'Team New Customers', value: 0, trend: 0, type: 'count', period, last_updated: ts },
      { id: 'staff_utilization', name: 'Team Staff Utilization', value: 0, trend: 0, type: 'percentage', period, last_updated: ts },
    ];
  }

  const [reservationsCurrentRes, reservationsPreviousRes, transactionsCurrentRes, transactionsPreviousRes] =
    await Promise.all([
      ctx.supabase
        .from('reservations')
        .select('id, status, staff_id, customer_id, phone, customer_name')
        .eq('tenant_id', tenantId)
        .in('staff_id', staffIds)
        .gte('start_at', start.toISOString())
        .lte('start_at', now.toISOString()),
      ctx.supabase
        .from('reservations')
        .select('id, staff_id')
        .eq('tenant_id', tenantId)
        .in('staff_id', staffIds)
        .gte('start_at', previousStart.toISOString())
        .lte('start_at', start.toISOString()),
      ctx.supabase
        .from('transactions')
        .select('amount, raw')
        .eq('tenant_id', tenantId)
        .in('status', ['completed', 'paid'])
        .gte('created_at', start.toISOString())
        .lte('created_at', now.toISOString()),
      ctx.supabase
        .from('transactions')
        .select('amount, raw')
        .eq('tenant_id', tenantId)
        .in('status', ['completed', 'paid'])
        .gte('created_at', previousStart.toISOString())
        .lte('created_at', start.toISOString()),
    ]);

  if (reservationsCurrentRes.error || reservationsPreviousRes.error || transactionsCurrentRes.error || transactionsPreviousRes.error) {
    throw ApiErrorFactory.internalServerError(
      new Error(
        reservationsCurrentRes.error?.message ||
          reservationsPreviousRes.error?.message ||
          transactionsCurrentRes.error?.message ||
          transactionsPreviousRes.error?.message ||
          'Failed to fetch team dashboard metrics'
      )
    );
  }

  const reservationsCurrent = (reservationsCurrentRes.data || []) as ReservationRow[];
  const reservationsPrevious = (reservationsPreviousRes.data || []) as Array<{ id: string }>;
  const transactionsCurrent = ((transactionsCurrentRes.data || []) as TransactionRow[]).filter((tx) => {
    const staffId = getTransactionStaffId(tx);
    return !!staffId && staffIds.includes(staffId);
  });
  const transactionsPrevious = ((transactionsPreviousRes.data || []) as TransactionRow[]).filter((tx) => {
    const staffId = getTransactionStaffId(tx);
    return !!staffId && staffIds.includes(staffId);
  });

  const currentBookings = reservationsCurrent.length;
  const previousBookings = reservationsPrevious.length;
  const currentRevenue = transactionsCurrent.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const previousRevenue = transactionsPrevious.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const noShows = reservationsCurrent.filter((r) => r.status === 'no_show').length;

  const uniqueCustomers = new Set<string>();
  for (const row of reservationsCurrent) {
    const key = row.customer_id || row.phone || row.customer_name;
    if (key) uniqueCustomers.add(String(key));
  }

  const workingDays = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  const maxBookings = staffIds.length * workingDays * 8;
  const utilization = maxBookings > 0 ? (currentBookings / maxBookings) * 100 : 0;

  const trend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const ts = now.toISOString();
  return [
    {
      id: 'total_bookings',
      name: 'Team Bookings',
      value: currentBookings,
      trend: trend(currentBookings, previousBookings),
      type: 'count',
      period,
      last_updated: ts,
    },
    {
      id: 'total_revenue',
      name: 'Team Revenue',
      value: currentRevenue,
      trend: trend(currentRevenue, previousRevenue),
      type: 'currency',
      period,
      last_updated: ts,
    },
    {
      id: 'no_show_rate',
      name: 'Team No-Show Rate',
      value: currentBookings > 0 ? (noShows / currentBookings) * 100 : 0,
      trend: 0,
      type: 'percentage',
      period,
      last_updated: ts,
    },
    {
      id: 'avg_booking_value',
      name: 'Team Avg Booking Value',
      value: currentBookings > 0 ? currentRevenue / currentBookings : 0,
      trend: 0,
      type: 'currency',
      period,
      last_updated: ts,
    },
    {
      id: 'new_customers',
      name: 'Team New Customers',
      value: uniqueCustomers.size,
      trend: 0,
      type: 'count',
      period,
      last_updated: ts,
    },
    {
      id: 'staff_utilization',
      name: 'Team Staff Utilization',
      value: utilization,
      trend: 0,
      type: 'percentage',
      period,
      last_updated: ts,
    },
  ];
}

async function getSiasDashboardSummary(
  ctx: { supabase: SupabaseClient },
  tenantId: string
): Promise<{
  open_escalations: number;
  pending_campaigns: number;
  retrying_campaigns: number;
  memory_signals: number;
  attribution_records: number;
  attributed_revenue: number;
  campaign_success_rate: number;
  outcomes: Array<{
    id: string;
    label: string;
    count: number;
    value: number;
  }>;
}> {
  try {
    const [campaignRes, escalationRes, attributionRes, memoryRes] = await Promise.all([
      ctx.supabase
        .from('sias_campaign_runs')
        .select('status, attempts, attribution')
        .eq('tenant_id', tenantId),
      ctx.supabase
        .from('escalation_queue')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'claimed']),
      ctx.supabase
        .from('sias_outcome_attributions')
        .select('signal, value')
        .eq('tenant_id', tenantId),
      ctx.supabase
        .from('sias_operational_memory')
        .select('id')
        .eq('tenant_id', tenantId),
    ]);

    const campaigns = campaignRes.data ?? [];
    const pendingCampaigns = campaigns.filter((row) => row.status === 'pending').length;
    const retryingCampaigns = campaigns.filter((row) => row.status === 'retry_scheduled').length;
    const completedCampaigns = campaigns.filter((row) => ['sent', 'completed'].includes(row.status || '')).length;
    const campaignSuccessRate = campaigns.length > 0 ? (completedCampaigns / campaigns.length) * 100 : 0;
    const attributionRows = attributionRes.data ?? [];
    const outcomeMap = new Map<string, { id: string; label: string; count: number; value: number }>();
    for (const item of SIAS_OUTCOME_ATRIBUTION) {
      outcomeMap.set(item.id, { id: item.id, label: item.label, count: 0, value: 0 });
    }
    for (const row of attributionRows) {
      const signal = String((row as { signal?: string }).signal ?? 'revenue_recovery');
      const current = outcomeMap.get(signal) ?? {
        id: signal,
        label: signal.replace(/_/g, ' '),
        count: 0,
        value: 0,
      };
      current.count += 1;
      current.value += Number((row as { value?: number }).value ?? 0);
      outcomeMap.set(signal, current);
    }
    const attributedRevenue = outcomeMap.get('revenue_recovery')?.value ?? 0;

    return {
      open_escalations: escalationRes.data?.length ?? 0,
      pending_campaigns: pendingCampaigns,
      retrying_campaigns: retryingCampaigns,
      memory_signals: memoryRes.data?.length ?? 0,
      attribution_records: attributionRows.length,
      attributed_revenue: attributedRevenue,
      campaign_success_rate: campaignSuccessRate,
      outcomes: Array.from(outcomeMap.values()),
    };
  } catch {
    return {
      open_escalations: 0,
      pending_campaigns: 0,
      retrying_campaigns: 0,
      memory_signals: 0,
      attribution_records: 0,
      attributed_revenue: 0,
      campaign_success_rate: 0,
      outcomes: [],
    };
  }
}

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    // Validate rather than cast: an unrecognised value used to flow straight
    // through to PERIOD_MS[period], which is undefined for anything off-list, so
    // `now - undefined` produced NaN and the queries ran with Invalid Date bounds.
    const rawPeriod = searchParams.get('period');
    const period: 'day' | 'week' | 'month' | 'quarter' =
      rawPeriod === 'day' || rawPeriod === 'week' || rawPeriod === 'quarter' || rawPeriod === 'month'
        ? rawPeriod
        : 'month';
    const tenantId = getVerifiedTenantId(ctx);
    const userRole = ctx.user?.role as Role;
    const userId = ctx.user?.id;

    const rawScope = searchParams.get('scope');
    const normalizeScope = (value: string | null): 'personal' | 'team' | 'tenant' | 'global' => {
      if (value === 'personal' || value === 'team' || value === 'tenant' || value === 'global') return value;
      if (value === 'full') return 'tenant';
      if (value === 'limited' || value === 'operational') return 'team';
      const roleScope = getAnalyticsScope(userRole);
      return roleScope === 'none' ? 'personal' : roleScope;
    };
    const scope = normalizeScope(rawScope);
    const validation = validateAnalyticsRequest(userRole, scope, tenantId, userId);
    if (!validation.allowed) {
      throw ApiErrorFactory.insufficientPermissions([scope]);
    }
    if (scope === 'personal') {
      throw ApiErrorFactory.badRequest('Personal scope is not supported on this endpoint. Use /api/staff/metrics.');
    }

    const currency = await getTenantCurrency(ctx.supabase, tenantId, 'USD');

    if (scope === 'team') {
      const teamMetrics = await getTeamDashboardMetrics(ctx, tenantId, period);
      const sias = await getSiasDashboardSummary(ctx, tenantId);
      return {
        success: true,
        metrics: teamMetrics,
        sias,
        scope,
        currency,
        generated_at: new Date().toISOString(),
      };
    }

    const analyticsService = new AnalyticsService(ctx.supabase);
    const result = await analyticsService.getDashboardMetrics(tenantId, period);

    if (!result.success) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to fetch dashboard metrics'));
    }

    const sias = await getSiasDashboardSummary(ctx, tenantId);

    return {
      success: true,
      metrics: result.metrics,
      sias,
      scope,
      currency,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
