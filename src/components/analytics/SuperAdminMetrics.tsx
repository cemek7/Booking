'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import MetricCard from './shared/MetricCard';
import StatsGrid from './shared/StatsGrid';
import DateRangePicker, { TimePeriod } from './shared/DateRangePicker';
import TrendChart from './charts/TrendChart';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import AreaChart from './charts/AreaChart';
import PerformanceTable from './shared/PerformanceTable';
import {
  Building2,
  Users,
  DollarSign,
  Activity,
  TrendingUp,
  Globe,
  Download,
} from 'lucide-react';

/**
 * SuperAdminMetrics Component
 *
 * Displays platform-wide analytics across all tenants
 * Includes tenant growth, usage stats, revenue metrics, and tenant rankings
 */
export default function SuperAdminMetrics() {
  const [period, setPeriod] = useState<TimePeriod>('month');

  // TODO: Fetch real data from API - these are mock data for now
  const platformMetrics = {
    totalTenants: 47,
    activeTenants: 42,
    totalUsers: 1247,
    totalRevenue: 158420,
    platformUptime: 99.8,
  };

  const trends = {
    tenants: 8.3,
    users: 12.7,
    revenue: 15.2,
    uptime: 0.1,
  };

  // Tenant growth over time
  const tenantGrowthData = [
    { date: 'Jan', tenants: 32, active: 28 },
    { date: 'Feb', tenants: 35, active: 31 },
    { date: 'Mar', tenants: 38, active: 34 },
    { date: 'Apr', tenants: 41, active: 37 },
    { date: 'May', tenants: 44, active: 40 },
    { date: 'Jun', tenants: 47, active: 42 },
  ];

  // Platform revenue trends
  const revenueData = [
    { date: 'Jan', revenue: 112000, subscriptions: 28000, bookings: 84000 },
    { date: 'Feb', revenue: 118000, subscriptions: 29000, bookings: 89000 },
    { date: 'Mar', revenue: 125000, subscriptions: 31000, bookings: 94000 },
    { date: 'Apr', revenue: 138000, subscriptions: 33000, bookings: 105000 },
    { date: 'May', revenue: 145000, subscriptions: 35000, bookings: 110000 },
    { date: 'Jun', revenue: 158000, subscriptions: 37000, bookings: 121000 },
  ];

  // Tenant tier distribution
  const tenantTierData = [
    { name: 'Starter', value: 18, color: '#3b82f6' },
    { name: 'Professional', value: 22, color: '#10b981' },
    { name: 'Enterprise', value: 7, color: '#f59e0b' },
  ];

  // Industry breakdown
  const industryData = [
    { name: 'Healthcare', tenants: 12 },
    { name: 'Beauty & Wellness', tenants: 15 },
    { name: 'Professional Services', tenants: 8 },
    { name: 'Education', tenants: 7 },
    { name: 'Fitness', tenants: 5 },
  ];

  // Top performing tenants
  const topTenants = [
    {
      name: 'Wellness Spa Network',
      bookings: 1847,
      revenue: 94350,
      growth: 23.5,
      status: 'active',
    },
    {
      name: 'ProHealth Clinics',
      bookings: 1623,
      revenue: 87200,
      growth: 18.2,
      status: 'active',
    },
    {
      name: 'FitLife Studios',
      bookings: 1402,
      revenue: 71100,
      growth: 15.7,
      status: 'active',
    },
    {
      name: 'Beauty Hub Collective',
      bookings: 1287,
      revenue: 64350,
      growth: 12.3,
      status: 'active',
    },
    {
      name: 'TechRepair Services',
      bookings: 1156,
      revenue: 58800,
      growth: 9.8,
      status: 'active',
    },
  ];

  const exportPlatformReport = () => {
    // TODO: Implement CSV export
    console.log('Exporting platform report...');
  };

  const formatCurrency = (value: number) => `$${(value / 1000).toFixed(0)}k`;
  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {/* Date Range Picker */}
      <div className="flex items-center justify-between">
        <DateRangePicker
          period={period}
          onPeriodChange={setPeriod}
          compact
          className="w-64"
        />
      </div>

      {/* Platform KPIs */}
      <StatsGrid columns={4}>
        <MetricCard
          label="Total Tenants"
          value={platformMetrics.totalTenants}
          trend={trends.tenants}
          trendLabel="vs last month"
          icon={Building2}
          colorScheme="info"
        />
        <MetricCard
          label="Platform Users"
          value={platformMetrics.totalUsers}
          trend={trends.users}
          trendLabel="vs last month"
          icon={Users}
          colorScheme="success"
        />
        <MetricCard
          label="Platform Revenue"
          value={platformMetrics.totalRevenue}
          trend={trends.revenue}
          trendLabel="vs last month"
          icon={DollarSign}
          formatValue={formatCurrency}
          colorScheme="success"
        />
        <MetricCard
          label="Platform Uptime"
          value={`${platformMetrics.platformUptime}%`}
          trend={trends.uptime}
          trendLabel="vs last month"
          icon={Activity}
          colorScheme="default"
        />
      </StatsGrid>

      {/* Tenant Growth & Revenue Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          data={tenantGrowthData}
          dataKey="tenants"
          title="Tenant Growth"
          description="New tenant acquisitions over time"
          color="#3b82f6"
          showTrend
        />
        <AreaChart
          data={revenueData}
          dataKeys={['revenue']}
          title="Platform Revenue"
          description="Total revenue across all tenants"
          colors={['#10b981']}
          formatValue={formatCurrency}
        />
      </div>

      {/* Tenant Distribution & Industry Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PieChart
          data={tenantTierData}
          title="Tenant Tier Distribution"
          description="Breakdown by subscription plan"
          showPercentage
          innerRadius={60}
        />
        <BarChart
          data={industryData}
          dataKeys={['tenants']}
          xAxisKey="name"
          title="Tenants by Industry"
          description="Industry vertical distribution"
          colors={['#8b5cf6']}
        />
      </div>

      {/* Revenue Breakdown */}
      <AreaChart
        data={revenueData}
        dataKeys={['subscriptions', 'bookings']}
        title="Revenue Sources"
        description="Subscription fees vs booking commissions"
        colors={['#f59e0b', '#3b82f6']}
        stacked
        formatValue={formatCurrency}
      />

      {/* Top Performing Tenants */}
      <PerformanceTable
        data={topTenants}
        columns={[
          {
            key: 'name',
            label: 'Tenant Name',
            sortable: true,
            width: '30%',
          },
          {
            key: 'bookings',
            label: 'Total Bookings',
            sortable: true,
            align: 'right',
            formatValue: (value) => value.toLocaleString(),
          },
          {
            key: 'revenue',
            label: 'Revenue',
            sortable: true,
            align: 'right',
            formatValue: (value) => `$${value.toLocaleString()}`,
          },
          {
            key: 'growth',
            label: 'Growth',
            sortable: true,
            align: 'right',
            formatValue: (value) => (
              <span className="text-green-600 font-semibold">+{value}%</span>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            align: 'center',
            formatValue: (value) => (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                {value}
              </span>
            ),
          },
        ]}
        title="Top Performing Tenants"
        description="Highest revenue-generating tenants this period"
        onExport={exportPlatformReport}
        exportLabel="Export Platform Report"
      />
    </div>
  );
}
