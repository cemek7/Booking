export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getTenantCurrency } from '@/lib/tenant-currency';

type InsightPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

const getPeriodStart = (period: InsightPeriod) => {
  const now = new Date();
  const start = new Date(now);
  switch (period) {
    case 'day':
      start.setDate(start.getDate() - 1);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case 'quarter':
      start.setMonth(start.getMonth() - 3);
      break;
    case 'year':
      start.setFullYear(start.getFullYear() - 1);
      break;
    case 'month':
    default:
      start.setMonth(start.getMonth() - 1);
      break;
  }
  return start;
};

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const { searchParams } = new URL(ctx.request.url);
    const period = (searchParams.get('period') as InsightPeriod) || 'month';
    const start = getPeriodStart(period);

    const { data: reservations, error } = await ctx.supabase
      .from('reservations')
      .select('customer_id, customer_name, phone, created_at, metadata')
      .eq('tenant_id', tenantId)
      .gte('created_at', start.toISOString());

    if (error) {
      throw ApiErrorFactory.internalServerError(new Error(error.message));
    }

    const customerCounts = new Map<string, number>();
    const revenueBySource = { direct: 0, chat: 0, partner: 0 };

    for (const row of reservations || []) {
      const customerKey = String(row.customer_id || row.phone || row.customer_name || 'unknown');
      customerCounts.set(customerKey, (customerCounts.get(customerKey) || 0) + 1);

      const meta = ((row as Record<string, unknown>).metadata as Record<string, unknown> | undefined) || {};
      const revenue = Number(meta?.revenue || meta?.amount || 0);
      const sourceRaw = String(meta?.source || meta?.channel || meta?.origin || '').toLowerCase();

      let bucket: keyof typeof revenueBySource = 'direct';
      if (sourceRaw.includes('whatsapp') || sourceRaw.includes('chat') || sourceRaw.includes('sms')) {
        bucket = 'chat';
      } else if (sourceRaw.includes('partner') || sourceRaw.includes('platform') || sourceRaw.includes('marketplace')) {
        bucket = 'partner';
      }

      revenueBySource[bucket] += revenue;
    }

    const totalCustomers = customerCounts.size;
    let firstTime = 0;
    let returning = 0;
    let loyalty = 0;

    for (const count of customerCounts.values()) {
      if (count === 1) firstTime += 1;
      if (count >= 2) returning += 1;
      if (count >= 3) loyalty += 1;
    }

    const toPercent = (value: number, total: number) =>
      total > 0 ? Math.round((value / total) * 100) : 0;

    const totalRevenue = revenueBySource.direct + revenueBySource.chat + revenueBySource.partner;
    const currency = await getTenantCurrency(ctx.supabase, tenantId, 'USD');

    return {
      insights: {
        retention: {
          first_time: toPercent(firstTime, totalCustomers),
          returning: toPercent(returning, totalCustomers),
          loyalty: toPercent(loyalty, totalCustomers),
          total_customers: totalCustomers,
        },
        revenue_sources: {
          direct: totalRevenue > 0 ? Math.round((revenueBySource.direct / totalRevenue) * 100) : 0,
          chat: totalRevenue > 0 ? Math.round((revenueBySource.chat / totalRevenue) * 100) : 0,
          partner: totalRevenue > 0 ? Math.round((revenueBySource.partner / totalRevenue) * 100) : 0,
          total_revenue: totalRevenue,
        },
      },
      period,
      currency,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] },
);
