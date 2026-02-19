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
import { DollarSign, Calendar, Users, Star } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { DashboardMetric, BookingTrendData, StaffPerformanceData } from '@/types/analytics-api';
import { PERIOD_TO_STAFF_PERIOD, PERIOD_DAYS } from './shared/analytics-constants';

export interface OwnerMetricsProps {
  tenantId: string;
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

  const metricById = useMemo(() => {
    const map = new Map<string, DashboardMetric>();
    for (const metric of metrics) map.set(metric.id, metric);
    return map;
  }, [metrics]);

  const totalRevenue = metricById.get('total_revenue')?.value || 0;
  const totalBookings = metricById.get('total_bookings')?.value || 0;
  const activeCustomers = metricById.get('new_customers')?.value || 0;
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
          label="Active Customers"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AreaChart data={trends} dataKeys={['revenue']} title="Revenue Trend" description="Revenue from analytics API" colors={['#10b981']} formatValue={(v) => formatCurrency(v)} />
        <TrendChart data={trends} dataKey="bookings" title="Booking Trend" description="Bookings from analytics API" color="#3b82f6" showTrend />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PieChart
          data={bookingStatusData}
          title="Booking Status Breakdown"
          description="Status mix from backend analytics"
          showPercentage
          innerRadius={50}
        />
        <BarChart
          data={trends.map((entry) => ({ date: entry.date, cancellations: entry.cancellations || 0 }))}
          dataKeys={['cancellations']}
          xAxisKey="date"
          title="Cancellations"
          description="Cancellation trend from analytics API"
          colors={['#ef4444']}
        />
      </div>

      <PerformanceTable
        data={staffPerformance}
        title="Staff Performance"
        description="Top staff based on API data"
        columns={[
          { key: 'staff_name', label: 'Staff Member', sortable: true },
          { key: 'bookings_count', label: 'Bookings', sortable: true, align: 'right' },
          { key: 'revenue_total', label: 'Revenue', sortable: true, align: 'right', formatValue: (value) => formatCurrency(value) },
          { key: 'customer_rating', label: 'Rating', sortable: true, align: 'right', formatValue: (value) => Number(value || 0).toFixed(1) },
          { key: 'utilization_rate', label: 'Utilization', sortable: true, align: 'right', formatValue: (value) => `${Number(value || 0).toFixed(1)}%` },
        ]}
      />
    </div>
  );
}
