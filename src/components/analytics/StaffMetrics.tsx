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
import {
  Calendar,
  DollarSign,
  Star,
  TrendingUp,
  Award,
  Clock,
  Target,
  Users,
} from 'lucide-react';

export interface StaffMetricsProps {
  userId: string;
  tenantId: string;
}

/**
 * StaffMetrics Component
 *
 * Displays personal performance analytics for staff members
 * Includes personal bookings, earnings, customer ratings, and achievements
 * Staff can only see their own data (personal scope)
 */
export default function StaffMetrics({ userId, tenantId }: StaffMetricsProps) {
  const [period, setPeriod] = useState<TimePeriod>('month');

  // TODO: Fetch real data from API - these are mock data for now
  const personalMetrics = {
    myBookings: 87,
    myEarnings: 9135,
    myRating: 4.9,
    completionRate: 95.4,
    repeatCustomers: 42,
    hoursWorked: 168,
  };

  const trends = {
    bookings: 8.3,
    earnings: 12.7,
    rating: 1.2,
    completionRate: 2.1,
  };

  // Personal booking trends
  const personalBookingData = [
    { date: 'Week 1', bookings: 12, completed: 11 },
    { date: 'Week 2', bookings: 14, completed: 13 },
    { date: 'Week 3', bookings: 16, completed: 15 },
    { date: 'Week 4', bookings: 13, completed: 13 },
    { date: 'Week 5', bookings: 17, completed: 16 },
    { date: 'Week 6', bookings: 15, completed: 15 },
  ];

  // Personal earnings over time
  const earningsData = [
    { date: 'Week 1', earnings: 1260 },
    { date: 'Week 2', earnings: 1470 },
    { date: 'Week 3', earnings: 1680 },
    { date: 'Week 4', earnings: 1365 },
    { date: 'Week 5', earnings: 1785 },
    { date: 'Week 6', earnings: 1575 },
  ];

  // Service breakdown
  const serviceBreakdownData = [
    { name: 'Haircut & Styling', value: 32, color: '#3b82f6' },
    { name: 'Massage Therapy', value: 24, color: '#10b981' },
    { name: 'Nail Services', value: 18, color: '#f59e0b' },
    { name: 'Facial Treatment', value: 13, color: '#8b5cf6' },
  ];

  // Customer ratings breakdown
  const ratingsBreakdownData = [
    { rating: '5 Stars', count: 68 },
    { rating: '4 Stars', count: 15 },
    { rating: '3 Stars', count: 3 },
    { rating: '2 Stars', count: 1 },
    { rating: '1 Star', count: 0 },
  ];

  // Daily schedule performance
  const schedulePerformanceData = [
    { day: 'Mon', scheduled: 14, completed: 13 },
    { day: 'Tue', scheduled: 15, completed: 14 },
    { day: 'Wed', scheduled: 16, completed: 16 },
    { day: 'Thu', scheduled: 13, completed: 13 },
    { day: 'Fri', scheduled: 17, completed: 16 },
    { day: 'Sat', scheduled: 12, completed: 11 },
  ];

  // Peak performance hours
  const peakHoursData = [
    { hour: '9 AM', bookings: 4 },
    { hour: '10 AM', bookings: 6 },
    { hour: '11 AM', bookings: 8 },
    { hour: '12 PM', bookings: 9 },
    { hour: '1 PM', bookings: 7 },
    { hour: '2 PM', bookings: 10 },
    { hour: '3 PM', bookings: 11 },
    { hour: '4 PM', bookings: 9 },
    { hour: '5 PM', bookings: 7 },
    { hour: '6 PM', bookings: 5 },
  ];

  // Customer feedback categories
  const feedbackData = [
    { category: 'Professionalism', score: 4.9 },
    { category: 'Quality', score: 4.8 },
    { category: 'Punctuality', score: 4.9 },
    { category: 'Communication', score: 4.7 },
    { category: 'Value', score: 4.6 },
  ];

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

      {/* Personal KPIs */}
      <StatsGrid columns={4}>
        <MetricCard
          label="My Bookings"
          value={personalMetrics.myBookings}
          trend={trends.bookings}
          trendLabel="vs last period"
          icon={Calendar}
          colorScheme="info"
        />
        <MetricCard
          label="My Earnings"
          value={personalMetrics.myEarnings}
          trend={trends.earnings}
          trendLabel="vs last period"
          icon={DollarSign}
          formatValue={formatCurrency}
          colorScheme="success"
        />
        <MetricCard
          label="My Rating"
          value={personalMetrics.myRating}
          trend={trends.rating}
          trendLabel="vs last period"
          icon={Star}
          colorScheme="warning"
        />
        <MetricCard
          label="Completion Rate"
          value={`${personalMetrics.completionRate}%`}
          trend={trends.completionRate}
          trendLabel="vs last period"
          icon={TrendingUp}
          colorScheme="success"
        />
      </StatsGrid>

      {/* Booking Performance & Earnings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AreaChart
          data={personalBookingData}
          dataKeys={['bookings', 'completed']}
          title="My Booking Performance"
          description="Weekly booking and completion trends"
          colors={['#3b82f6', '#10b981']}
          stacked={false}
        />
        <TrendChart
          data={earningsData}
          dataKey="earnings"
          title="My Earnings Trend"
          description="Weekly earnings performance"
          color="#10b981"
          showTrend
          formatValue={formatCurrency}
        />
      </div>

      {/* Service Breakdown & Ratings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PieChart
          data={serviceBreakdownData}
          title="My Service Distribution"
          description="Services I perform most often"
          showPercentage
          innerRadius={60}
        />
        <BarChart
          data={ratingsBreakdownData}
          dataKeys={['count']}
          xAxisKey="rating"
          title="Customer Ratings Breakdown"
          description="Distribution of ratings received"
          colors={['#f59e0b']}
        />
      </div>

      {/* Schedule Performance */}
      <BarChart
        data={schedulePerformanceData}
        dataKeys={['scheduled', 'completed']}
        xAxisKey="day"
        title="Weekly Schedule Performance"
        description="Scheduled vs completed appointments by day"
        colors={['#3b82f6', '#10b981']}
      />

      {/* Peak Performance Hours */}
      <BarChart
        data={peakHoursData}
        dataKeys={['bookings']}
        xAxisKey="hour"
        title="My Peak Performance Hours"
        description="Most productive times of day"
        colors={['#8b5cf6']}
      />

      {/* Customer Feedback Scores */}
      <BarChart
        data={feedbackData}
        dataKeys={['score']}
        xAxisKey="category"
        title="Customer Feedback by Category"
        description="Average scores across feedback dimensions"
        colors={['#10b981']}
        horizontal
      />

      {/* Personal Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4" />
              My Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Total Completed
                </span>
                <span className="text-sm font-semibold text-green-600">
                  {Math.floor(personalMetrics.myBookings * 0.954)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Repeat Customers
                </span>
                <span className="text-sm font-semibold text-blue-600">
                  {personalMetrics.repeatCustomers}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  5-Star Reviews
                </span>
                <span className="text-sm font-semibold text-amber-600">
                  68
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Time Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Hours Worked
                </span>
                <span className="text-sm font-semibold">
                  {personalMetrics.hoursWorked}h
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Avg Per Booking
                </span>
                <span className="text-sm font-semibold">42 min</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  On-Time Rate
                </span>
                <span className="text-sm font-semibold text-green-600">
                  96.5%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              Goals & Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Monthly Target
                </span>
                <span className="text-sm font-semibold text-blue-600">
                  87/90
                </span>
              </div>
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
                  Team Rank
                </span>
                <span className="text-sm font-semibold text-purple-600">
                  #2 of 12
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Personal Stats Summary */}
      <Card className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Performance Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-600">
                {personalMetrics.myBookings}
              </p>
              <p className="text-sm text-muted-foreground">Total Bookings</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">
                {formatCurrency(personalMetrics.myEarnings)}
              </p>
              <p className="text-sm text-muted-foreground">Total Earnings</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-amber-600">
                {personalMetrics.myRating} ⭐
              </p>
              <p className="text-sm text-muted-foreground">Average Rating</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-purple-600">
                {personalMetrics.completionRate}%
              </p>
              <p className="text-sm text-muted-foreground">Completion Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
