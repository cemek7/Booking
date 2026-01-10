import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import AnalyticsService from '@/lib/analyticsService';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const vertical = searchParams.get('vertical') as 'beauty' | 'hospitality' | 'medicine';
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    if (!vertical) {
      throw ApiErrorFactory.badRequest('vertical query parameter is required (e.g., beauty, hospitality)');
    }

    const analyticsService = new AnalyticsService(ctx.supabase);
    const result = await analyticsService.getVerticalAnalytics(tenantId, vertical);

    if (!result.success) {
      throw ApiErrorFactory.internal(result.error || 'Failed to fetch vertical analytics');
    }

    return {
      success: true,
      analytics: result.analytics,
      vertical,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true }
);
}