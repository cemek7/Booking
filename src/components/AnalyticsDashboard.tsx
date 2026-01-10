'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  TrendingUp, 
  TrendingDown, 
  Calendar, 
  Users, 
  DollarSign, 
  Clock,
  Target,
  AlertTriangle,
  Lock
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { getUnifiedAnalyticsAccess, validateAnalyticsRequest } from '@/lib/unified-analytics-permissions';
import { Role } from '@/types/roles';

export interface AnalyticsMetric {
  id: string;
  name: string;
  value: number;
  trend: number;
  type: 'count' | 'percentage' | 'currency' | 'duration';
  period: string;
  last_updated: string;
}

export interface BookingTrendData {
  date: string;
  bookings: number;
  revenue: number;
  cancellations: number;
  no_shows: number;
}

export interface StaffPerformanceData {
  staff_id: string;
  staff_name: string;
  bookings_count: number;
  revenue_total: number;
  utilization_rate: number;
  customer_rating: number;
  tips_total: number;
}

interface AnalyticsDashboardProps {
  tenantId: string;
  userRole: Role;
  userId: string;
  className?: string;
}

/**
 * Unified Analytics Dashboard - Single source for all role-based analytics
 * Replaces ManagerAnalytics, StaffAnalytics, and RoleBasedAnalytics components
 * Implements proper role isolation and tenant scoping
 */
const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ 
  tenantId, 
  userRole,
  userId,
  className
}) => {
  const [metrics, setMetrics] = useState<AnalyticsMetric[]>([]);
  const [trends, setTrends] = useState<BookingTrendData[]>([]);
  const [staffPerformance, setStaffPerformance] = useState<StaffPerformanceData[]>([]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'quarter'>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Role-based analytics access control using unified permission system
  const analyticsAccess = getUnifiedAnalyticsAccess(userRole);
  const tenantValidation = validateAnalyticsRequest(userRole, 'tenant', tenantId, userId);

  // Define what this role can view
  const canViewRevenue = analyticsAccess.permissions.canViewGlobalData || analyticsAccess.permissions.canViewTenantData;
  const canViewAllStaff = analyticsAccess.permissions.canViewTenantData;
  
  // Determine analytics scope based on role
  const restrictedView = !canViewRevenue ? 'limited' : !canViewAllStaff ? 'team' : 'full';

  const loadAnalyticsData = useCallback(async () => {
    if (!tenantValidation.allowed) {
      setError(tenantValidation.reason || 'Access denied');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const headers = { 
        'x-tenant-id': tenantId,
        'x-user-role': userRole,
      };

      // Build API endpoints based on permissions
      const endpoints: Promise<Response>[] = [
        fetch(`/api/analytics/dashboard?period=${period}&scope=${restrictedView || 'full'}`, { headers })
      ];

      // Add conditional endpoints based on permissions and tab visibility
      if (canViewRevenue) {
        endpoints.push(fetch(`/api/analytics/trends?days=30`, { headers }));
      }

      if (canViewAllStaff) {
        endpoints.push(fetch(`/api/analytics/staff?period=${period}`, { headers }));
      }

      const responses = await Promise.all(endpoints);
      
      // Check if all requests succeeded
      for (const response of responses) {
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }
      }

      const [metricsData, trendsData, staffData] = await Promise.all([
        responses[0].json(),
        responses[1]?.json() || { trends: [] },
        responses[2]?.json() || { performance: [] }
      ]);

      // Set state with fetched data
      setMetrics(metricsData.metrics || []);
      setTrends(trendsData.trends || []);
      setStaffPerformance(staffData.performance || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, period, userRole, restrictedView, canViewRevenue, canViewAllStaff, tenantValidation.allowed, tenantValidation.reason]);

  useEffect(() => {
    loadAnalyticsData();
  }, [loadAnalyticsData]);

  // Early return if no access (after hooks to maintain hook order)
  if (!tenantValidation.allowed) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            Analytics Access Restricted
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 p-4 border rounded-lg bg-muted/50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm">{tenantValidation.reason}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAnalyticsData();
    setRefreshing(false);
  };

  const formatValue = (value: number, type: AnalyticsMetric['type']): string => {
    switch (type) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(value);
      case 'percentage':
        return `${value.toFixed(1)}%`;
      case 'duration':
        return `${value} hrs`;
      case 'count':
      default:
        return value.toLocaleString();
    }
  };

  const getMetricIcon = (metricId: string) => {
    switch (metricId) {
      case 'total_bookings':
        return <Calendar className="h-4 w-4" />;
      case 'total_revenue':
        return <DollarSign className="h-4 w-4" />;
      case 'new_customers':
        return <Users className="h-4 w-4" />;
      case 'staff_utilization':
        return <Clock className="h-4 w-4" />;
      case 'cancellation_rate':
      case 'no_show_rate':
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Target className="h-4 w-4" />;
    }
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0) {
      return <TrendingUp className="h-4 w-4 text-green-500" />;
    } else if (trend < 0) {
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    }
    return <div className="h-4 w-4" />; // Neutral
  };

  const getTrendColor = (trend: number, isNegativeGood: boolean = false) => {
    if (isNegativeGood) {
      return trend < 0 ? 'text-green-500' : trend > 0 ? 'text-red-500' : 'text-gray-500';
    }
    return trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-gray-500';
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-6 bg-gray-200 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-600 mb-4">Failed to load analytics data: {error}</p>
            <Button onClick={handleRefresh} variant="outline">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground">
            Real-time insights and performance metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={handleRefresh} 
            disabled={refreshing}
            variant="outline"
            size="sm"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex space-x-2">
        {(['day', 'week', 'month', 'quarter'] as const).map((p) => (
          <Button
            key={p}
            variant={period === p ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPeriod(p)}
            className="capitalize"
          >
            {p}
          </Button>
        ))}
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric) => {
          const isNegativeGood = metric.id.includes('cancellation') || metric.id.includes('no_show');
          
          return (
            <Card key={metric.id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between space-y-0 pb-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {metric.name}
                  </p>
                  {getMetricIcon(metric.id)}
                </div>
                <div className="flex items-center space-x-2">
                  <p className="text-2xl font-bold">
                    {formatValue(metric.value, metric.type)}
                  </p>
                  <div className="flex items-center space-x-1">
                    {getTrendIcon(metric.trend)}
                    <span className={`text-xs font-medium ${getTrendColor(metric.trend, isNegativeGood)}`}>
                      {Math.abs(metric.trend).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  vs previous {metric.period}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Analytics Tabs */}
      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trends">Booking Trends</TabsTrigger>
          <TabsTrigger value="staff">Staff Performance</TabsTrigger>
          <TabsTrigger value="insights">Customer Insights</TabsTrigger>
        </TabsList>

        {/* Booking Trends */}
        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Booking Trends (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value: unknown) => new Date(value as string).toLocaleDateString()}
                    />
                    <YAxis />
                    <Tooltip 
                      labelFormatter={(value: unknown) => new Date(value as string).toLocaleDateString()}
                      formatter={(value: any, name: any) => {
                        const numValue = typeof value === 'number' ? value : 0;
                        const nameStr = name || 'value';
                        return [
                          nameStr === 'revenue' ? formatValue(numValue, 'currency') : numValue,
                          // @ts-ignore - Recharts formatter types
                          nameStr.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
                        ];
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="bookings" 
                      stroke="#8884d8" 
                      strokeWidth={2}
                      name="bookings"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="revenue" 
                      stroke="#82ca9d" 
                      strokeWidth={2}
                      name="revenue"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="cancellations" 
                      stroke="#ffc658" 
                      strokeWidth={2}
                      name="cancellations"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Staff Performance */}
        <TabsContent value="staff" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Staff Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={staffPerformance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="staff_name" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value: any, name: any) => {
                        const numValue = typeof value === 'number' ? value : 0;
                        const nameStr = (name || 'value') as string;
                        return [
                          nameStr.includes('revenue') || nameStr.includes('tips') 
                            ? formatValue(numValue, 'currency')
                            : nameStr.includes('rate') 
                            ? `${numValue}%`
                            : numValue,
                          // @ts-ignore - Recharts formatter types
                          nameStr.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
                        ];
                      }}
                    />
                    <Bar dataKey="bookings_count" fill="#8884d8" name="bookings_count" />
                    <Bar dataKey="utilization_rate" fill="#82ca9d" name="utilization_rate" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              
              {/* Staff Performance Table */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Staff Member</th>
                      <th className="text-right p-2">Bookings</th>
                      <th className="text-right p-2">Revenue</th>
                      <th className="text-right p-2">Utilization</th>
                      <th className="text-right p-2">Rating</th>
                      <th className="text-right p-2">Tips</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffPerformance.map((staff) => (
                      <tr key={staff.staff_id} className="border-b">
                        <td className="p-2 font-medium">{staff.staff_name}</td>
                        <td className="text-right p-2">{staff.bookings_count}</td>
                        <td className="text-right p-2">
                          {formatValue(staff.revenue_total, 'currency')}
                        </td>
                        <td className="text-right p-2">
                          <Badge variant={staff.utilization_rate > 80 ? 'default' : 'secondary'}>
                            {staff.utilization_rate.toFixed(1)}%
                          </Badge>
                        </td>
                        <td className="text-right p-2">
                          ⭐ {staff.customer_rating}
                        </td>
                        <td className="text-right p-2">
                          {formatValue(staff.tips_total, 'currency')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Customer Insights */}
        <TabsContent value="insights" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Customer Retention</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">First-time visitors</span>
                    <span className="font-medium">45%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Return customers</span>
                    <span className="font-medium">55%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Loyalty members</span>
                    <span className="font-medium">23%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenue by Source</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Direct bookings</span>
                    <span className="font-medium">65%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Chat referrals</span>
                    <span className="font-medium">25%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Partner platforms</span>
                    <span className="font-medium">10%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AnalyticsDashboard;