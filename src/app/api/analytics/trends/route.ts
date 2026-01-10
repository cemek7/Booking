import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import AnalyticsService from '@/lib/analyticsService';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const analyticsService = new AnalyticsService(ctx.supabase);
    const result = await analyticsService.getBookingTrends(tenantId, days);

    if (!result.success) {
      throw ApiErrorFactory.internal(result.error || 'Failed to fetch booking trends');
    }

    return {
      success: true,
      trends: result.trends,
      period_days: days,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true }
);