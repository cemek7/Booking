export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import AnalyticsService from '@/lib/analyticsService';
import { validateAnalyticsRequest } from '@/lib/unified-analytics-permissions';
import type { Role } from '@/types/roles';

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const tenantId = getVerifiedTenantId(ctx);
    const userRole = ctx.user?.role as Role;
    const userId = ctx.user?.id;

    const validation = validateAnalyticsRequest(userRole, 'tenant', tenantId, userId);
    if (!validation.allowed) {
      throw ApiErrorFactory.insufficientPermissions(['tenant']);
    }

    const analyticsService = new AnalyticsService(ctx.supabase);
    const result = await analyticsService.getBookingTrends(tenantId, days);

    if (!result.success) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to fetch booking trends'));
    }

    return {
      success: true,
      trends: result.trends,
      period_days: days,
      generated_at: new Date().toISOString(),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'superadmin'] }
);
