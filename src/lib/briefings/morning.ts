import type { SupabaseClient } from '@supabase/supabase-js';
import { runMetric } from '@/lib/analytics/metrics/registry';
import { getAnomalySummary } from '@/lib/anomalies/notify';

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

function naira(amount: number) {
  return `₦${Math.round(amount).toLocaleString()}`;
}

export async function buildMorningBriefing(
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
  const businessDate = localDateString(timezone, now);
  const startOfDay = `${businessDate}T00:00:00`;
  const end = new Date(`${businessDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endOfDay = `${end.toISOString().slice(0, 10)}T00:00:00`;

  const [{ data: reservations, error: reservationsError }, { data: orders, error: ordersError }] = await Promise.all([
    admin
      .from('reservations')
      .select('id, status, confirmed_at')
      .eq('tenant_id', tenantId)
      .gte('start_at', startOfDay)
      .lt('start_at', endOfDay),
    admin
      .from('retail_orders')
      .select('id, status, payment_status, fulfillment_status')
      .eq('tenant_id', tenantId),
  ]);

  if (reservationsError) throw reservationsError;
  if (ordersError) throw ordersError;

  const lowStock = await runMetric(admin, tenantId, 'low_stock', {
    dimensions: ['product'],
    filters: { limit: 5 },
    aggregation: 'rank',
  });
  const outstanding = await runMetric(admin, tenantId, 'outstanding_total', {
    aggregation: 'sum',
  });
  const anomalySummary = await getAnomalySummary(admin, tenantId);

  const appointmentCount = (reservations ?? []).length;
  const unconfirmedCount = (reservations ?? []).filter((row) => !row.confirmed_at && row.status !== 'cancelled').length;
  const pendingOrders = (orders ?? []).filter((row) => ['draft', 'pending_payment'].includes(String(row.status ?? ''))).length;
  const expectedDeliveries = (orders ?? []).filter((row) => ['preparing', 'unfulfilled'].includes(String(row.fulfillment_status ?? ''))).length;
  const lowStockCount = lowStock.result.rows.length;
  const outstandingAmount = Number((outstanding.result.summary?.total_outstanding as number | undefined) ?? 0);

  if (
    appointmentCount === 0 &&
    unconfirmedCount === 0 &&
    pendingOrders === 0 &&
    expectedDeliveries === 0 &&
    lowStockCount === 0 &&
    outstandingAmount <= 0 &&
    anomalySummary.openCount <= 0
  ) {
    return null;
  }

  const body = [
    `🌅 *Morning Briefing — ${tenant?.name ?? 'your business'}*`,
    '',
    `Today’s appointments: ${appointmentCount}`,
    `Unconfirmed bookings: ${unconfirmedCount}`,
    `Pending orders: ${pendingOrders}`,
    `Expected deliveries: ${expectedDeliveries}`,
    `Low-stock products: ${lowStockCount}`,
    `Outstanding balances: ${naira(outstandingAmount)}`,
    `High-priority anomalies: ${anomalySummary.highSeverityCount + anomalySummary.criticalSeverityCount}`,
  ].join('\n');

  return {
    body,
    meta: {
      briefing_date: businessDate,
      appointment_count: appointmentCount,
      unconfirmed_count: unconfirmedCount,
      pending_orders: pendingOrders,
      expected_deliveries: expectedDeliveries,
      low_stock_count: lowStockCount,
      outstanding_amount: outstandingAmount,
      anomaly_count: anomalySummary.openCount,
    },
  };
}
