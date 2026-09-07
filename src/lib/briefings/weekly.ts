import type { SupabaseClient } from '@supabase/supabase-js';
import { runMetric } from '@/lib/analytics/metrics/registry';

export interface BriefingPayload {
  body: string;
  meta: Record<string, unknown>;
}

function localDateString(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function rangeForLastDays(timezone: string, days: number, now = new Date()) {
  const businessDate = localDateString(timezone, now);
  const end = new Date(`${businessDate}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return {
    start: `${start.toISOString().slice(0, 10)}T00:00:00`,
    end: `${end.toISOString().slice(0, 10)}T00:00:00`,
  };
}

function naira(amount: number) {
  return `₦${Math.round(amount).toLocaleString()}`;
}

export async function buildWeeklyBriefing(
  admin: SupabaseClient,
  tenantId: string,
  now = new Date(),
): Promise<BriefingPayload | null> {
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('name, timezone')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError) throw tenantError;

  const timezone = typeof tenant?.timezone === 'string' ? tenant.timezone : 'Africa/Lagos';
  const currentRange = rangeForLastDays(timezone, 7, now);
  const priorAnchor = new Date(`${currentRange.start}Z`);
  const previousRange = {
    start: `${new Date(priorAnchor.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}T00:00:00`,
    end: currentRange.start,
  };

  const [{ data: currentInsights, error: insightsError }, { data: revenueRows, error: revenueError }, { data: costRows, error: costError }, { data: anomalies, error: anomalyError }] = await Promise.all([
    admin
      .from('insights_daily')
      .select('total_bookings, completed, cancelled, no_shows, revenue')
      .eq('tenant_id', tenantId)
      .gte('date', currentRange.start.slice(0, 10))
      .lt('date', currentRange.end.slice(0, 10)),
    admin
      .from('tenant_revenue_ledger')
      .select('amount')
      .eq('tenant_id', tenantId)
      .gte('created_at', currentRange.start)
      .lt('created_at', currentRange.end),
    admin
      .from('tenant_cost_ledger')
      .select('amount')
      .eq('tenant_id', tenantId)
      .gte('created_at', currentRange.start)
      .lt('created_at', currentRange.end),
    admin
      .from('business_anomalies')
      .select('rule_key, difference_cents')
      .eq('tenant_id', tenantId)
      .gte('created_at', currentRange.start)
      .lt('created_at', currentRange.end),
  ]);

  if (insightsError) throw insightsError;
  if (revenueError) throw revenueError;
  if (costError) throw costError;
  if (anomalyError) throw anomalyError;

  const { data: pendingRecommendations, error: recommendationError } = await admin
    .from('business_recommendations')
    .select('id, title, recommended_action, confidence')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('confidence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(3);
  if (recommendationError) throw recommendationError;

  const [{ result: topProducts }, { result: topServices }, { result: topCustomers }, { result: staffRevenue }, { result: deadStock }, { result: outstanding }, { result: currentRevenue }, { result: previousRevenue }] = await Promise.all([
    runMetric(admin, tenantId, 'top_products', { dimensions: ['product'], filters: { ...currentRange, limit: 3 }, aggregation: 'rank' }),
    runMetric(admin, tenantId, 'top_services', { dimensions: ['service'], filters: { limit: 3 }, aggregation: 'rank' }),
    runMetric(admin, tenantId, 'top_customers', { dimensions: ['customer'], filters: { limit: 3 }, aggregation: 'rank' }),
    runMetric(admin, tenantId, 'staff_revenue', { dimensions: ['staff'], filters: { limit: 3 }, aggregation: 'rank' }),
    runMetric(admin, tenantId, 'dead_stock', { dimensions: ['product'], filters: { ...currentRange, limit: 5 }, aggregation: 'rank' }),
    runMetric(admin, tenantId, 'outstanding_total', { aggregation: 'sum' }),
    runMetric(admin, tenantId, 'revenue_total', { filters: currentRange, aggregation: 'sum' }),
    runMetric(admin, tenantId, 'revenue_total', { filters: previousRange, aggregation: 'sum' }),
  ]);

  const totals = (currentInsights ?? []).reduce(
    (acc, row) => {
      acc.bookings += Number(row.total_bookings ?? 0);
      acc.completed += Number(row.completed ?? 0);
      acc.cancelled += Number(row.cancelled ?? 0);
      acc.noShows += Number(row.no_shows ?? 0);
      acc.revenue += Number(row.revenue ?? 0);
      return acc;
    },
    { bookings: 0, completed: 0, cancelled: 0, noShows: 0, revenue: 0 },
  );

  const recognizedRevenue = (revenueRows ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const actualCost = (costRows ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const grossMargin = recognizedRevenue > 0 ? ((recognizedRevenue - actualCost) / recognizedRevenue) * 100 : 0;
  const inventoryLoss = (anomalies ?? [])
    .filter((row) => ['stock_shrinkage', 'unusual_consumption'].includes(String(row.rule_key ?? '')))
    .reduce((sum, row) => sum + Math.abs(Number(row.difference_cents ?? 0)) / 100, 0);
  const outstandingAmount = Number((outstanding.summary?.total_outstanding as number | undefined) ?? 0);
  const priorRevenueAmount = Number((previousRevenue.summary?.total_amount as number | undefined) ?? 0);
  const currentRevenueAmount = Number((currentRevenue.summary?.total_amount as number | undefined) ?? 0);
  const revenueDelta = currentRevenueAmount - priorRevenueAmount;
  const noShowRate = totals.completed + totals.noShows > 0 ? (totals.noShows / (totals.completed + totals.noShows)) * 100 : 0;

  const recommendations: string[] = [];
  if (noShowRate >= 10) recommendations.push('No-shows are elevated; tighten confirmations and deposits.');
  if (deadStock.rows.length > 0) recommendations.push('Run a dead-stock push or bundle to unlock tied-up cash.');
  if (outstandingAmount > 0) recommendations.push('Collect outstanding balances before they age further.');
  if (grossMargin > 0 && grossMargin < 30) recommendations.push('Margin is thin; review pricing or cost leakage.');
  for (const recommendation of pendingRecommendations ?? []) {
    recommendations.push(`${String(recommendation.title)} — ${String(recommendation.recommended_action)}`);
  }

  if (
    totals.bookings === 0 &&
    currentRevenueAmount === 0 &&
    outstandingAmount <= 0 &&
    deadStock.rows.length === 0 &&
    topProducts.rows.length === 0
  ) {
    return null;
  }

  const body = [
    `📈 *Weekly Briefing — ${tenant?.name ?? 'your business'}*`,
    '',
    `Revenue: ${naira(currentRevenueAmount)} (${revenueDelta >= 0 ? '+' : ''}${naira(revenueDelta)} vs prior week)`,
    `Bookings: ${totals.completed} completed, ${totals.cancelled} cancelled, ${totals.noShows} no-shows`,
    `Gross margin: ${grossMargin.toFixed(1)}%`,
    `Inventory loss flagged: ${naira(inventoryLoss)}`,
    `Outstanding balances: ${naira(outstandingAmount)}`,
    topProducts.rows[0] ? `Top product: ${String(topProducts.rows[0].product_name)} (${topProducts.rows[0].quantity} sold)` : 'Top product: n/a',
    topServices.rows[0] ? `Top service: ${String(topServices.rows[0].service_name)} (${naira(Number(topServices.rows[0].revenue ?? 0))})` : 'Top service: n/a',
    topCustomers.rows[0] ? `Top customer: ${String(topCustomers.rows[0].customer_name)} (${naira(Number(topCustomers.rows[0].lifetime_value ?? 0))})` : 'Top customer: n/a',
    staffRevenue.rows[0] ? `Top staff: ${String(staffRevenue.rows[0].staff_name)} (${naira(Number(staffRevenue.rows[0].revenue ?? 0))})` : 'Top staff: n/a',
    ...(recommendations.length ? ['', 'Recommended actions:', ...recommendations.map((item) => `• ${item}`)] : []),
  ].join('\n');

  return {
    body,
    meta: {
      current_range: currentRange,
      previous_range: previousRange,
      revenue: currentRevenueAmount,
      prior_revenue: priorRevenueAmount,
      recognized_revenue: recognizedRevenue,
      actual_cost: actualCost,
      gross_margin_pct: grossMargin,
      no_show_rate_pct: noShowRate,
      outstanding_amount: outstandingAmount,
      dead_stock_count: deadStock.rows.length,
      recommendations,
    },
  };
}
