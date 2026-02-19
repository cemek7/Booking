'use client';

import React, { useEffect, useMemo, useState } from 'react';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import PerformanceTable from './shared/PerformanceTable';
import DataUnavailableState from './shared/DataUnavailableState';
import { Building2, Users, DollarSign, Activity, Calendar, UserCheck } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';

import type { AdminTenantMetric } from '@/types/analytics-api';

export default function SuperAdminMetrics() {
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [loading, setLoading] = useState(true);
  const [tenantMetrics, setTenantMetrics] = useState<AdminTenantMetric[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await authFetch<{ metrics?: AdminTenantMetric[] }>('/api/admin/metrics');
        if (cancelled) return;
        setTenantMetrics(response.status === 200 ? response.data?.metrics || [] : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const totalTenants = tenantMetrics.length;
    const totalCalls = tenantMetrics.reduce((sum, row) => sum + row.call_count, 0);
    const totalTokens = tenantMetrics.reduce((sum, row) => sum + row.total_tokens, 0);
    const totalUsersEstimate = tenantMetrics.reduce((sum, row) => sum + (row.user_count || 0), 0);
    const totalRevenueEstimate = tenantMetrics.reduce((sum, row) => sum + (row.revenue_estimate || 0), 0);
    const totalReservations = tenantMetrics.reduce((sum, row) => sum + (row.reservation_count || 0), 0);
    const totalActiveStaff = tenantMetrics.reduce((sum, row) => sum + (row.active_staff_count || 0), 0);
    return {
      totalTenants,
      totalCalls,
      totalTokens,
      totalUsersEstimate,
      totalRevenueEstimate,
      totalReservations,
      totalActiveStaff,
    };
  }, [tenantMetrics]);

  if (!loading && tenantMetrics.length === 0) {
    return (
      <DataUnavailableState
        title="Platform analytics"
        description="Data not available. Backend analytics data was not returned for this view."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <DateRangePicker period={period} onPeriodChange={setPeriod} compact className="w-64" />
      </div>

      {/* Top KPI row */}
      <StatsGrid columns={4}>
        <MetricCard label="Total Tenants" value={totals.totalTenants} icon={Building2} colorScheme="info" loading={loading} />
        <MetricCard label="Total Users (Estimate)" value={totals.totalUsersEstimate} icon={Users} colorScheme="success" loading={loading} />
        <MetricCard label="Total Revenue (Estimate)" value={totals.totalRevenueEstimate} icon={DollarSign} colorScheme="success" loading={loading} formatValue={(v) => `$${Number(v).toLocaleString()}`} />
        <MetricCard label="Data Freshness" value="30d window" icon={Activity} colorScheme="default" loading={loading} />
      </StatsGrid>

      {/* Second KPI row: bookings & staff */}
      <StatsGrid columns={3}>
        <MetricCard label="Total Reservations (30d)" value={totals.totalReservations} icon={Calendar} colorScheme="info" loading={loading} />
        <MetricCard label="Active Staff (Platform)" value={totals.totalActiveStaff} icon={UserCheck} colorScheme="default" loading={loading} />
        <MetricCard label="Total API Calls (30d)" value={totals.totalCalls} icon={Activity} colorScheme="default" loading={loading} />
      </StatsGrid>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChart
          data={tenantMetrics.map((row) => ({
            tenant: row.tenant_name || row.tenant_id.slice(0, 16),
            reservations: row.reservation_count || 0,
            completed: row.completed_reservations || 0,
          }))}
          dataKeys={['reservations', 'completed']}
          xAxisKey="tenant"
          title="Reservations by Tenant (30d)"
          description="Total and completed reservations per tenant"
          colors={['#3b82f6', '#10b981']}
        />
        <PieChart
          data={tenantMetrics.map((row) => ({
            name: row.tenant_name || row.tenant_id.slice(0, 16),
            value: row.revenue_estimate || 0,
          }))}
          title="Revenue Distribution by Tenant"
          description="Revenue estimate share per tenant"
          showPercentage
          innerRadius={60}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChart
          data={tenantMetrics.map((row) => ({
            tenant: row.tenant_name || row.tenant_id.slice(0, 16),
            calls: row.call_count,
          }))}
          dataKeys={['calls']}
          xAxisKey="tenant"
          title="API Call Count by Tenant (30d)"
          description="LLM/API usage per tenant"
          colors={['#8b5cf6']}
        />
        <PieChart
          data={tenantMetrics.map((row) => ({
            name: row.tenant_name || row.tenant_id.slice(0, 16),
            value: row.total_tokens,
          }))}
          title="Token Usage Distribution"
          description="Token usage share by tenant"
          showPercentage
          innerRadius={60}
        />
      </div>

      {/* Full per-tenant breakdown table */}
      <PerformanceTable
        data={tenantMetrics}
        title="Tenant Platform Metrics"
        description="Full per-tenant breakdown (last 30 days)"
        columns={[
          { key: 'tenant_name', label: 'Tenant', sortable: true, formatValue: (v, row) => (row as AdminTenantMetric).tenant_name || (row as AdminTenantMetric).tenant_id },
          { key: 'user_count', label: 'Users', sortable: true, align: 'right' },
          { key: 'active_staff_count', label: 'Staff', sortable: true, align: 'right' },
          { key: 'reservation_count', label: 'Reservations', sortable: true, align: 'right' },
          { key: 'completed_reservations', label: 'Completed', sortable: true, align: 'right' },
          { key: 'revenue_estimate', label: 'Revenue', sortable: true, align: 'right', formatValue: (value) => `$${Number(value || 0).toLocaleString()}` },
          { key: 'call_count', label: 'API Calls', sortable: true, align: 'right' },
        ]}
      />
    </div>
  );
}
