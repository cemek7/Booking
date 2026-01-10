/**
 * Manager Analytics API
 * 
 * Provides comprehensive analytics and insights for manager-level operations
 * including team performance, booking trends, revenue analysis, and operational metrics
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';
import {
  calculateDateRange,
  getOverviewAnalytics,
  getRevenueAnalytics,
  getTeamAnalytics,
  getBookingAnalytics,
  generateCustomReport,
  exportAnalyticsData,
  saveDashboardConfig,
} from '@/lib/services/manager-analytics-service';

const AnalyticsPeriodSchema = z.enum(['week', 'month', 'quarter', 'year']);
const AnalyticsMetricSchema = z.enum(['overview', 'revenue', 'team', 'bookings']);
const AnalyticsActionSchema = z.enum(['generate-report', 'export-data', 'save-dashboard']);

const GetAnalyticsQuerySchema = z.object({
  period: AnalyticsPeriodSchema.default('month'),
  metric: AnalyticsMetricSchema.default('overview'),
  staffId: z.string().optional(),
});

const PostAnalyticsBodySchema = z.object({
  action: AnalyticsActionSchema,
  data: z.any(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const queryValidation = GetAnalyticsQuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!queryValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid query parameters');
    }

    const { period, metric, staffId } = queryValidation.data;
    const dateRange = calculateDateRange(period);

    let result;
    switch (metric) {
      case 'overview':
        result = await getOverviewAnalytics(ctx.supabase, ctx.user, dateRange);
        break;
      case 'revenue':
        result = await getRevenueAnalytics(ctx.supabase, ctx.user, dateRange);
        break;
      case 'team':
        result = await getTeamAnalytics(ctx.supabase, ctx.user, dateRange, staffId || null);
        break;
      case 'bookings':
        result = await getBookingAnalytics(ctx.supabase, ctx.user, dateRange);
        break;
      default:
        result = await getOverviewAnalytics(ctx.supabase, ctx.user, dateRange);
    }

    return { success: true, ...result };
  },
  'GET',
  { auth: true, roles: ['manager', 'owner'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const bodyValidation = PostAnalyticsBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid request body');
    }

    const { action, data } = bodyValidation.data;

    let result;
    switch (action) {
      case 'generate-report':
        result = await generateCustomReport(ctx.supabase, ctx.user, data);
        break;
      case 'export-data':
        result = await exportAnalyticsData(ctx.supabase, ctx.user, data);
        break;
      case 'save-dashboard':
        result = await saveDashboardConfig(ctx.supabase, ctx.user, data);
        break;
      default:
        throw ApiErrorFactory.badRequest('Invalid analytics action');
    }

    return { success: true, ...result };
  },
  'POST',
  { auth: true, roles: ['manager', 'owner'] }
);