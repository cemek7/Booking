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
  DollarSign,
  Calendar,
  Users,
  TrendingUp,
  Award,
  Target,
  Clock,
  Star,
} from 'lucide-react';

export interface OwnerMetricsProps {
  tenantId: string;
}

/**
 * OwnerMetrics Component
 *
 * Displays comprehensive business analytics for tenant owners
 * Includes revenue, bookings, staff performance, and customer insights
 */
export default function OwnerMetrics({ tenantId }: OwnerMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');

  // TODO: Fetch real data from API - these are mock data for now
  const businessMetrics = {
    totalRevenue: 45231,
    totalBookings: 423,
    activeCustomers: 187,
    averageRating: 4.8,
    staffCount: 12,
    utilizationRate: 78.5,
  };

  const trends = {
    revenue: 12.5,
    bookings: 8.2,
    customers: 15.3,
    rating: 2.1,
  };

  // Revenue over time
  const revenueData = [
    { date: 'Week 1', revenue: 8420, bookings: 87 },
    { date: 'Week 2', revenue: 9850, bookings: 94 },
    { date: 'Week 3', revenue: 11200, bookings: 102 },
    { date: 'Week 4', revenue: 10150, bookings: 89 },
    { date: 'Week 5', revenue: 12800, bookings: 115 },
    { date: 'Week 6', revenue: 14200, bookings: 128 },
  ];

  // Booking status distribution
  const bookingStatusData = [
    { name: 'Completed', value: 352, color: '#10b981' },
    { name: 'Confirmed', value: 48, color: '#3b82f6' },
    { name: 'Pending', value: 15, color: '#f59e0b' },
    { name: 'Cancelled', value: 8, color: '#ef4444' },
  ];

  // Service performance
  const servicePerformanceData = [
    { name: 'Haircut & Styling', bookings: 145, revenue: 14500 },
    { name: 'Massage Therapy', bookings: 98, revenue: 11760 },
    { name: 'Nail Services', bookings: 87, revenue: 6960 },
    { name: 'Facial Treatment', bookings: 56, revenue: 7840 },
    { name: 'Color Treatment', bookings: 37, revenue: 5180 },
  ];

  // Customer acquisition trends
  const customerAcquisitionData = [
    { date: 'Jan', new: 28, returning: 42 },
    { date: 'Feb', new: 32, returning: 48 },
    { date: 'Mar', new: 35, returning: 52 },
    { date: 'Apr', new: 41, returning: 58 },
    { date: 'May', new: 38, returning: 64 },
    { date: 'Jun', new: 45, returning: 71 },
  ];

  // Staff performance ranking
  const staffPerformance = [
    {
      name: 'Sarah Johnson',
      bookings: 87,
      revenue: 9135,
      rating: 4.9,
      utilization: 92,
    },
    {
      name: 'Michael Chen',
      bookings: 78,
      revenue: 8190,
      rating: 4.8,
      utilization: 88,
    },
    {
      name: 'Emily Davis',
      bookings: 71,
      revenue: 7455,
      rating: 4.7,
      utilization: 84,
    },
    {
      name: 'James Wilson',
      bookings: 65,
      revenue: 6825,
      rating: 4.8,
      utilization: 81,
    },
    {
      name: 'Lisa Anderson',
      bookings: 58,
      revenue: 6090,
      rating: 4.6,
      utilization: 76,
    },
  ];

  // Peak hours analysis
  const peakHoursData = [
    { hour: '9 AM', bookings: 12 },
    { hour: '10 AM', bookings: 24 },
    { hour: '11 AM', bookings: 35 },
    { hour: '12 PM', bookings: 42 },
    { hour: '1 PM', bookings: 38 },
    { hour: '2 PM', bookings: 45 },
    { hour: '3 PM', bookings: 48 },
    { hour: '4 PM', bookings: 41 },
    { hour: '5 PM', bookings: 36 },
    { hour: '6 PM', bookings: 28 },
  ];

  const exportBusinessReport = () => {
    // TODO: Implement CSV export
    console.log('Exporting business report...');
  };

  const formatCurrency = (value: number) => `$${value.toLocaleString()}`;
  const formatPercent = (value: number) => `${value}%`;

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

      {/* Business KPIs */}
      <StatsGrid columns={4}>
        <MetricCard
          label="Total Revenue"
          value={businessMetrics.totalRevenue}
          trend={trends.revenue}
          trendLabel="vs last period"
          icon={DollarSign}
          formatValue={formatCurrency}
          colorScheme="success"
        />
        <MetricCard
          label="Total Bookings"
          value={businessMetrics.totalBookings}
          trend={trends.bookings}
          trendLabel="vs last period"
          icon={Calendar}
          colorScheme="info"
        />
        <MetricCard
          label="Active Customers"
          value={businessMetrics.activeCustomers}
          trend={trends.customers}
          trendLabel="vs last period"
          icon={Users}
          colorScheme="default"
        />
        <MetricCard
          label="Average Rating"
          value={businessMetrics.averageRating}
          trend={trends.rating}
          trendLabel="vs last period"
          icon={Star}
          colorScheme="warning"
        />
      </StatsGrid>

      {/* Revenue & Booking Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AreaChart
          data={revenueData}
          dataKeys={['revenue']}
          title="Revenue Trend"
          description="Weekly revenue performance"
          colors={['#10b981']}
          formatValue={formatCurrency}
        />
        <TrendChart
          data={revenueData}
          dataKey="bookings"
          title="Booking Trend"
          description="Weekly booking volume"
          color="#3b82f6"
          showTrend
        />
      </div>

      {/* Booking Status & Service Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PieChart
          data={bookingStatusData}
          title="Booking Status Breakdown"
          description="Current booking statuses"
          showPercentage
          innerRadius={50}
        />
        <BarChart
          data={servicePerformanceData}
          dataKeys={['bookings']}
          xAxisKey="name"
          title="Top Services by Bookings"
          description="Most popular services this period"
          colors={['#8b5cf6']}
        />
      </div>

      {/* Customer Acquisition */}
      <AreaChart
        data={customerAcquisitionData}
        dataKeys={['new', 'returning']}
        title="Customer Acquisition & Retention"
        description="New vs returning customers over time"
        colors={['#3b82f6', '#10b981']}
        stacked={false}
      />

      {/* Peak Hours Analysis */}
      <BarChart
        data={peakHoursData}
        dataKeys={['bookings']}
        xAxisKey="hour"
        title="Peak Booking Hours"
        description="Busiest times of day for bookings"
        colors={['#f59e0b']}
      />

      {/* Staff Performance Table */}
      <PerformanceTable
        data={staffPerformance}
        columns={[
          {
            key: 'name',
            label: 'Staff Member',
            sortable: true,
            width: '25%',
          },
          {
            key: 'bookings',
            label: 'Bookings',
            sortable: true,
            align: 'right',
          },
          {
            key: 'revenue',
            label: 'Revenue',
            sortable: true,
            align: 'right',
            formatValue: (value) => `$${value.toLocaleString()}`,
          },
          {
            key: 'rating',
            label: 'Rating',
            sortable: true,
            align: 'center',
            formatValue: (value) => (
              <div className="flex items-center justify-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-semibold">{value}</span>
              </div>
            ),
          },
          {
            key: 'utilization',
            label: 'Utilization',
            sortable: true,
            align: 'right',
            formatValue: (value) => (
              <span
                className={
                  value >= 85
                    ? 'text-green-600 font-semibold'
                    : value >= 70
                    ? 'text-blue-600'
                    : 'text-amber-600'
                }
              >
                {value}%
              </span>
            ),
          },
        ]}
        title="Staff Performance Rankings"
        description="Top performing staff members this period"
        onExport={exportBusinessReport}
        exportLabel="Export Business Report"
      />

      {/* Additional Business Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              Conversion Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Booking Conversion
                </span>
                <span className="text-sm font-semibold text-green-600">
                  73.2%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Customer Retention
                </span>
                <span className="text-sm font-semibold text-green-600">
                  82.5%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Cancellation Rate
                </span>
                <span className="text-sm font-semibold text-amber-600">
                  1.9%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Operational Efficiency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Avg Service Time
                </span>
                <span className="text-sm font-semibold">42 min</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Staff Utilization
                </span>
                <span className="text-sm font-semibold text-green-600">
                  {businessMetrics.utilizationRate}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  No-Show Rate
                </span>
                <span className="text-sm font-semibold">3.2%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4" />
              Customer Satisfaction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  5-Star Reviews
                </span>
                <span className="text-sm font-semibold text-green-600">
                  78%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Repeat Customers
                </span>
                <span className="text-sm font-semibold">64%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Referral Rate
                </span>
                <span className="text-sm font-semibold text-green-600">
                  12.5%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
