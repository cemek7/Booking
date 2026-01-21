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
  Users,
  Calendar,
  Clock,
  TrendingUp,
  Target,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

export interface ManagerMetricsProps {
  tenantId: string;
  userId: string;
}

/**
 * ManagerMetrics Component
 *
 * Displays team-focused analytics for managers
 * Includes team performance, scheduling efficiency, and operational metrics
 * No global revenue or financial data (tenant-scoped only)
 */
export default function ManagerMetrics({
  tenantId,
  userId,
}: ManagerMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');

  // TODO: Fetch real data from API - these are mock data for now
  const teamMetrics = {
    teamBookings: 287,
    activeStaff: 8,
    scheduleUtilization: 82.3,
    teamRating: 4.7,
    pendingTasks: 12,
    completedBookings: 265,
  };

  const trends = {
    bookings: 6.8,
    utilization: 3.2,
    rating: 1.5,
    tasks: -15.4,
  };

  // Team booking trends
  const teamBookingData = [
    { date: 'Week 1', bookings: 42, completed: 39 },
    { date: 'Week 2', bookings: 48, completed: 45 },
    { date: 'Week 3', bookings: 51, completed: 48 },
    { date: 'Week 4', bookings: 46, completed: 43 },
    { date: 'Week 5', bookings: 54, completed: 51 },
    { date: 'Week 6', bookings: 58, completed: 55 },
  ];

  // Schedule efficiency by day
  const scheduleEfficiencyData = [
    { day: 'Mon', utilization: 78, capacity: 90 },
    { day: 'Tue', utilization: 85, capacity: 90 },
    { day: 'Wed', utilization: 88, capacity: 90 },
    { day: 'Thu', utilization: 82, capacity: 90 },
    { day: 'Fri', utilization: 92, capacity: 90 },
    { day: 'Sat', utilization: 95, capacity: 90 },
    { day: 'Sun', utilization: 68, capacity: 90 },
  ];

  // Staff availability status
  const staffAvailabilityData = [
    { name: 'Available', value: 6, color: '#10b981' },
    { name: 'Booked', value: 2, color: '#3b82f6' },
    { name: 'Off Duty', value: 1, color: '#6b7280' },
  ];

  // Booking status breakdown
  const bookingStatusData = [
    { name: 'Completed', value: 265, color: '#10b981' },
    { name: 'Confirmed', value: 18, color: '#3b82f6' },
    { name: 'Pending', value: 4, color: '#f59e0b' },
  ];

  // Team member performance
  const teamPerformance = [
    {
      name: 'Sarah Johnson',
      bookings: 54,
      completed: 51,
      rating: 4.9,
      utilization: 92,
    },
    {
      name: 'Michael Chen',
      bookings: 48,
      completed: 46,
      rating: 4.8,
      utilization: 88,
    },
    {
      name: 'Emily Davis',
      bookings: 43,
      completed: 41,
      rating: 4.7,
      utilization: 84,
    },
    {
      name: 'James Wilson',
      bookings: 39,
      completed: 37,
      rating: 4.8,
      utilization: 81,
    },
    {
      name: 'Lisa Anderson',
      bookings: 35,
      completed: 33,
      rating: 4.6,
      utilization: 76,
    },
    {
      name: 'Robert Brown',
      bookings: 32,
      completed: 31,
      rating: 4.7,
      utilization: 73,
    },
    {
      name: 'Jennifer Lee',
      bookings: 28,
      completed: 27,
      rating: 4.5,
      utilization: 68,
    },
    {
      name: 'David Martinez',
      bookings: 24,
      completed: 23,
      rating: 4.6,
      utilization: 64,
    },
  ];

  // Service distribution across team
  const serviceDistributionData = [
    { service: 'Haircut', count: 87 },
    { service: 'Massage', count: 65 },
    { service: 'Nails', count: 52 },
    { service: 'Facial', count: 43 },
    { service: 'Color', count: 40 },
  ];

  // Cancellation reasons
  const cancellationData = [
    { reason: 'Client Request', count: 8 },
    { reason: 'No Show', count: 5 },
    { reason: 'Staff Unavailable', count: 3 },
    { reason: 'Weather', count: 2 },
    { reason: 'Other', count: 4 },
  ];

  const exportTeamReport = () => {
    // TODO: Implement CSV export
    console.log('Exporting team report...');
  };

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

      {/* Team KPIs */}
      <StatsGrid columns={4}>
        <MetricCard
          label="Team Bookings"
          value={teamMetrics.teamBookings}
          trend={trends.bookings}
          trendLabel="vs last period"
          icon={Calendar}
          colorScheme="info"
        />
        <MetricCard
          label="Active Staff"
          value={teamMetrics.activeStaff}
          icon={Users}
          colorScheme="default"
        />
        <MetricCard
          label="Schedule Utilization"
          value={`${teamMetrics.scheduleUtilization}%`}
          trend={trends.utilization}
          trendLabel="vs last period"
          icon={Clock}
          colorScheme="success"
        />
        <MetricCard
          label="Team Rating"
          value={teamMetrics.teamRating}
          trend={trends.rating}
          trendLabel="vs last period"
          icon={TrendingUp}
          colorScheme="warning"
        />
      </StatsGrid>

      {/* Team Booking Trends & Schedule Efficiency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AreaChart
          data={teamBookingData}
          dataKeys={['bookings', 'completed']}
          title="Team Booking Performance"
          description="Weekly booking and completion trends"
          colors={['#3b82f6', '#10b981']}
          stacked={false}
        />
        <BarChart
          data={scheduleEfficiencyData}
          dataKeys={['utilization']}
          xAxisKey="day"
          title="Schedule Utilization by Day"
          description="Daily schedule efficiency"
          colors={['#8b5cf6']}
        />
      </div>

      {/* Staff Availability & Booking Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PieChart
          data={staffAvailabilityData}
          title="Current Staff Availability"
          description="Real-time staff status"
          showPercentage
          innerRadius={50}
        />
        <PieChart
          data={bookingStatusData}
          title="Booking Status Distribution"
          description="Current booking pipeline"
          showPercentage
          innerRadius={50}
        />
      </div>

      {/* Service Distribution */}
      <BarChart
        data={serviceDistributionData}
        dataKeys={['count']}
        xAxisKey="service"
        title="Service Distribution Across Team"
        description="Most performed services"
        colors={['#f59e0b']}
      />

      {/* Team Performance Table */}
      <PerformanceTable
        data={teamPerformance}
        columns={[
          {
            key: 'name',
            label: 'Team Member',
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
            key: 'completed',
            label: 'Completed',
            sortable: true,
            align: 'right',
            formatValue: (value, row: any) => (
              <span className="text-green-600 font-semibold">
                {value}/{row.bookings}
              </span>
            ),
          },
          {
            key: 'rating',
            label: 'Rating',
            sortable: true,
            align: 'center',
            formatValue: (value) => (
              <span className="font-semibold">{value} ⭐</span>
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
        title="Team Member Performance"
        description="Individual performance metrics for your team"
        onExport={exportTeamReport}
        exportLabel="Export Team Report"
      />

      {/* Cancellation Analysis */}
      <BarChart
        data={cancellationData}
        dataKeys={['count']}
        xAxisKey="reason"
        title="Cancellation Analysis"
        description="Breakdown of cancellation reasons"
        colors={['#ef4444']}
      />

      {/* Operational Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              Productivity Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Completion Rate
                </span>
                <span className="text-sm font-semibold text-green-600">
                  92.3%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Avg Booking Duration
                </span>
                <span className="text-sm font-semibold">38 min</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  On-Time Start Rate
                </span>
                <span className="text-sm font-semibold text-green-600">
                  94.7%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Issues & Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Pending Tasks
                </span>
                <span className="text-sm font-semibold text-amber-600">
                  {teamMetrics.pendingTasks}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Late Starts Today
                </span>
                <span className="text-sm font-semibold">2</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Customer Complaints
                </span>
                <span className="text-sm font-semibold text-red-600">1</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Team Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Quality Score
                </span>
                <span className="text-sm font-semibold text-green-600">
                  A+
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Customer Satisfaction
                </span>
                <span className="text-sm font-semibold text-green-600">
                  96%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Goals Met
                </span>
                <span className="text-sm font-semibold text-green-600">
                  8/10
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
