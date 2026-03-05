'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import TrendChart from './charts/TrendChart';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import AreaChart from './charts/AreaChart';
import PerformanceTable from './shared/PerformanceTable';
import DataUnavailableState from './shared/DataUnavailableState';
import { DollarSign, Calendar, Users, Star, AlertTriangle, TrendingDown, BarChart2 } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { DashboardMetric, BookingTrendData, StaffPerformanceData } from '@/types/analytics-api';
import { PERIOD_TO_STAFF_PERIOD, PERIOD_DAYS } from './shared/analytics-constants';

export interface OwnerMetricsProps {
  tenantId: string;
}

interface AnalyticsData {
  businessMetrics: {
    totalRevenue: number;
    totalBookings: number;
    activeCustomers: number;
    averageRating: number;
    staffCount: number;
    utilizationRate: number;
  };
  trends: {
    revenue: number;
    bookings: number;
    customers: number;
    rating: number;
  };
  revenueData: Array<{ date: string; revenue: number; bookings: number }>;
  bookingStatus: Array<{ name: string; value: number; color: string }>;
  servicePerformanceData: Array<{ name: string; bookings: number; revenue: number }>;
  customerAcquisitionData: Array<{ date: string; new: number; returning: number }>;
  staffPerformanceData: Array<{ name: string; bookings: number; rating: number }>;
}

export default function OwnerMetrics({ tenantId }: OwnerMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');

  const { data: metrics = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['ownerMetrics', tenantId, period],
    queryFn: async () => {
      const res = await authFetch<{ metrics?: DashboardMetric[] }>(
        `/api/analytics/dashboard?period=${period === 'year' || period === 'custom' ? 'quarter' : period}`,
        { headers: { 'X-Tenant-ID': tenantId } }
      );
      return res.status === 200 ? res.data?.metrics || [] : [];
    },
    enabled: !!tenantId,
  });

  const { data: trends = [], isLoading: trendsLoading } = useQuery({
    queryKey: ['ownerTrends', tenantId, period],
    queryFn: async () => {
      const days = PERIOD_DAYS[period];
      const res = await authFetch<{ trends?: BookingTrendData[] }>(`/api/analytics/trends?days=${days}`, {
        headers: { 'X-Tenant-ID': tenantId },
      });
      return res.status === 200 ? res.data?.trends || [] : [];
    },
    enabled: !!tenantId,
  });

  const { data: staffPerformance = [], isLoading: staffLoading } = useQuery({
    queryKey: ['ownerStaff', tenantId, period],
    queryFn: async () => {
      const res = await authFetch<{ performance?: StaffPerformanceData[] }>(
        `/api/analytics/staff?period=${PERIOD_TO_STAFF_PERIOD[period]}`,
        { headers: { 'X-Tenant-ID': tenantId } }
      );
      return res.status === 200 ? res.data?.performance || [] : [];
    },
    enabled: !!tenantId,
  });

  const loading = metricsLoading || trendsLoading || staffLoading;
  const hasData = metrics.length > 0 || trends.length > 0 || staffPerformance.length > 0;

  // Revenue forecast (predictive analytics)
  const { data: forecastData } = useQuery({
    queryKey: ['ownerForecast', tenantId],
    queryFn: async () => {
      const res = await authFetch<{ forecast?: { forecast?: { next_month?: number; growth_rate?: number } } }>(
        '/api/analytics/forecast?horizon=monthly',
        { headers: { 'X-Tenant-ID': tenantId } }
      );
      return res.status === 200 ? res.data?.forecast?.forecast ?? null : null;
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 30, // forecast is expensive — cache 30 min
  });

  const metricById = useMemo(() => {
    const map = new Map<string, DashboardMetric>();
    for (const metric of metrics) map.set(metric.id, metric);
    return map;
  }, [metrics]);

  const totalRevenue = metricById.get('total_revenue')?.value || 0;
  const totalBookings = metricById.get('total_bookings')?.value || 0;
  const activeCustomers = metricById.get('new_customers')?.value || 0;
  const cancellationRate = metricById.get('cancellation_rate')?.value || 0;
  const noShowRate = metricById.get('no_show_rate')?.value || 0;
  const avgBookingValue = metricById.get('avg_booking_value')?.value || 0;
  const staffUtilization = metricById.get('staff_utilization')?.value || 0;

  const averageRating = staffPerformance.length
    ? staffPerformance.reduce((sum, row) => sum + (row.customer_rating || 0), 0) / staffPerformance.length
    : 0;

  const formatCurrency = (value: number | string) => `$${Number(value).toLocaleString()}`;

  const bookingStatusData = useMemo(() => {
    const totalBookingsCount = trends.reduce((sum, row) => sum + (row.bookings || 0), 0);
    const totalCancellations = trends.reduce((sum, row) => sum + (row.cancellations || 0), 0);
    const totalNoShows = trends.reduce((sum, row) => sum + (row.no_shows || 0), 0);
    const completed = Math.max(totalBookingsCount - totalCancellations - totalNoShows, 0);

    return [
      { name: 'Completed', value: completed, color: '#10b981' },
      { name: 'Cancelled', value: totalCancellations, color: '#ef4444' },
      { name: 'No Show', value: totalNoShows, color: '#f59e0b' },
    ].filter((item) => item.value > 0);
  }, [trends]);

  if (!loading && !hasData) {
    return (
      <DataUnavailableState
        title="Owner analytics"
        description="Data not available. Backend analytics data was not returned for this view."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <DateRangePicker period={period} onPeriodChange={setPeriod} compact className="w-64" />
      </div>

      {/* Primary KPIs */}
      <StatsGrid columns={4}>
        <MetricCard
          label="Total Revenue"
          value={totalRevenue}
          trend={metricById.get('total_revenue')?.trend}
          icon={DollarSign}
          formatValue={formatCurrency}
          colorScheme="success"
          loading={loading}
        />
        <MetricCard
          label="Total Bookings"
          value={totalBookings}
          trend={metricById.get('total_bookings')?.trend}
          icon={Calendar}
          colorScheme="info"
          loading={loading}
        />
        <MetricCard
          label="New Customers"
          value={activeCustomers}
          trend={metricById.get('new_customers')?.trend}
          icon={Users}
          loading={loading}
        />
        <MetricCard
          label="Average Rating"
          value={Number(averageRating.toFixed(1))}
          icon={Star}
          colorScheme="warning"
          loading={loading}
        />
      </StatsGrid>

      {/* Operational KPIs */}
      <StatsGrid columns={3}>
        <MetricCard
          label="Cancellation Rate"
          value={`${Number(cancellationRate || 0).toFixed(1)}%`}
          trend={metricById.get('cancellation_rate')?.trend}
          icon={AlertTriangle}
          colorScheme="default"
          loading={loading}
        />
        <MetricCard
          label="No-Show Rate"
          value={`${Number(noShowRate || 0).toFixed(1)}%`}
          trend={metricById.get('no_show_rate')?.trend}
          icon={TrendingDown}
          colorScheme="default"
          loading={loading}
        />
        <MetricCard
          label="Avg Booking Value"
          value={avgBookingValue}
          trend={metricById.get('avg_booking_value')?.trend}
          icon={BarChart2}
          formatValue={formatCurrency}
          colorScheme="info"
          loading={loading}
        />
      </StatsGrid>

      {/* Revenue Forecast (predictive analytics) */}
      {forecastData && (
        <StatsGrid columns={2}>
          <MetricCard
            label="Forecasted Next Month Revenue"
            value={forecastData.next_month ?? 0}
            formatValue={formatCurrency}
            icon={TrendingDown}
            colorScheme="success"
            loading={false}
          />
          <MetricCard
            label="Predicted Growth Rate"
            value={`${Number((forecastData.growth_rate ?? 0) * 100).toFixed(1)}%`}
            icon={BarChart2}
            colorScheme={((forecastData.growth_rate ?? 0) >= 0) ? 'success' : 'default'}
            loading={false}
          />
        </StatsGrid>
      )}

      {/* Revenue & Booking Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AreaChart data={trends} dataKeys={['revenue']} title="Revenue Trend" description="Revenue over time" colors={['#10b981']} formatValue={(v) => formatCurrency(v)} />
        <TrendChart data={trends} dataKey="bookings" title="Booking Trend" description="Bookings over time" color="#3b82f6" showTrend />
      </div>

      {/* Status Breakdown & Cancellation Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PieChart
          data={bookingStatusData}
          title="Booking Status Breakdown"
          description="Completed vs Cancelled vs No-Show"
          showPercentage
          innerRadius={50}
        />
        <BarChart
          data={trends.map((entry) => ({
            date: entry.date,
            cancellations: entry.cancellations || 0,
            no_shows: entry.no_shows || 0,
          }))}
          dataKeys={['cancellations', 'no_shows']}
          xAxisKey="date"
          title="Cancellations & No-Shows Over Time"
          description="Daily cancellation and no-show counts"
          colors={['#ef4444', '#f59e0b']}
        />
      </div>

      {/* Staff utilization summary */}
      <StatsGrid columns={2}>
        <MetricCard
          label="Staff Utilization"
          value={`${Number(staffUtilization || 0).toFixed(1)}%`}
          trend={metricById.get('staff_utilization')?.trend}
          icon={BarChart2}
          colorScheme="success"
          loading={loading}
        />
        <MetricCard
          label="Revenue per Booking"
          value={totalBookings > 0 ? totalRevenue / totalBookings : 0}
          icon={DollarSign}
          formatValue={formatCurrency}
          colorScheme="success"
          loading={loading}
        />
      </StatsGrid>

      {/* Staff Performance Table */}
      <PerformanceTable
        data={staffPerformance}
        title="Staff Performance"
        description="Individual staff performance for the period"
        columns={[
          { key: 'staff_name', label: 'Staff Member', sortable: true },
          { key: 'bookings_count', label: 'Bookings', sortable: true, align: 'right' },
          { key: 'revenue_total', label: 'Revenue', sortable: true, align: 'right', formatValue: (value) => formatCurrency(value) },
          { key: 'customer_rating', label: 'Rating', sortable: true, align: 'right', formatValue: (value) => Number(value || 0).toFixed(1) },
          { key: 'utilization_rate', label: 'Utilization', sortable: true, align: 'right', formatValue: (value) => `${Number(value || 0).toFixed(1)}%` },
          { key: 'tips_total', label: 'Tips', sortable: true, align: 'right', formatValue: (value) => formatCurrency(value) },
        ]}
      />
    </div>
  );
}
