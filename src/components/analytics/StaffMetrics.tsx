'use client';

import React, { useEffect, useMemo, useState } from 'react';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import PerformanceTable from './shared/PerformanceTable';
import DataUnavailableState from './shared/DataUnavailableState';
import { Calendar, DollarSign, Star, TrendingUp, Activity, Clock } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { StaffMemberMetric } from '@/types/analytics-api';
import { PERIOD_DAYS } from './shared/analytics-constants';

export interface StaffMetricsProps {
  userId: string;
  tenantId: string;
}

export default function StaffMetrics({ userId, tenantId }: StaffMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [loading, setLoading] = useState(true);
  const [staffMetrics, setStaffMetrics] = useState<StaffMemberMetric[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const metricsRes = await authFetch<{ metrics?: StaffMemberMetric[] }>(
          `/api/staff/metrics?days=${PERIOD_DAYS[period]}`,
          { headers: { 'X-Tenant-ID': tenantId } }
        );

        if (cancelled) return;
        setStaffMetrics(metricsRes.status === 200 ? metricsRes.data?.metrics || [] : []);
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
  }, [tenantId, period]);

  const currentUserMetrics = useMemo(
    () => staffMetrics.find((row) => row.user_id === userId) || null,
    [staffMetrics, userId]
  );

  const completionShare = useMemo(() => {
    const total = Math.max(1, staffMetrics.reduce((sum, row) => sum + (row.completed || 0), 0));
    const completed = currentUserMetrics?.completed || 0;
    const percent = Math.min(100, (completed / total) * 100);
    return `${percent.toFixed(1)}%`;
  }, [staffMetrics, currentUserMetrics]);

  const sortedStaffMetrics = useMemo(
    () => [...staffMetrics].sort((a, b) => b.completed - a.completed),
    [staffMetrics]
  );

  const hasData = Boolean(currentUserMetrics) || staffMetrics.length > 0;

  if (!loading && !hasData) {
    return (
      <DataUnavailableState
        title="Staff analytics"
        description="Data not available. Backend analytics data was not returned for this view."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <DateRangePicker period={period} onPeriodChange={setPeriod} compact className="w-64" />
      </div>

      {/* Personal KPIs */}
      <StatsGrid columns={4}>
        <MetricCard label="My Completed Bookings" value={currentUserMetrics?.completed || 0} icon={Calendar} colorScheme="info" loading={loading} />
        <MetricCard label="My Revenue" value={currentUserMetrics?.revenue || 0} icon={DollarSign} colorScheme="success" loading={loading} formatValue={(v) => `$${Number(v).toLocaleString()}`} />
        <MetricCard label="My Tips" value={currentUserMetrics?.tips_total || 0} icon={DollarSign} colorScheme="success" loading={loading} formatValue={(v) => `$${Number(v).toLocaleString()}`} />
        <MetricCard label="My Rating" value={currentUserMetrics?.rating ?? '—'} icon={Star} colorScheme="warning" loading={loading} />
      </StatsGrid>

      <StatsGrid columns={3}>
        <MetricCard label="My Utilization" value={`${(currentUserMetrics?.utilization_rate || 0).toFixed(1)}%`} icon={Activity} colorScheme="info" loading={loading} />
        <MetricCard label="Avg Service Time" value={currentUserMetrics?.avg_service_duration_min ? `${currentUserMetrics.avg_service_duration_min.toFixed(0)}m` : '—'} icon={Clock} colorScheme="default" loading={loading} />
        <MetricCard
          label="Completion Share"
          value={completionShare}
          icon={TrendingUp}
          colorScheme="default"
          loading={loading}
        />
      </StatsGrid>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PieChart
          data={[
            { name: 'My Completed', value: currentUserMetrics?.completed || 0, color: '#10b981' },
            { name: 'Others', value: Math.max(staffMetrics.reduce((sum, row) => sum + row.completed, 0) - (currentUserMetrics?.completed || 0), 0), color: '#93c5fd' },
          ]}
          title="My Completion Contribution"
          description="My completed bookings vs team"
          showPercentage
          innerRadius={50}
        />

        <BarChart
          data={sortedStaffMetrics.slice(0, 10).map((row) => ({
            user: row.user_id.slice(0, 8),
            completed: row.completed,
          }))}
          dataKeys={['completed']}
          xAxisKey="user"
          title="Completed Bookings by Staff"
          description="Top staff completion counts (30d)"
          colors={['#10b981']}
        />
      </div>

      {/* Staff Utilization Comparison */}
      <BarChart
        data={sortedStaffMetrics.slice(0, 10).map((row) => ({
          user: row.user_id.slice(0, 8),
          utilization: row.utilization_rate || 0,
          revenue: row.revenue || 0,
          tips: row.tips_total || 0,
        }))}
        dataKeys={['utilization', 'revenue', 'tips']}
        xAxisKey="user"
        title="Staff Utilization, Revenue & Tips (Top 10)"
        description="Utilization %, revenue, and tips per staff member"
        colors={['#6366f1', '#f59e0b', '#10b981']}
      />

      <PerformanceTable
        data={sortedStaffMetrics}
        title="Team Performance Breakdown"
        description="All staff members — selected period"
        columns={[
          { key: 'user_id', label: 'Staff ID', sortable: true, formatValue: (v) => String(v).slice(0, 8) },
          { key: 'completed', label: 'Completed', sortable: true, align: 'right' },
          { key: 'revenue', label: 'Revenue', sortable: true, align: 'right', formatValue: (v) => `$${Number(v || 0).toLocaleString()}` },
          { key: 'tips_total', label: 'Tips', sortable: true, align: 'right', formatValue: (v) => `$${Number(v || 0).toLocaleString()}` },
          { key: 'utilization_rate', label: 'Utilization', sortable: true, align: 'right', formatValue: (v) => `${Number(v || 0).toFixed(1)}%` },
          { key: 'avg_service_duration_min', label: 'Avg Time', sortable: true, align: 'right', formatValue: (v) => v ? `${Number(v).toFixed(0)}m` : '—' },
          { key: 'rating', label: 'Rating', sortable: true, align: 'right', formatValue: (v) => v != null ? Number(v).toFixed(1) : '—' },
        ]}
      />
    </div>
  );
}
