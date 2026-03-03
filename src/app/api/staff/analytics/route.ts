/**
 * Staff Analytics API
 * 
 * Provides personal performance metrics for staff members
 * Staff can only view their own data
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
    const staffId = ctx.user.id;
    const tenantId = ctx.user.tenantId;

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

    const { data: bookings } = await ctx.supabase
      .from('reservations')
      .select('id, status, start_at, metadata')
      .eq('tenant_id', tenantId)
      .eq('staff_id', staffId)
      .gte('start_at', startDate.toISOString())
      .lte('start_at', endDate.toISOString());

    const { data: staffRating } = await ctx.supabase
      .from('staff_ratings')
      .select('average_rating, total_reviews')
      .eq('tenant_id', tenantId)
      .eq('staff_id', staffId)
      .gte('period_start', startDate.toISOString().split('T')[0])
      .lte('period_end', endDate.toISOString().split('T')[0])
      .single();

    const { data: transactions } = await ctx.supabase
      .from('transactions')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    const totalBookings = bookings?.length || 0;
    const completedBookings = bookings?.filter(b => b.status === 'completed').length || 0;
    const completionRate = totalBookings > 0 ? (completedBookings / totalBookings) * 100 : 0;
    const totalEarnings = (transactions || []).reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      success: true,
      data: {
        personalMetrics: {
          myBookings: totalBookings,
          myEarnings: totalEarnings,
          myRating: staffRating?.average_rating || 0,
          completionRate: Number(completionRate.toFixed(1)),
          repeatCustomers: 0,
          hoursWorked: totalBookings,
        },
        trends: {
          bookings: 0,
          earnings: 0,
          rating: 0,
        },
      },
    };
  },
  'GET',
  { auth: true, roles: ['staff', 'manager', 'owner'] }
);
