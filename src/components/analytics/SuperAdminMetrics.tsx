'use client';

import React, { useEffect, useMemo, useState } from 'react';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import PerformanceTable from './shared/PerformanceTable';
import DataUnavailableState from './shared/DataUnavailableState';
import { Building2, Users, DollarSign, Activity } from 'lucide-react';
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
    return {
      totalTenants,
      totalCalls,
      totalTokens,
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

      <StatsGrid columns={4}>
        <MetricCard label="Total Tenants" value={totals.totalTenants} icon={Building2} colorScheme="info" loading={loading} />
        <MetricCard label="Total Calls" value={totals.totalCalls} icon={Users} colorScheme="success" loading={loading} />
        <MetricCard label="Total Tokens" value={totals.totalTokens} icon={DollarSign} colorScheme="success" loading={loading} formatValue={(v) => Number(v).toLocaleString()} />
        <MetricCard label="Data Freshness" value="30d window" icon={Activity} colorScheme="default" loading={loading} />
      </StatsGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChart
          data={tenantMetrics.map((row) => ({ tenant: row.tenant_name || row.tenant_id.slice(0, 16), calls: row.call_count }))}
          dataKeys={['calls']}
          xAxisKey="tenant"
          title="API Call Count by Tenant"
          description="From /api/admin/metrics"
          colors={['#3b82f6']}
        />
        <PieChart
          data={tenantMetrics.map((row) => ({ name: row.tenant_name || row.tenant_id.slice(0, 16), value: row.total_tokens }))}
          title="Token Usage Distribution"
          description="Token usage share by tenant"
          showPercentage
          innerRadius={60}
        />
      </div>

      <PerformanceTable
        data={tenantMetrics}
        title="Tenant Usage"
        description="Aggregated usage in the last 30 days"
        columns={[
          { key: 'tenant_id', label: 'Tenant ID', sortable: true },
          { key: 'call_count', label: 'Call Count', sortable: true, align: 'right' },
          { key: 'total_tokens', label: 'Total Tokens', sortable: true, align: 'right', formatValue: (value) => Number(value).toLocaleString() },
        ]}
      />
    </div>
  );
}
