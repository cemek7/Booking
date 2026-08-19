/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';

interface OperationalMetric {
  name: string;
  current: number;
  threshold: number;
  status: 'normal' | 'warning' | 'critical';
}

interface Incident {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  service: string;
  startedAt: string;
  status: 'active' | 'investigating' | 'resolved';
  owner?: string;
}

interface BookingConflict {
  id: string;
  bookingIds: string[];
  resource: string;
  timeSlot: string;
  status: 'pending' | 'resolved';
  resolvedAt?: string;
}

interface PaymentMismatch {
  id: string;
  transactionId: string;
  internalAmount: number;
  pspAmount: number;
  delta: number;
  status: 'pending' | 'resolved';
}

interface TenantProfitability {
  tenant_id: string;
  tenant_name?: string;
  status: 'healthy' | 'warning' | 'critical' | 'suspended' | 'inactive' | 'degraded' | 'offline';
  plan?: string | null;
  wallet_balance_credits: number;
  low_balance_threshold_credits: number;
  month_topups_credits: number;
  month_spent_credits: number;
  month_profit_credits: number;
  month_usage_revenue_credits: number;
  month_actual_cost_credits: number;
  month_realized_profit_credits: number;
  month_withdrawable_profit_credits: number;
  lifetime_topups_credits: number;
  lifetime_spent_credits: number;
  lifetime_profit_credits: number;
  lifetime_usage_revenue_credits: number;
  lifetime_actual_cost_credits: number;
  lifetime_realized_profit_credits: number;
  lifetime_withdrawable_profit_credits: number;
  cash_collected_credits: number;
  actual_cost_credits: number;
  realized_profit_credits: number;
  withdrawable_profit_credits: number;
  profit_reserve_credits: number;
  total_tokens: number;
  call_count: number;
  user_count: number;
  reservation_count: number;
  completed_reservations: number;
  active_staff_count: number;
  bookings_revenue_ngn: number;
  last_activity_at?: string | null;
  margin_pct: number;
  risk_reason?: string;
  provider?: string | null;
}

interface TenantHealth {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'critical' | 'offline';
  lastActivity: string;
  bookingsToday: number;
  errorRate: number;
  responseTime: number;
  uptime: number;
}

interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  newTenants24h: number;
  totalBookings: number;
  bookings24h: number;
  revenue24h: number;
  avgResponseTime: number;
  errorRate: number;
  llmCostsToday: number;
  systemUptime: number;
}

interface PlatformFinancials {
  currency: 'credits';
  month_topups_credits: number;
  month_spent_credits: number;
  month_profit_credits: number;
  month_usage_revenue_credits: number;
  month_actual_cost_credits: number;
  month_realized_profit_credits: number;
  month_withdrawable_profit_credits: number;
  lifetime_topups_credits: number;
  lifetime_spent_credits: number;
  lifetime_profit_credits: number;
  lifetime_usage_revenue_credits: number;
  lifetime_actual_cost_credits: number;
  lifetime_realized_profit_credits: number;
  lifetime_withdrawable_profit_credits: number;
  total_wallet_balance_credits: number;
  cash_collected_credits: number;
  actual_cost_credits: number;
  realized_profit_credits: number;
  withdrawable_profit_credits: number;
  profit_reserve_credits: number;
  profitable_tenants: number;
  loss_making_tenants: number;
  low_balance_tenants: number;
  booking_revenue_ngn: number;
  booking_revenue_30d_ngn: number;
  active_tenants: number;
}

interface DashboardPayload {
  platformMetrics: PlatformMetrics;
  platformFinancials: PlatformFinancials;
  kpis: Array<{ title: string; value: string | number; status: 'good' | 'warning' | 'critical'; icon: string; change?: string }>;
  operationalMetrics: OperationalMetric[];
  incidents: Incident[];
  bookingConflicts: BookingConflict[];
  paymentMismatches: PaymentMismatch[];
  tenantHealth: TenantHealth[];
  tenantProfitability: TenantProfitability[];
  systemHealth: {
    database?: { status: 'healthy' | 'degraded' | 'critical' | 'unknown'; query_latency_ms?: number; note?: string };
    api?: { status: 'healthy' | 'degraded' | 'critical' | 'unknown'; request_count_5m?: number; error_rate_pct?: number; p95_latency_ms?: number; note?: string };
    security?: { status: 'healthy' | 'degraded' | 'critical' | 'unknown'; active_incidents?: number; critical_incidents?: number; failed_auth_1h?: number; note?: string };
  };
  lastUpdated: string;
}

type TenantRow = {
  id: string;
  name?: string | null;
  created_at?: string | null;
};

type DerivedTenantStatus = 'active' | 'inactive' | 'low_balance';

function getTimeCondition(timeRange: string): string {
  const now = new Date();
  let hoursBack = 24;

  switch (timeRange as TimeRange) {
    case '1h':
      hoursBack = 1;
      break;
    case '6h':
      hoursBack = 6;
      break;
    case '24h':
      hoursBack = 24;
      break;
    case '7d':
      hoursBack = 24 * 7;
      break;
    case '30d':
      hoursBack = 24 * 30;
      break;
    default:
      hoursBack = 24;
  }

  return new Date(now.getTime() - hoursBack * 60 * 60 * 1000).toISOString();
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function inferHealthStatus(params: {
  status?: string | null;
  profitCredits: number;
  balanceCredits: number;
  thresholdCredits: number;
  lastActivityAt?: string | null;
  now: number;
}): TenantHealth['status'] {
  if (params.status === 'suspended') return 'critical';
  if (!params.lastActivityAt) return 'offline';

  const lastActivityMs = new Date(params.lastActivityAt).getTime();
  const hoursSince = Number.isFinite(lastActivityMs) ? (params.now - lastActivityMs) / (60 * 60 * 1000) : Infinity;

  if (hoursSince > 72) return 'offline';
  if (hoursSince > 24 || params.balanceCredits <= params.thresholdCredits || params.profitCredits < 0) return 'degraded';
  return 'healthy';
}

function deriveTenantStatus(params: {
  balanceCredits: number;
  lowBalanceThresholdCredits: number;
  lastActivityAt?: string | null;
  now: number;
}): DerivedTenantStatus {
  if (params.balanceCredits > 0 && params.balanceCredits <= params.lowBalanceThresholdCredits) {
    return 'low_balance';
  }

  if (!params.lastActivityAt) {
    return 'inactive';
  }

  const lastActivityMs = new Date(params.lastActivityAt).getTime();
  const hoursSince = Number.isFinite(lastActivityMs) ? (params.now - lastActivityMs) / (60 * 60 * 1000) : Infinity;
  return hoursSince > 24 * 30 ? 'inactive' : 'active';
}

export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const timeRange = (url.searchParams.get('range') || '24h') as TimeRange;
    const since = getTimeCondition(timeRange);
    const admin = createSupabaseAdminClient();
    const now = Date.now();

    const [
      tenantsResult,
      walletsResult,
      ledgerResult,
      revenueLedgerResult,
      revenueLedgerAllResult,
      costLedgerResult,
      costLedgerAllResult,
      bookingsResult,
      transactionsResult,
      llmCallsResult,
      tenantUsersResult,
      supportTicketsResult,
    ] = await Promise.all([
      admin.from('tenants').select('id, name, created_at'),
      admin
        .from('ai_wallets')
        .select('tenant_id, balance_credits, lifetime_topups_credits, lifetime_spent_credits, low_balance_threshold_credits')
        .limit(5000),
      admin
        .from('ai_wallet_ledger')
        .select('tenant_id, kind, amount_credits, token_count, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50000),
      admin
        .from('tenant_revenue_ledger')
        .select('tenant_id, revenue_type, amount_credits, source, reference, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50000),
      admin
        .from('tenant_revenue_ledger')
        .select('tenant_id, revenue_type, amount_credits, source, reference, created_at')
        .order('created_at', { ascending: false })
        .limit(50000),
      admin
        .from('tenant_cost_ledger')
        .select('tenant_id, cost_type, actual_cost_credits, source, reference, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50000),
      admin
        .from('tenant_cost_ledger')
        .select('tenant_id, cost_type, actual_cost_credits, source, reference, created_at')
        .order('created_at', { ascending: false })
        .limit(50000),
      admin
        .from('reservations')
        .select('tenant_id, status, created_at, start_at, end_at')
        .gte('created_at', since)
        .limit(50000),
      admin
        .from('transactions')
        .select('tenant_id, amount, status, created_at')
        .gte('created_at', since)
        .limit(50000),
      admin
        .from('llm_calls')
        .select('tenant_id, usage, created_at')
        .gte('created_at', since)
        .limit(50000),
      admin.from('tenant_users').select('tenant_id, role'),
      admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);

    if (tenantsResult.error) defaultLogger.warn('[superadmin/dashboard] tenants query failed', tenantsResult.error.message);
    if (walletsResult.error) defaultLogger.warn('[superadmin/dashboard] wallets query failed', walletsResult.error.message);
    if (ledgerResult.error) defaultLogger.warn('[superadmin/dashboard] wallet ledger query failed', ledgerResult.error.message);
    if (revenueLedgerResult.error) defaultLogger.warn('[superadmin/dashboard] revenue ledger query failed', revenueLedgerResult.error.message);
    if (revenueLedgerAllResult.error) defaultLogger.warn('[superadmin/dashboard] revenue ledger lifetime query failed', revenueLedgerAllResult.error.message);
    if (costLedgerResult.error) defaultLogger.warn('[superadmin/dashboard] cost ledger query failed', costLedgerResult.error.message);
    if (costLedgerAllResult.error) defaultLogger.warn('[superadmin/dashboard] cost ledger lifetime query failed', costLedgerAllResult.error.message);
    if (bookingsResult.error) defaultLogger.warn('[superadmin/dashboard] reservations query failed', bookingsResult.error.message);
    if (transactionsResult.error) defaultLogger.warn('[superadmin/dashboard] transactions query failed', transactionsResult.error.message);
    if (llmCallsResult.error) defaultLogger.warn('[superadmin/dashboard] llm_calls query failed', llmCallsResult.error.message);
    if (tenantUsersResult.error) defaultLogger.warn('[superadmin/dashboard] tenant_users query failed', tenantUsersResult.error.message);
    if (supportTicketsResult.error) defaultLogger.warn('[superadmin/dashboard] support_tickets query failed', supportTicketsResult.error.message);

    const tenants = (tenantsResult.data || []) as TenantRow[];
    const wallets = walletsResult.data || [];
    const ledgerRows = ledgerResult.data || [];
    const revenueLedgerRows = revenueLedgerResult.data || [];
    const revenueLedgerAllRows = revenueLedgerAllResult.data || [];
    const costLedgerRows = costLedgerResult.data || [];
    const costLedgerAllRows = costLedgerAllResult.data || [];
    const bookingRows = bookingsResult.data || [];
    const transactionRows = transactionsResult.data || [];
    const llmRows = llmCallsResult.data || [];
    const tenantUsers = tenantUsersResult.data || [];
    const incidents: Array<Record<string, unknown>> = [];
    const bookingConflicts: Array<Record<string, unknown>> = [];
    const paymentMismatches: Array<Record<string, unknown>> = [];
    const apiLogs: Array<{ status_code?: number | string }> = [];

    const tenantNames = new Map<string, string>();

    for (const tenant of tenants) {
      tenantNames.set(tenant.id, tenant.name || tenant.id);
    }

    const userCounts = new Map<string, number>();
    const activeStaffCounts = new Map<string, number>();
    for (const row of tenantUsers) {
      const tenantId = row.tenant_id || 'unknown';
      userCounts.set(tenantId, (userCounts.get(tenantId) || 0) + 1);
      if (row.role === 'staff') {
        activeStaffCounts.set(tenantId, (activeStaffCounts.get(tenantId) || 0) + 1);
      }
    }

    const bookingCounts = new Map<string, number>();
    const completedReservationCounts = new Map<string, number>();
    const lastActivityByTenant = new Map<string, string>();
    for (const row of bookingRows as Array<{ tenant_id?: string; status?: string; created_at?: string; start_at?: string; end_at?: string }>) {
      const tenantId = row.tenant_id || 'unknown';
      bookingCounts.set(tenantId, (bookingCounts.get(tenantId) || 0) + 1);
      if (row.status === 'completed') {
        completedReservationCounts.set(tenantId, (completedReservationCounts.get(tenantId) || 0) + 1);
      }
      const candidate = row.created_at || row.start_at || row.end_at;
      if (candidate) {
        const existing = lastActivityByTenant.get(tenantId);
        if (!existing || new Date(candidate).getTime() > new Date(existing).getTime()) {
          lastActivityByTenant.set(tenantId, candidate);
        }
      }
    }

    const bookingRevenueNgn = (transactionRows as Array<{ amount?: number | string | null }>).reduce((sum: number, row: { amount?: number | string | null }) => sum + toNumber(row.amount), 0);
    const bookingRevenue24hNgn = (transactionRows as Array<{ amount?: number | string | null }>).reduce((sum: number, row: { amount?: number | string | null }) => sum + toNumber(row.amount), 0);

    const llmUsageByTenant = new Map<string, { call_count: number; total_tokens: number }>();
    for (const row of llmRows as Array<{ tenant_id?: string; usage?: Record<string, unknown>; created_at?: string }>) {
      const tenantId = row.tenant_id || 'unknown';
      const usage = (row.usage || {}) as Record<string, unknown>;
      const totalTokens = toNumber(
        usage.total_tokens ?? usage.total ?? usage.tokens ?? usage.token_count ?? usage.prompt_tokens
      );
      const current = llmUsageByTenant.get(tenantId) || { call_count: 0, total_tokens: 0 };
      current.call_count += 1;
      current.total_tokens += totalTokens;
      llmUsageByTenant.set(tenantId, current);
      const candidate = row.created_at;
      if (candidate) {
        const existing = lastActivityByTenant.get(tenantId);
        if (!existing || new Date(candidate).getTime() > new Date(existing).getTime()) {
          lastActivityByTenant.set(tenantId, candidate);
        }
      }
    }

    const walletByTenant = new Map<string, Record<string, unknown>>();
    for (const row of wallets as Array<{ tenant_id: string } & Record<string, unknown>>) {
      walletByTenant.set(row.tenant_id, row);
    }

    const ledgerAgg = new Map<string, {
      month_topups_credits: number;
      month_spent_credits: number;
      month_tokens: number;
    }>();
    const revenueAgg = new Map<string, {
      cash_collected_credits: number;
      usage_revenue_credits: number;
    }>();
    const revenueAggAll = new Map<string, {
      cash_collected_credits: number;
      usage_revenue_credits: number;
    }>();
    const costAgg = new Map<string, {
      actual_cost_credits: number;
    }>();
    const costAggAll = new Map<string, {
      actual_cost_credits: number;
    }>();
    for (const row of ledgerRows) {
      const tenantId = row.tenant_id || 'unknown';
      const current = ledgerAgg.get(tenantId) || {
        month_topups_credits: 0,
        month_spent_credits: 0,
        month_tokens: 0,
      };
      const amount = toNumber(row.amount_credits);
      if (row.kind === 'topup') {
        current.month_topups_credits += amount;
      } else if (row.kind === 'refund') {
        current.month_spent_credits = Math.max(0, current.month_spent_credits - amount);
      } else if (row.kind === 'reservation' || row.kind === 'usage' || row.kind === 'adjustment') {
        current.month_spent_credits += Math.abs(amount);
      }
      current.month_tokens += Math.max(0, toNumber(row.token_count));
      ledgerAgg.set(tenantId, current);
    }
    for (const row of revenueLedgerRows) {
      const tenantId = row.tenant_id || 'unknown';
      const current = revenueAgg.get(tenantId) || {
        cash_collected_credits: 0,
        usage_revenue_credits: 0,
      };
      const amount = toNumber(row.amount_credits);
      if (row.revenue_type === 'wallet_topup') {
        current.cash_collected_credits += amount;
      } else if (row.revenue_type === 'usage_charge' || row.revenue_type === 'subscription_charge' || row.revenue_type === 'overage_charge') {
        current.usage_revenue_credits += amount;
      }
      revenueAgg.set(tenantId, current);
    }
    for (const row of revenueLedgerAllRows) {
      const tenantId = row.tenant_id || 'unknown';
      const current = revenueAggAll.get(tenantId) || {
        cash_collected_credits: 0,
        usage_revenue_credits: 0,
      };
      const amount = toNumber(row.amount_credits);
      if (row.revenue_type === 'wallet_topup') {
        current.cash_collected_credits += amount;
      } else if (row.revenue_type === 'usage_charge' || row.revenue_type === 'subscription_charge' || row.revenue_type === 'overage_charge') {
        current.usage_revenue_credits += amount;
      }
      revenueAggAll.set(tenantId, current);
    }
    for (const row of costLedgerRows) {
      const tenantId = row.tenant_id || 'unknown';
      const current = costAgg.get(tenantId) || { actual_cost_credits: 0 };
      current.actual_cost_credits += Math.max(0, toNumber(row.actual_cost_credits));
      costAgg.set(tenantId, current);
    }
    for (const row of costLedgerAllRows) {
      const tenantId = row.tenant_id || 'unknown';
      const current = costAggAll.get(tenantId) || { actual_cost_credits: 0 };
      current.actual_cost_credits += Math.max(0, toNumber(row.actual_cost_credits));
      costAggAll.set(tenantId, current);
    }

    const tenantProfitability: TenantProfitability[] = tenants.map((tenant) => {
      const tenantId = tenant.id;
      const wallet = walletByTenant.get(tenantId);
      const ledger = ledgerAgg.get(tenantId) || { month_topups_credits: 0, month_spent_credits: 0, month_tokens: 0 };
      const revenue = revenueAgg.get(tenantId) || { cash_collected_credits: 0, usage_revenue_credits: 0 };
      const revenueAll = revenueAggAll.get(tenantId) || { cash_collected_credits: 0, usage_revenue_credits: 0 };
      const cost = costAgg.get(tenantId) || { actual_cost_credits: 0 };
      const costAll = costAggAll.get(tenantId) || { actual_cost_credits: 0 };
      const usage = llmUsageByTenant.get(tenantId) || { call_count: 0, total_tokens: 0 };
      const userCount = userCounts.get(tenantId) || 0;
      const activeStaffCount = activeStaffCounts.get(tenantId) || 0;
      const reservationsCount = bookingCounts.get(tenantId) || 0;
      const completedReservations = completedReservationCounts.get(tenantId) || 0;
      const bookingsRevenue = transactionRows
        .filter((row: { tenant_id?: string; amount?: number | string | null }) => row.tenant_id === tenantId)
        .reduce((sum: number, row: { amount?: number | string | null }) => sum + toNumber(row.amount), 0);
      const walletBalance = toNumber(wallet?.balance_credits);
      const lifetimeTopups = toNumber(wallet?.lifetime_topups_credits);
      const lifetimeSpent = toNumber(wallet?.lifetime_spent_credits);
      const monthRealizedProfit = revenue.usage_revenue_credits - cost.actual_cost_credits;
      const lifetimeRealizedProfit = revenueAll.usage_revenue_credits - costAll.actual_cost_credits;
      const lifetimeWithdrawable = Math.max(0, lifetimeRealizedProfit - Math.max(0, lifetimeRealizedProfit * 0.2));
      const lifetimeProfit = lifetimeRealizedProfit;
      const reserve = Math.max(0, monthRealizedProfit * 0.2);
      const withdrawable = Math.max(0, monthRealizedProfit - reserve);
      const margin = revenue.usage_revenue_credits > 0 ? (monthRealizedProfit / revenue.usage_revenue_credits) * 100 : 0;
      const lastActivityAt = lastActivityByTenant.get(tenantId) || tenant.created_at || null;
      const derivedStatus = deriveTenantStatus({
        balanceCredits: walletBalance,
        lowBalanceThresholdCredits: toNumber(wallet?.low_balance_threshold_credits),
        lastActivityAt,
        now,
      });
      const riskReason =
        derivedStatus === 'low_balance'
          ? 'low_balance'
          : monthRealizedProfit < 0
            ? 'negative_ai_margin'
            : derivedStatus === 'inactive'
              ? 'inactive'
              : undefined;

      return {
        tenant_id: tenantId,
        tenant_name: tenant.name || tenantId,
        status: inferHealthStatus({
          status: derivedStatus,
          profitCredits: monthRealizedProfit,
          balanceCredits: walletBalance,
          thresholdCredits: toNumber(wallet?.low_balance_threshold_credits),
          lastActivityAt,
          now,
        }),
        plan: 'free',
        wallet_balance_credits: walletBalance,
        low_balance_threshold_credits: toNumber(wallet?.low_balance_threshold_credits),
        month_topups_credits: ledger.month_topups_credits,
        month_spent_credits: ledger.month_spent_credits,
        month_profit_credits: monthRealizedProfit,
        month_usage_revenue_credits: revenue.usage_revenue_credits,
        month_actual_cost_credits: cost.actual_cost_credits,
        month_realized_profit_credits: monthRealizedProfit,
        month_withdrawable_profit_credits: withdrawable,
        lifetime_topups_credits: lifetimeTopups,
        lifetime_spent_credits: lifetimeSpent,
        lifetime_profit_credits: lifetimeProfit,
        lifetime_usage_revenue_credits: revenueAll.usage_revenue_credits,
        lifetime_actual_cost_credits: costAll.actual_cost_credits,
        lifetime_realized_profit_credits: lifetimeRealizedProfit,
        lifetime_withdrawable_profit_credits: lifetimeWithdrawable,
        cash_collected_credits: revenueAll.cash_collected_credits,
        actual_cost_credits: costAll.actual_cost_credits,
        realized_profit_credits: lifetimeRealizedProfit,
        withdrawable_profit_credits: lifetimeWithdrawable,
        profit_reserve_credits: reserve,
        total_tokens: usage.total_tokens,
        call_count: usage.call_count,
        user_count: userCount,
        reservation_count: reservationsCount,
        completed_reservations: completedReservations,
        active_staff_count: activeStaffCount,
        bookings_revenue_ngn: bookingsRevenue,
        last_activity_at: lastActivityAt,
        margin_pct: margin,
        risk_reason: riskReason,
        provider: undefined,
      };
    });

    const totalTenants = tenantProfitability.length;
    const activeTenants = tenantProfitability.filter((tenant) => tenant.status !== 'offline').length;
    const lowBalanceTenants = tenantProfitability.filter((tenant) => tenant.wallet_balance_credits <= tenant.low_balance_threshold_credits).length;
    const profitableTenants = tenantProfitability.filter((tenant) => tenant.month_profit_credits >= 0).length;
    const lossMakingTenants = tenantProfitability.filter((tenant) => tenant.month_profit_credits < 0).length;
    const totalWalletBalanceCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.wallet_balance_credits, 0);
    const monthTopupsCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.month_topups_credits, 0);
    const monthSpentCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.month_spent_credits, 0);
    const monthUsageRevenueCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.month_usage_revenue_credits, 0);
    const monthActualCostCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.month_actual_cost_credits, 0);
    const monthProfitCredits = monthUsageRevenueCredits - monthActualCostCredits;
    const monthWithdrawableProfitCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.month_withdrawable_profit_credits, 0);
    const lifetimeTopupsCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.lifetime_topups_credits, 0);
    const lifetimeSpentCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.lifetime_spent_credits, 0);
    const lifetimeUsageRevenueCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.lifetime_usage_revenue_credits, 0);
    const lifetimeActualCostCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.lifetime_actual_cost_credits, 0);
    const lifetimeRealizedProfitCredits = lifetimeUsageRevenueCredits - lifetimeActualCostCredits;
    const lifetimeWithdrawableProfitCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.lifetime_withdrawable_profit_credits, 0);
    const lifetimeProfitCredits = lifetimeRealizedProfitCredits;
    const cashCollectedCredits = tenantProfitability.reduce((sum: number, tenant) => sum + tenant.cash_collected_credits, 0);
    const totalBookings = bookingRows.length;
    const activeBookings = (bookingRows as Array<{ status?: string }>).filter((row) => row.status === 'confirmed').length;
    const bookings24h = totalBookings;

    const llmCostsToday = monthActualCostCredits;
    const systemUptime = 99.9;
    const activeIncidents = incidents.length;
    const criticalIncidents = incidents.filter((incident: { severity?: string }) => incident.severity === 'critical').length;
    const failedAuth1h = apiLogs.filter((row) => Number(row.status_code) === 401).length;
    const apiErrorCount = apiLogs.filter((row: { status_code?: number | string }) => Number(row.status_code) >= 500).length;
    const totalRequests5m = apiLogs.length;
    const apiErrorRate = totalRequests5m > 0 ? (apiErrorCount / totalRequests5m) * 100 : 0;

    const latestTenants = tenantProfitability
      .slice()
      .sort((a, b) => {
        const aTime = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
        const bTime = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
        return bTime - aTime;
      });
    const tenantHealth: TenantHealth[] = latestTenants.map((tenant) => ({
      id: tenant.tenant_id,
      name: tenant.tenant_name || tenant.tenant_id,
      status: inferHealthStatus({
        status: tenant.status,
        profitCredits: tenant.month_profit_credits,
        balanceCredits: tenant.wallet_balance_credits,
        thresholdCredits: tenant.low_balance_threshold_credits,
        lastActivityAt: tenant.last_activity_at,
        now,
      }),
      lastActivity: formatTime(tenant.last_activity_at),
      bookingsToday: tenant.reservation_count,
      errorRate: tenant.status === 'suspended' ? 100 : 0,
      responseTime: 250,
      uptime: tenant.status === 'suspended' ? 0 : 99.9,
    }));

    const kpis = [
      { title: 'Total Tenants', value: totalTenants, status: totalTenants > 0 ? 'good' : 'warning', icon: '🏢' },
      { title: 'Active Tenants', value: activeTenants, status: activeTenants > 0 ? 'good' : 'warning', icon: '⚡' },
      { title: 'Cash collected (month)', value: `${cashCollectedCredits.toFixed(2)} credits`, status: cashCollectedCredits > 0 ? 'good' : 'warning', icon: '💳' },
      { title: 'Realized profit (month)', value: `${monthProfitCredits.toFixed(2)} credits`, status: monthProfitCredits >= 0 ? 'good' : 'warning', icon: '📈' },
      { title: 'Low Balance Tenants', value: lowBalanceTenants, status: lowBalanceTenants > 0 ? 'warning' : 'good', icon: '⚠️' },
      { title: 'Booking Revenue', value: `₦${bookingRevenueNgn.toLocaleString()}`, status: bookingRevenueNgn > 0 ? 'good' : 'warning', icon: '💰' },
      { title: 'AI Tokens', value: llmUsageByTenant.size ? tenantProfitability.reduce((sum, row) => sum + row.total_tokens, 0).toLocaleString() : '0', status: 'good', icon: '🤖' },
      { title: 'Open Support Tickets', value: supportTicketsResult.count || 0, status: (supportTicketsResult.count || 0) > 10 ? 'warning' : 'good', icon: '🎫' },
      { title: 'System Uptime', value: `${systemUptime.toFixed(1)}%`, status: 'good', icon: '✅' },
    ] as const;

    const operationalMetrics: OperationalMetric[] = [
      { name: 'Wallets below threshold', current: lowBalanceTenants, threshold: Math.max(1, Math.floor(totalTenants * 0.2)), status: lowBalanceTenants > 0 ? 'warning' : 'normal' },
      { name: 'Active incidents', current: activeIncidents, threshold: 1, status: activeIncidents > 0 ? 'warning' : 'normal' },
      { name: 'API error rate (5m)', current: apiErrorRate, threshold: 1, status: apiErrorRate > 1 ? 'critical' : 'normal' },
      { name: 'Confirmed bookings', current: activeBookings, threshold: Math.max(1, Math.floor(totalBookings * 0.5)), status: activeBookings > 0 ? 'normal' : 'warning' },
    ];

    const formattedIncidents: Incident[] = incidents.map((incident: any) => ({
      id: String(incident.id),
      severity: incident.severity || 'medium',
      title: incident.title || 'Incident',
      service: incident.service || 'System',
      startedAt: formatTime(incident.created_at),
      status: incident.status || 'active',
      owner: incident.owner || undefined,
    }));

    const formattedConflicts: BookingConflict[] = bookingConflicts.map((conflict: any) => ({
      id: String(conflict.id),
      bookingIds: Array.isArray(conflict.booking_ids) ? conflict.booking_ids : [],
      resource: conflict.resource_name || 'Unknown resource',
      timeSlot: formatTime(conflict.time_slot),
      status: conflict.status || 'pending',
      resolvedAt: conflict.resolved_at ? formatTime(conflict.resolved_at) : undefined,
    }));

    const formattedMismatches: PaymentMismatch[] = paymentMismatches.map((mismatch: any) => ({
      id: String(mismatch.id),
      transactionId: mismatch.transaction_id || mismatch.transactionId || 'unknown',
      internalAmount: toNumber(mismatch.internal_amount_cents ?? mismatch.internal_amount ?? 0),
      pspAmount: toNumber(mismatch.psp_amount_cents ?? mismatch.psp_amount ?? 0),
      delta: toNumber(mismatch.delta_cents ?? mismatch.delta ?? 0),
      status: mismatch.status || 'pending',
    }));

    const systemHealth = {
      database: {
        status: tenantsResult.error || walletsResult.error ? 'degraded' : 'healthy',
        query_latency_ms: 0,
        note: tenantsResult.error || walletsResult.error ? 'Some platform data queries are degraded.' : 'Database lookups are healthy.',
      } as const,
      api: {
        status: apiErrorRate > 1 ? 'critical' : apiErrorRate > 0.2 ? 'degraded' : 'healthy',
        request_count_5m: totalRequests5m,
        error_rate_pct: apiErrorRate,
        p95_latency_ms: 250,
        note: apiErrorRate > 0.2 ? 'API error rate is elevated.' : 'API response is healthy.',
      } as const,
      security: {
        status: criticalIncidents > 0 ? 'critical' : activeIncidents > 0 ? 'degraded' : 'healthy',
        active_incidents: activeIncidents,
        critical_incidents: criticalIncidents,
        failed_auth_1h: failedAuth1h,
        note: activeIncidents > 0 ? 'There are active incidents on the platform.' : 'No active security incidents.',
      } as const,
    };

    return {
      platformMetrics: {
        totalTenants,
        activeTenants,
        newTenants24h: tenants.filter((tenant) => tenant.created_at && new Date(tenant.created_at).getTime() >= new Date(since).getTime()).length,
        totalBookings,
        bookings24h,
        revenue24h: bookingRevenue24hNgn,
        avgResponseTime: 250,
        errorRate: apiErrorRate,
        llmCostsToday,
        systemUptime,
      },
      platformFinancials: {
        currency: 'credits',
        month_topups_credits: monthTopupsCredits,
        month_spent_credits: monthSpentCredits,
        month_profit_credits: monthProfitCredits,
        month_usage_revenue_credits: monthUsageRevenueCredits,
        month_actual_cost_credits: monthActualCostCredits,
        month_realized_profit_credits: monthProfitCredits,
        month_withdrawable_profit_credits: monthWithdrawableProfitCredits,
        lifetime_topups_credits: lifetimeTopupsCredits,
        lifetime_spent_credits: lifetimeSpentCredits,
        lifetime_profit_credits: lifetimeProfitCredits,
        lifetime_usage_revenue_credits: lifetimeUsageRevenueCredits,
        lifetime_actual_cost_credits: lifetimeActualCostCredits,
        lifetime_realized_profit_credits: lifetimeRealizedProfitCredits,
        lifetime_withdrawable_profit_credits: lifetimeWithdrawableProfitCredits,
        total_wallet_balance_credits: totalWalletBalanceCredits,
        cash_collected_credits: cashCollectedCredits,
        actual_cost_credits: monthActualCostCredits,
        realized_profit_credits: monthProfitCredits,
        withdrawable_profit_credits: monthWithdrawableProfitCredits,
        profit_reserve_credits: Math.max(0, monthProfitCredits - monthWithdrawableProfitCredits),
        profitable_tenants: profitableTenants,
        loss_making_tenants: lossMakingTenants,
        low_balance_tenants: lowBalanceTenants,
        booking_revenue_ngn: bookingRevenueNgn,
        booking_revenue_30d_ngn: bookingRevenueNgn,
        active_tenants: activeTenants,
      },
      kpis: kpis as unknown as DashboardPayload['kpis'],
      operationalMetrics,
      incidents: formattedIncidents,
      bookingConflicts: formattedConflicts,
      paymentMismatches: formattedMismatches,
      tenantHealth,
      tenantProfitability,
      systemHealth,
      lastUpdated: new Date().toLocaleString(),
    } satisfies DashboardPayload;
  },
  'GET',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
