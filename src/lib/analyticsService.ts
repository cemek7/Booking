import { SupabaseClient } from '@supabase/supabase-js';
import { trace, metrics } from '@opentelemetry/api';

export interface AnalyticsMetric {
  id: string;
  name: string;
  value: number;
  trend: number; // Percentage change from previous period
  type: 'count' | 'percentage' | 'currency' | 'duration';
  period: string;
  last_updated: string;
}

export interface BookingTrendData {
  date: string;
  bookings: number;
  revenue: number;
  cancellations: number;
  no_shows: number;
}

export interface StaffPerformanceData {
  staff_id: string;
  staff_name: string;
  bookings_count: number;
  revenue_total: number;
  utilization_rate: number;
  customer_rating: number;
  tips_total: number;
}

export interface CustomerInsight {
  metric: string;
  value: number;
  change_from_previous: number;
  top_customers: Array<{
    customer_id: string;
    customer_name: string;
    total_bookings: number;
    total_spent: number;
    last_visit: string;
  }>;
}

export interface VerticalAnalytics {
  vertical: 'beauty' | 'hospitality' | 'medicine';
  metrics: {
    unique_metrics: Record<string, number>;
    conversion_funnels: Array<{
      step: string;
      count: number;
      conversion_rate: number;
    }>;
    retention_cohorts: Array<{
      cohort: string;
      period: number;
      retention_rate: number;
    }>;
  };
}

export class AnalyticsService {
  private supabase: SupabaseClient;
  private tracer = trace.getTracer('boka-analytics');
  private meter = metrics.getMeter('boka-analytics');

  // Metrics
  private analyticsQueriesCounter = this.meter.createCounter('analytics_queries_total', {
    description: 'Total analytics queries executed',
  });

  private queryDurationHistogram = this.meter.createHistogram('analytics_query_duration_ms', {
    description: 'Analytics query execution duration',
  });

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Get real-time dashboard metrics
   */
  async getDashboardMetrics(
    tenantId: string,
    period: 'day' | 'week' | 'month' | 'quarter' = 'month'
  ): Promise<{ success: boolean; metrics?: AnalyticsMetric[]; error?: string }> {
    const span = this.tracer.startSpan('analytics.dashboard_metrics');
    const startTime = Date.now();

    try {
      const dateRange = this.getDateRange(period);
      const previousRange = this.getPreviousDateRange(period);

      // Current period metrics
      const [
        currentBookings,
        currentRevenue,
        currentCancellations,
        currentNoShows,
        currentNewCustomers,
        currentUtilization,
        previousBookings,
        previousRevenue,
        avgBookingValue
      ] = await Promise.all([
        this.getBookingsCount(tenantId, dateRange.start, dateRange.end),
        this.getTotalRevenue(tenantId, dateRange.start, dateRange.end),
        this.getCancellationsCount(tenantId, dateRange.start, dateRange.end),
        this.getNoShowsCount(tenantId, dateRange.start, dateRange.end),
        this.getNewCustomersCount(tenantId, dateRange.start, dateRange.end),
        this.getStaffUtilization(tenantId, dateRange.start, dateRange.end),
        this.getBookingsCount(tenantId, previousRange.start, previousRange.end),
        this.getTotalRevenue(tenantId, previousRange.start, previousRange.end),
        this.getAverageBookingValue(tenantId, dateRange.start, dateRange.end)
      ]);

      const metrics: AnalyticsMetric[] = [
        {
          id: 'total_bookings',
          name: 'Total Bookings',
          value: currentBookings,
          trend: this.calculateTrend(currentBookings, previousBookings),
          type: 'count',
          period,
          last_updated: new Date().toISOString(),
        },
        {
          id: 'total_revenue',
          name: 'Total Revenue',
          value: currentRevenue,
          trend: this.calculateTrend(currentRevenue, previousRevenue),
          type: 'currency',
          period,
          last_updated: new Date().toISOString(),
        },
        {
          id: 'cancellation_rate',
          name: 'Cancellation Rate',
          value: currentBookings > 0 ? (currentCancellations / currentBookings) * 100 : 0,
          trend: 0, // Calculate separately if needed
          type: 'percentage',
          period,
          last_updated: new Date().toISOString(),
        },
        {
          id: 'no_show_rate',
          name: 'No-Show Rate',
          value: currentBookings > 0 ? (currentNoShows / currentBookings) * 100 : 0,
          trend: 0,
          type: 'percentage',
          period,
          last_updated: new Date().toISOString(),
        },
        {
          id: 'new_customers',
          name: 'New Customers',
          value: currentNewCustomers,
          trend: 0,
          type: 'count',
          period,
          last_updated: new Date().toISOString(),
        },
        {
          id: 'staff_utilization',
          name: 'Staff Utilization',
          value: currentUtilization,
          trend: 0,
          type: 'percentage',
          period,
          last_updated: new Date().toISOString(),
        },
        {
          id: 'avg_booking_value',
          name: 'Average Booking Value',
          value: avgBookingValue,
          trend: 0,
          type: 'currency',
          period,
          last_updated: new Date().toISOString(),
        },
      ];

      span.setAttribute('metrics.count', metrics.length);
      this.analyticsQueriesCounter.add(1, { query_type: 'dashboard_metrics' });

      return { success: true, metrics };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      const duration = Date.now() - startTime;
      this.queryDurationHistogram.record(duration, { query_type: 'dashboard_metrics' });
      span.end();
    }
  }

  /**
   * Get booking trends over time
   */
  async getBookingTrends(
    tenantId: string,
    days: number = 30
  ): Promise<{ success: boolean; trends?: BookingTrendData[]; error?: string }> {
    const span = this.tracer.startSpan('analytics.booking_trends');

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data: trends, error } = await this.supabase
        .from('reservations')
        .select(`
          start_at,
          status,
          metadata
        `)
        .eq('tenant_id', tenantId)
        .gte('start_at', startDate.toISOString())
        .lte('start_at', endDate.toISOString())
        .order('start_at', { ascending: true });

      if (error) throw error;

      // Group by date and aggregate metrics
      const trendMap = new Map<string, BookingTrendData>();

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dateKey = date.toISOString().split('T')[0];
        
        trendMap.set(dateKey, {
          date: dateKey,
          bookings: 0,
          revenue: 0,
          cancellations: 0,
          no_shows: 0,
        });
      }

      // Aggregate actual data
      (trends || []).forEach(reservation => {
        const dateKey = new Date(reservation.start_at).toISOString().split('T')[0];
        const trend = trendMap.get(dateKey);
        
        if (trend) {
          trend.bookings++;
          
          if (reservation.status === 'cancelled') {
            trend.cancellations++;
          } else if (reservation.status === 'no_show') {
            trend.no_shows++;
          }
          
          // Add revenue if available in metadata
          const revenue = reservation.metadata?.revenue || 0;
          trend.revenue += Number(revenue);
        }
      });

      const trendsArray = Array.from(trendMap.values()).sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      this.analyticsQueriesCounter.add(1, { query_type: 'booking_trends' });
      return { success: true, trends: trendsArray };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Get staff performance analytics
   */
  async getStaffPerformance(
    tenantId: string,
    period: 'week' | 'month' | 'quarter' = 'month'
  ): Promise<{ success: boolean; performance?: StaffPerformanceData[]; error?: string }> {
    const span = this.tracer.startSpan('analytics.staff_performance');

    try {
      const dateRange = this.getDateRange(period);

      const { data: staffData, error } = await this.supabase
        .from('staff')
        .select(`
          id,
          name,
          reservations!inner(
            id,
            start_at,
            status,
            metadata
          )
        `)
        .eq('tenant_id', tenantId)
        .gte('reservations.start_at', dateRange.start.toISOString())
        .lte('reservations.start_at', dateRange.end.toISOString());

      if (error) throw error;

      const performanceData: StaffPerformanceData[] = (staffData || []).map(staff => {
        const reservations = staff.reservations || [];
        const completedBookings = reservations.filter(r => r.status === 'completed').length;
        const totalRevenue = reservations.reduce((sum, r) => sum + (r.metadata?.revenue || 0), 0);
        const totalTips = reservations.reduce((sum, r) => sum + (r.metadata?.tip || 0), 0);

        // Calculate utilization (simplified - would need working hours data)
        const totalHoursInPeriod = this.getWorkingHoursInPeriod(period);
        const bookedHours = reservations.length * 1; // Assuming 1 hour per booking
        const utilizationRate = totalHoursInPeriod > 0 ? (bookedHours / totalHoursInPeriod) * 100 : 0;

        return {
          staff_id: staff.id,
          staff_name: staff.name,
          bookings_count: completedBookings,
          revenue_total: Number(totalRevenue),
          utilization_rate: Math.min(utilizationRate, 100),
          customer_rating: 4.5, // Mock rating - would come from reviews
          tips_total: Number(totalTips),
        };
      });

      this.analyticsQueriesCounter.add(1, { query_type: 'staff_performance' });
      return { success: true, performance: performanceData };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Get customer insights and top customers
   */
  async getCustomerInsights(
    tenantId: string,
    period: 'month' | 'quarter' | 'year' = 'month'
  ): Promise<{ success: boolean; insights?: CustomerInsight; error?: string }> {
    const span = this.tracer.startSpan('analytics.customer_insights');

    try {
      const dateRange = this.getDateRange(period);

      // Get top customers
      const { data: topCustomers, error } = await this.supabase
        .from('customers')
        .select(`
          id,
          customer_name,
          reservations!inner(
            id,
            start_at,
            metadata,
            created_at
          )
        `)
        .eq('tenant_id', tenantId)
        .gte('reservations.start_at', dateRange.start.toISOString())
        .lte('reservations.start_at', dateRange.end.toISOString());

      if (error) throw error;

      // Aggregate customer data
      const customerMap = new Map();

      (topCustomers || []).forEach(customer => {
        const customerId = customer.id;
        const reservations = customer.reservations || [];
        
        if (!customerMap.has(customerId)) {
          customerMap.set(customerId, {
            customer_id: customerId,
            customer_name: customer.customer_name,
            total_bookings: 0,
            total_spent: 0,
            last_visit: '',
          });
        }

        const customerData = customerMap.get(customerId);
        customerData.total_bookings = reservations.length;
        customerData.total_spent = reservations.reduce((sum, r) => sum + (r.metadata?.revenue || 0), 0);
        customerData.last_visit = reservations
          .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())[0]?.start_at || '';
      });

      // Sort by total spent and get top 10
      const topCustomersList = Array.from(customerMap.values())
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, 10);

      const insights: CustomerInsight = {
        metric: 'customer_insights',
        value: customerMap.size, // Total unique customers
        change_from_previous: 0, // Would calculate from previous period
        top_customers: topCustomersList,
      };

      this.analyticsQueriesCounter.add(1, { query_type: 'customer_insights' });
      return { success: true, insights };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Get vertical-specific analytics (Beauty, Hospitality, Medicine)
   */
  async getVerticalAnalytics(
    tenantId: string,
    vertical: 'beauty' | 'hospitality' | 'medicine'
  ): Promise<{ success: boolean; analytics?: VerticalAnalytics; error?: string }> {
    const span = this.tracer.startSpan('analytics.vertical_analytics');

    try {
      // Get tenant's vertical configuration
      await this.supabase
        .from('tenants')
        .select('metadata')
        .eq('id', tenantId)
        .single();

      // const verticalConfig = tenantConfig?.metadata?.vertical_config || {}; // Future use for vertical-specific logic

      let uniqueMetrics: Record<string, number> = {};

      switch (vertical) {
        case 'beauty':
          uniqueMetrics = await this.getBeautyMetrics();
          break;
        case 'hospitality':
          uniqueMetrics = await this.getHospitalityMetrics();
          break;
        case 'medicine':
          uniqueMetrics = await this.getMedicineMetrics();
          break;
      }

      // Mock conversion funnel data - would be calculated from actual user journey
      const conversionFunnels = [
        { step: 'Website Visit', count: 1000, conversion_rate: 100 },
        { step: 'Chat Started', count: 500, conversion_rate: 50 },
        { step: 'Service Selected', count: 300, conversion_rate: 60 },
        { step: 'Booking Completed', count: 200, conversion_rate: 67 },
        { step: 'Payment Made', count: 180, conversion_rate: 90 },
      ];

      // Mock retention cohorts - would be calculated from customer behavior
      const retentionCohorts = [
        { cohort: '2024-01', period: 1, retention_rate: 85 },
        { cohort: '2024-01', period: 2, retention_rate: 65 },
        { cohort: '2024-01', period: 3, retention_rate: 45 },
        { cohort: '2024-02', period: 1, retention_rate: 88 },
        { cohort: '2024-02', period: 2, retention_rate: 70 },
      ];

      const analytics: VerticalAnalytics = {
        vertical,
        metrics: {
          unique_metrics: uniqueMetrics,
          conversion_funnels: conversionFunnels,
          retention_cohorts: retentionCohorts,
        },
      };

      this.analyticsQueriesCounter.add(1, { query_type: 'vertical_analytics' });
      return { success: true, analytics };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  // Helper methods
  private getDateRange(period: string) {
    const end = new Date();
    const start = new Date();
    
    switch (period) {
      case 'day':
        start.setDate(start.getDate() - 1);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(start.getMonth() - 3);
        break;
    }
    
    return { start, end };
  }

  private getPreviousDateRange(period: string) {
    const currentRange = this.getDateRange(period);
    const duration = currentRange.end.getTime() - currentRange.start.getTime();
    
    return {
      start: new Date(currentRange.start.getTime() - duration),
      end: new Date(currentRange.start.getTime()),
    };
  }

  private calculateTrend(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  private async getBookingsCount(tenantId: string, start: Date, end: Date): Promise<number> {
    const { count } = await this.supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('start_at', start.toISOString())
      .lte('start_at', end.toISOString());
    
    return count || 0;
  }

  private async getTotalRevenue(tenantId: string, start: Date, end: Date): Promise<number> {
    const { data } = await this.supabase
      .from('transactions')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString());

    return (data || []).reduce((sum, t) => sum + Number(t.amount), 0);
  }

  private async getCancellationsCount(tenantId: string, start: Date, end: Date): Promise<number> {
    const { count } = await this.supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'cancelled')
      .gte('start_at', start.toISOString())
      .lte('start_at', end.toISOString());
    
    return count || 0;
  }

  private async getNoShowsCount(tenantId: string, start: Date, end: Date): Promise<number> {
    const { count } = await this.supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'no_show')
      .gte('start_at', start.toISOString())
      .lte('start_at', end.toISOString());
    
    return count || 0;
  }

  private async getNewCustomersCount(tenantId: string, start: Date, end: Date): Promise<number> {
    const { count } = await this.supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString());
    
    return count || 0;
  }

  private async getStaffUtilization(tenantId: string, start: Date, end: Date): Promise<number> {
    // Simplified calculation - would need actual working hours data
    const totalBookings = await this.getBookingsCount(tenantId, start, end);
    const { count: staffCount } = await this.supabase
      .from('staff')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if (!staffCount) return 0;
    
    const workingDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const maxBookings = staffCount * workingDays * 8; // 8 hours per day
    
    return maxBookings > 0 ? (totalBookings / maxBookings) * 100 : 0;
  }

  private async getAverageBookingValue(tenantId: string, start: Date, end: Date): Promise<number> {
    const totalRevenue = await this.getTotalRevenue(tenantId, start, end);
    const totalBookings = await this.getBookingsCount(tenantId, start, end);
    
    return totalBookings > 0 ? totalRevenue / totalBookings : 0;
  }

  private getWorkingHoursInPeriod(period: string): number {
    switch (period) {
      case 'week': return 40; // 5 days * 8 hours
      case 'month': return 160; // ~20 working days * 8 hours
      case 'quarter': return 480; // ~60 working days * 8 hours
      default: return 40;
    }
  }

  private async getBeautyMetrics(): Promise<Record<string, number>> {
    // Beauty-specific metrics
    return {
      stylist_utilization: 75,
      product_upsells: 45,
      loyalty_redemptions: 23,
      before_after_uploads: 67,
      rebooking_rate: 82,
    };
  }

  private async getHospitalityMetrics(): Promise<Record<string, number>> {
    // Hospitality-specific metrics
    return {
      adr_lift: 15, // Average Daily Rate lift from upsells
      group_booking_rate: 25,
      special_requests: 45,
      guest_satisfaction: 4.7,
      package_attach_rate: 35,
    };
  }

  private async getMedicineMetrics(): Promise<Record<string, number>> {
    // Medicine-specific metrics (non-sensitive)
    return {
      appointment_compliance: 95,
      follow_up_scheduled: 78,
      test_turnaround_time: 24, // hours
      digital_results_delivery: 92,
      patient_satisfaction: 4.6,
    };
  }
}

export default AnalyticsService;