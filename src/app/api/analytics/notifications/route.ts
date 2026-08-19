export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const { searchParams } = new URL(ctx.request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10), 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await ctx.supabase
      .from('scheduled_notifications')
      .select('trigger_type, status')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    if (error) {
      return { content_performance: [] };
    }

    const byType: Record<string, { sent: number; executed: number; cancelled: number }> = {};
    for (const row of data ?? []) {
      const type: string = row.trigger_type ?? 'unknown';
      if (!byType[type]) byType[type] = { sent: 0, executed: 0, cancelled: 0 };
      byType[type].sent += 1;
      if (row.status === 'executed') byType[type].executed += 1;
      if (row.status === 'cancelled') byType[type].cancelled += 1;
    }

    const content_performance = Object.entries(byType).map(([type, counts]) => ({
      type,
      sent: counts.sent,
      executed: counts.executed,
      pending: counts.sent - counts.executed - counts.cancelled,
      cancelled: counts.cancelled,
      execution_rate: counts.sent > 0 ? Number((counts.executed / counts.sent).toFixed(3)) : 0,
    }));

    return { content_performance, period_days: days };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] },
);
