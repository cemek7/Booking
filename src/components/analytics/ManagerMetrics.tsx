'use client';

import React, { useEffect, useState } from 'react';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import TrendChart from './charts/TrendChart';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import PerformanceTable from './shared/PerformanceTable';
import DataUnavailableState from './shared/DataUnavailableState';
import { Users, Calendar, Clock, TrendingUp } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { ManagerOverviewMetrics, StaffPerformanceData, BookingTrendData } from '@/types/analytics-api';

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

const PERIOD_TO_STAFF_PERIOD: Record<TimePeriod, 'week' | 'month' | 'quarter'> = {
  day: 'week',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'quarter',
  custom: 'month',
};

export default function ManagerMetrics({ tenantId }: ManagerMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<ManagerOverviewMetrics | null>(null);
  const [staffPerformance, setStaffPerformance] = useState<StaffPerformanceData[]>([]);
  const [trends, setTrends] = useState<BookingTrendData[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const overviewRes = await authFetch<ManagerOverviewMetrics>(
          `/api/manager/analytics?metric=overview&period=${PERIOD_TO_MANAGER_PERIOD[period]}`,
          { headers: { 'X-Tenant-ID': tenantId } }
        );
        const trendsRes = await authFetch<{ trends?: BookingTrendData[] }>('/api/analytics/trends?days=30', {
          headers: { 'X-Tenant-ID': tenantId },
        });
        const staffRes = await authFetch<{ performance?: StaffPerformanceData[] }>(
          `/api/analytics/staff?period=${PERIOD_TO_STAFF_PERIOD[period]}`,
          { headers: { 'X-Tenant-ID': tenantId } }
        );

        if (cancelled) return;

        setOverview(overviewRes.status === 200 ? overviewRes.data || null : null);
        setTrends(trendsRes.status === 200 ? trendsRes.data?.trends || [] : []);
        setStaffPerformance(staffRes.status === 200 ? staffRes.data?.performance || [] : []);
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
  }, [period, tenantId]);

  const hasData = Boolean(overview) || trends.length > 0 || staffPerformance.length > 0;

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

      <StatsGrid columns={4}>
        <MetricCard label="Team Bookings" value={overview?.teamBookings || 0} trend={overview?.trends?.bookings ?? 0} icon={Calendar} colorScheme="info" loading={loading} />
        <MetricCard label="Active Staff" value={overview?.activeStaff || 0} icon={Users} loading={loading} />
        <MetricCard label="Schedule Utilization" value={`${(overview?.scheduleUtilization || 0).toFixed(1)}%`} icon={Clock} colorScheme="success" loading={loading} />
        <MetricCard label="Completion Rate" value={`${(overview?.completionRate || 0).toFixed(1)}%`} icon={TrendingUp} colorScheme="success" loading={loading} />
      </StatsGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart data={trends} dataKey="bookings" title="Team Booking Trend" description="Bookings from analytics API" color="#3b82f6" showTrend />

        <PieChart
          data={[
            { name: 'Completed', value: Math.round((overview?.completionRate || 0) * 10), color: '#10b981' },
            { name: 'Remaining', value: Math.max(1000 - Math.round((overview?.completionRate || 0) * 10), 0), color: '#e5e7eb' },
          ]}
          title="Completion Ratio"
          description="Team completion ratio"
          showPercentage
          innerRadius={50}
        />
        <BarChart
          data={staffPerformance.map((staff) => ({
            name: staff.staff_name,
            utilization: Number(staff.utilization_rate || 0),
          }))}
          dataKeys={['utilization']}
          xAxisKey="name"
          title="Staff Utilization"
          description="Utilization by team member"
          colors={['#10b981']}
        />
      </div>

      <PerformanceTable
        data={staffPerformance}
        title="Team Performance"
        description="Individual performance metrics for your team"
        columns={[
          { key: 'staff_name', label: 'Staff Member', sortable: true },
          { key: 'bookings_count', label: 'Bookings', sortable: true, align: 'right' },
          { key: 'utilization_rate', label: 'Utilization', sortable: true, align: 'right', formatValue: (value) => `${Number(value || 0).toFixed(1)}%` },
          { key: 'customer_rating', label: 'Rating', sortable: true, align: 'right', formatValue: (value) => Number(value || 0).toFixed(1) },
        ]}
      />
    </div>
  );
}
