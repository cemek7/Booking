import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { PredictiveAnalyticsEngine } from '@/lib/ai/predictiveAnalytics';

/**
 * GET /api/analytics/forecast?horizon=monthly|quarterly|yearly&seasonality=true
 * Returns a revenue forecast for the authenticated tenant using the predictive analytics engine.
 * Accessed by owner analytics dashboards.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const horizon = (searchParams.get('horizon') as 'monthly' | 'quarterly' | 'yearly') || 'monthly';
    const includeSeasonality = searchParams.get('seasonality') !== 'false';

    const engine = new PredictiveAnalyticsEngine();
    const forecast = await engine.generateRevenueForecast(tenantId, horizon, {
      includeSeasonality,
    });

    return {
      success: true,
      tenantId,
      horizon,
      forecast,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
