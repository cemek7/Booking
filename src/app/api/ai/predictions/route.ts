export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { PredictiveAnalyticsEngine } from '@/lib/ai/predictiveAnalytics';

/**
 * GET /api/ai/predictions
 * Runs PredictiveAnalyticsEngine server-side (requires next/headers / server Supabase).
 * The client AIAnalyticsDashboard fetches from here instead of instantiating the engine directly.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const timeRange = ctx.request.nextUrl?.searchParams.get('timeRange') || 'monthly';

    const engine = new PredictiveAnalyticsEngine();

    const [revenue, customers, benchmark, insights] = await Promise.all([
      engine.generateRevenueForecast(tenantId, timeRange as any),
      engine.analyzeCustomerLifetimeValue(tenantId),
      engine.generatePerformanceBenchmarks(tenantId),
      engine.generatePredictiveInsights(tenantId),
    ]);

    return {
      revenue,
      customers: Array.isArray(customers) ? customers : [customers],
      benchmark,
      insights,
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
