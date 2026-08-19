export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import AnalyticsService from '@/lib/analyticsService';
import { validateAnalyticsRequest } from '@/lib/unified-analytics-permissions';
import type { Role } from '@/types/roles';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const vertical = searchParams.get('vertical') as 'beauty' | 'hospitality' | 'medicine';
    const tenantId = getVerifiedTenantId(ctx);
    const userRole = ctx.user?.role as Role;
    const userId = ctx.user?.id;

    const validation = validateAnalyticsRequest(userRole, 'tenant', tenantId, userId);
    if (!validation.allowed) {
      throw ApiErrorFactory.insufficientPermissions(['tenant']);
    }

    if (!vertical) {
      throw ApiErrorFactory.badRequest('vertical query parameter is required (e.g., beauty, hospitality)');
    }

    const analyticsService = new AnalyticsService(ctx.supabase);
    const result = await analyticsService.getVerticalAnalytics(tenantId, vertical);

    if (!result.success) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to fetch vertical analytics'));
    }

    return {
      success: true,
      analytics: result.analytics,
      vertical,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'superadmin'] }
);
