export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import AnalyticsService from '@/lib/analyticsService';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const period = (searchParams.get('period') as 'week' | 'month' | 'quarter') || 'month';
    const tenantId = getVerifiedTenantId(ctx);

    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const analyticsService = new AnalyticsService(ctx.supabase);
    const result = await analyticsService.getStaffPerformance(tenantId, period);

    if (!result.success) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to fetch staff performance data'));
    }

    return {
      success: true,
      performance: result.performance,
      period,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
