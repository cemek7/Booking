'use client';

import React, { useEffect, useMemo, useState } from 'react';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import TrendChart from './charts/TrendChart';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import DataUnavailableState from './shared/DataUnavailableState';
import { Calendar, DollarSign, Star, TrendingUp } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { StaffMemberMetric, BookingTrendData } from '@/types/analytics-api';

export interface StaffMetricsProps {
  userId: string;
  tenantId: string;
}

export default function StaffMetrics({ userId, tenantId }: StaffMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [loading, setLoading] = useState(true);
  const [staffMetrics, setStaffMetrics] = useState<StaffMemberMetric[]>([]);
  const [trends, setTrends] = useState<BookingTrendData[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const metricsRes = await authFetch<{ metrics?: StaffMemberMetric[] }>(
          `/api/staff/metrics?tenant_id=${encodeURIComponent(tenantId)}`,
          { headers: { 'X-Tenant-ID': tenantId } }
        );

        const trendsRes = await authFetch<{ trends?: BookingTrendData[] }>('/api/analytics/trends?days=30', {
          headers: { 'X-Tenant-ID': tenantId },
        });

        if (cancelled) return;
        setStaffMetrics(metricsRes.status === 200 ? metricsRes.data?.metrics || [] : []);
        setTrends(trendsRes.status === 200 ? trendsRes.data?.trends || [] : []);
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

  const hasData = Boolean(currentUserMetrics) || trends.length > 0;

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

      <StatsGrid columns={4}>
        <MetricCard label="My Completed Bookings" value={currentUserMetrics?.completed || 0} icon={Calendar} colorScheme="info" loading={loading} />
        <MetricCard label="My Revenue" value={currentUserMetrics?.revenue || 0} icon={DollarSign} colorScheme="success" loading={loading} formatValue={(v) => `$${Number(v).toLocaleString()}`} />
        <MetricCard label="My Rating" value={currentUserMetrics?.rating || 0} icon={Star} colorScheme="warning" loading={loading} />
        <MetricCard
          label="Completion Share"
          value={`${trends.length ? Math.min(100, ((currentUserMetrics?.completed || 0) / Math.max(1, trends.reduce((sum, row) => sum + (row.bookings || 0), 0))) * 100).toFixed(1) : '0.0'}%`}
          icon={TrendingUp}
          colorScheme="default"
          loading={loading}
        />
      </StatsGrid>

      <TrendChart
        data={trends}
        dataKey="bookings"
        title="Booking Trend"
        description="Tenant booking trend from analytics API"
        color="#3b82f6"
        showTrend
      />

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
        data={staffMetrics.slice(0, 10).map((row) => ({ user: row.user_id.slice(0, 8), completed: row.completed }))}
        dataKeys={['completed']}
        xAxisKey="user"
        title="Completed Bookings by Staff"
        description="Top staff completion counts"
        colors={['#10b981']}
      />
    </div>
  );
}
