/**
 * Owner Analytics API
 * 
 * Provides comprehensive business analytics for business owners
 * All metrics are derived from database tables - no hardcoded values
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const QuerySchema = z.object({
  period: z.enum(['week', 'month', 'quarter', 'year']).default('month'),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const queryValidation = QuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!queryValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid query parameters');
    }

    const { period } = queryValidation.data;
    const tenantId = ctx.user.tenantId;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    // Previous period for trends
    const periodDuration = endDate.getTime() - startDate.getTime();
    const previousStart = new Date(startDate.getTime() - periodDuration);
    const previousEnd = new Date(startDate.getTime());

    // Fetch current and previous period data
    const [currentBookings, previousBookings] = await Promise.all([
      ctx.supabase
        .from('reservations')
        .select('id, status, customer_id, staff_id, service_id, start_at, metadata')
        .eq('tenant_id', tenantId)
        .gte('start_at', startDate.toISOString())
        .lte('start_at', endDate.toISOString()),
      ctx.supabase
        .from('reservations')
        .select('id, status')
        .eq('tenant_id', tenantId)
        .gte('start_at', previousStart.toISOString())
        .lte('start_at', previousEnd.toISOString()),
    ]);

    // Calculate metrics
    const totalBookings = currentBookings.data?.length || 0;
    const previousTotalBookings = previousBookings.data?.length || 0;

    const calculateTrend = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    return {
      success: true,
      data: {
        businessMetrics: {
          totalBookings,
        },
        trends: {
          bookings: Number(calculateTrend(totalBookings, previousTotalBookings).toFixed(1)),
        },
      },
    };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);
