'use client';

import React, { useEffect, useState } from 'react';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import TrendChart from './charts/TrendChart';
import AreaChart from './charts/AreaChart';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import PerformanceTable from './shared/PerformanceTable';
import DataUnavailableState from './shared/DataUnavailableState';
import { Users, Calendar, Clock, TrendingUp, DollarSign, Star } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { ManagerOverviewMetrics, StaffPerformanceData, BookingTrendData } from '@/types/analytics-api';
import type { ManagerRevenueData, ManagerBookingData } from '@/lib/services/manager-analytics-service';
import { PERIOD_TO_STAFF_PERIOD } from './shared/analytics-constants';

export interface ManagerMetricsProps {
  tenantId: string;
  userId: string;
}

const PERIOD_TO_MANAGER_PERIOD: Record<TimePeriod, 'week' | 'month' | 'quarter' | 'year'> = {
  day: 'week',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
  custom: 'month',
};

export default function ManagerMetrics({ tenantId, userId }: ManagerMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<ManagerOverviewMetrics | null>(null);
  const [staffPerformance, setStaffPerformance] = useState<StaffPerformanceData[]>([]);
  const [trends, setTrends] = useState<BookingTrendData[]>([]);
  const [revenue, setRevenue] = useState<ManagerRevenueData | null>(null);
  const [bookingData, setBookingData] = useState<ManagerBookingData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const managerPeriod = PERIOD_TO_MANAGER_PERIOD[period];
        const staffPeriod = PERIOD_TO_STAFF_PERIOD[period];
        const headers = { 'X-Tenant-ID': tenantId, 'X-User-ID': userId };

        const [overviewRes, trendsRes, staffRes, revenueRes, bookingRes] = await Promise.all([
          authFetch<ManagerOverviewMetrics>(
            `/api/manager/analytics?metric=overview&period=${managerPeriod}`,
            { headers }
          ),
          authFetch<{ trends?: BookingTrendData[] }>(`/api/analytics/trends?days=30`, {
            headers: { 'X-Tenant-ID': tenantId },
          }),
          authFetch<{ success?: boolean; staffPerformance?: Array<{ staffId: string; staffName: string; bookings: number; completed: number; rating: number; utilization: number; revenue: number }> }>(
            `/api/manager/analytics?metric=team&period=${staffPeriod}`,
            { headers }
          ),
          authFetch<{ success?: boolean } & ManagerRevenueData>(
            `/api/manager/analytics?metric=revenue&period=${managerPeriod}`,
            { headers }
          ),
          authFetch<{ success?: boolean } & ManagerBookingData>(
            `/api/manager/analytics?metric=bookings&period=${managerPeriod}`,
            { headers }
          ),
        ]);

        if (cancelled) return;

        setOverview(overviewRes.status === 200 ? overviewRes.data || null : null);
        setTrends(trendsRes.status === 200 ? trendsRes.data?.trends || [] : []);

        const rawStaff = staffRes.status === 200 ? staffRes.data?.staffPerformance || [] : [];
        setStaffPerformance(
          rawStaff.map((s) => ({
            staff_id: s.staffId,
            staff_name: s.staffName,
            bookings_count: s.bookings,
            revenue_total: s.revenue,
            utilization_rate: s.utilization,
            customer_rating: s.rating,
            tips_total: 0,
          }))
        );

        setRevenue(revenueRes.status === 200 && revenueRes.data ? (revenueRes.data as unknown as ManagerRevenueData) : null);
        setBookingData(bookingRes.status === 200 && bookingRes.data ? (bookingRes.data as unknown as ManagerBookingData) : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (tenantId) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [period, tenantId, userId]);

  const hasData = Boolean(overview) || trends.length > 0 || staffPerformance.length > 0;
  const formatCurrency = (value: number | string) => `$${Number(value || 0).toLocaleString()}`;

  const bookingStatusData = bookingData?.bookingsByStatus
    ? [
        { name: 'Completed', value: bookingData.bookingsByStatus.completed || 0, color: '#10b981' },
        { name: 'Confirmed', value: bookingData.bookingsByStatus.confirmed || 0, color: '#3b82f6' },
        { name: 'Pending', value: bookingData.bookingsByStatus.pending || 0, color: '#f59e0b' },
        { name: 'Cancelled', value: bookingData.bookingsByStatus.cancelled || 0, color: '#ef4444' },
        { name: 'No Show', value: bookingData.bookingsByStatus.noShow || 0, color: '#6b7280' },
      ].filter((d) => d.value > 0)
    : [];

  if (!loading && !hasData) {
    return (
      <DataUnavailableState
        title="Manager analytics"
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
        <MetricCard label="Team Bookings" value={overview?.teamBookings || 0} trend={overview?.trends?.bookings ?? 0} icon={Calendar} colorScheme="info" loading={loading} />
        <MetricCard label="Team Revenue" value={overview?.teamRevenue || 0} trend={overview?.trends?.revenue ?? 0} icon={DollarSign} formatValue={formatCurrency} colorScheme="success" loading={loading} />
        <MetricCard label="Active Staff" value={overview?.activeStaff || 0} icon={Users} loading={loading} />
        <MetricCard label="Team Rating" value={Number((overview?.teamRating || 0).toFixed(1))} trend={overview?.trends?.rating ?? 0} icon={Star} colorScheme="warning" loading={loading} />
      </StatsGrid>

      {/* Operational KPIs */}
      <StatsGrid columns={2}>
        <MetricCard label="Schedule Utilization" value={`${(overview?.scheduleUtilization || 0).toFixed(1)}%`} icon={Clock} colorScheme="success" loading={loading} />
        <MetricCard label="Completion Rate" value={`${(overview?.completionRate || 0).toFixed(1)}%`} icon={TrendingUp} colorScheme="success" loading={loading} />
      </StatsGrid>

      {/* Booking & Revenue Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart data={trends} dataKey="bookings" title="Team Booking Trend" description="Bookings over time" color="#3b82f6" showTrend />
        <AreaChart
          data={revenue?.trends || []}
          dataKeys={['revenue']}
          title="Team Revenue Trend"
          description="Revenue over time for your team"
          colors={['#10b981']}
          formatValue={formatCurrency}
        />
      </div>

      {/* Booking Status Breakdown & Completion Ratio */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {bookingStatusData.length > 0 && (
          <PieChart
            data={bookingStatusData}
            title="Booking Status Breakdown"
            description="Team bookings by status"
            showPercentage
            innerRadius={50}
          />
        )}
        <PieChart
          data={[
            { name: 'Completed', value: Math.round(overview?.completionRate || 0), color: '#10b981' },
            { name: 'Remaining', value: Math.max(100 - Math.round(overview?.completionRate || 0), 0), color: '#e5e7eb' },
          ]}
          title="Completion Ratio"
          description="Team completion ratio"
          showPercentage
          innerRadius={50}
        />
      </div>

      {/* Staff Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChart
          data={staffPerformance.map((staff) => ({
            name: staff.staff_name,
            utilization: Number(staff.utilization_rate || 0),
          }))}
          dataKeys={['utilization']}
          xAxisKey="name"
          title="Staff Utilization"
          description="Utilization % by team member"
          colors={['#10b981']}
        />
        <BarChart
          data={(revenue?.revenueByStaff || []).map((s) => ({
            name: s.staffName,
            revenue: s.revenue,
            bookings: s.bookings,
          }))}
          dataKeys={['revenue', 'bookings']}
          xAxisKey="name"
          title="Revenue by Staff Member"
          description="Individual revenue contribution"
          colors={['#f59e0b', '#6366f1']}
        />
      </div>

      {/* Peak Hours */}
      {bookingData?.peakHours && bookingData.peakHours.length > 0 && (
        <BarChart
          data={bookingData.peakHours.map((h) => ({ hour: h.hour, bookings: h.bookings }))}
          dataKeys={['bookings']}
          xAxisKey="hour"
          title="Peak Booking Hours"
          description="When your team is busiest"
          colors={['#8b5cf6']}
        />
      )}

      {/* Full Team Performance Table */}
      <PerformanceTable
        data={staffPerformance}
        title="Team Performance"
        description="Individual performance metrics for your team"
        columns={[
          { key: 'staff_name', label: 'Staff Member', sortable: true },
          { key: 'bookings_count', label: 'Bookings', sortable: true, align: 'right' },
          { key: 'revenue_total', label: 'Revenue', sortable: true, align: 'right', formatValue: (value) => formatCurrency(value) },
          { key: 'utilization_rate', label: 'Utilization', sortable: true, align: 'right', formatValue: (value) => `${Number(value || 0).toFixed(1)}%` },
          { key: 'customer_rating', label: 'Rating', sortable: true, align: 'right', formatValue: (value) => Number(value || 0).toFixed(1) },
        ]}
      />
    </div>
  );
}
