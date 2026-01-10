import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import AnalyticsService from '@/lib/analyticsService';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const period = (searchParams.get('period') as 'day' | 'week' | 'month' | 'quarter') || 'month';
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const analyticsService = new AnalyticsService(ctx.supabase);
    const result = await analyticsService.getDashboardMetrics(tenantId, period);

    if (!result.success) {
      throw ApiErrorFactory.internal(result.error || 'Failed to fetch dashboard metrics');
    }

    return {
      success: true,
      metrics: result.metrics,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true }
);