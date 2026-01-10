/**
 * Analytics Type Definitions
 * 
 * Comprehensive type definitions for KPI metrics, dashboard analytics,
 * and role-based analytics data across the booking system.
 */

import { UserRole } from './roles';

// Time period types for analytics
export type TimePeriod = 
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | 'custom';

// Analytics data granularity
export type DataGranularity = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

// Analytics metric types
export type MetricType = 
  | 'count'
  | 'sum'
  | 'average'
  | 'percentage'
  | 'ratio'
  | 'trend';

// Base analytics data point
export interface DataPoint {
  timestamp: string;
  value: number;
  label?: string;
  metadata?: Record<string, any>;
}

// Time series data
export interface TimeSeriesData {
  period: TimePeriod;
  granularity: DataGranularity;
  data: DataPoint[];
  total?: number;
  average?: number;
  trend?: 'up' | 'down' | 'stable';
  trendPercentage?: number;
}

// KPI metric definition
export interface KpiMetric {
  id: string;
  name: string;
  description: string;
  type: MetricType;
  category: 'bookings' | 'revenue' | 'customers' | 'staff' | 'operations';
  value: number;
  previousValue?: number;
  target?: number;
  unit: 'number' | 'currency' | 'percentage' | 'time';
  trend?: {
    direction: 'up' | 'down' | 'stable';
    percentage: number;
    period: TimePeriod;
  };
  visualization: 'number' | 'chart' | 'gauge' | 'progress';
  roleAccess: UserRole[];
  tenantId?: string;
}

// Dashboard widget configuration
export interface DashboardWidget {
  id: string;
  type: 'kpi' | 'chart' | 'table' | 'calendar' | 'list';
  title: string;
  description?: string;
  size: 'small' | 'medium' | 'large' | 'full';
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  config: WidgetConfig;
  roleAccess: UserRole[];
  refreshInterval?: number; // seconds
}

// Widget configuration types
export type WidgetConfig = 
  | KpiWidgetConfig
  | ChartWidgetConfig
  | TableWidgetConfig
  | CalendarWidgetConfig
  | ListWidgetConfig;

export interface KpiWidgetConfig {
  type: 'kpi';
  metrics: string[]; // KPI metric IDs
  layout: 'horizontal' | 'vertical' | 'grid';
  showTrend: boolean;
  showTarget: boolean;
}

export interface ChartWidgetConfig {
  type: 'chart';
  chartType: 'line' | 'bar' | 'pie' | 'area' | 'scatter';
  dataSource: string;
  xAxis: string;
  yAxis: string[];
  groupBy?: string;
  filters?: Record<string, any>;
  timeRange: TimePeriod;
  granularity: DataGranularity;
}

export interface TableWidgetConfig {
  type: 'table';
  dataSource: string;
  columns: TableColumn[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  pageSize?: number;
  filters?: Record<string, any>;
}

export interface TableColumn {
  key: string;
  title: string;
  type: 'text' | 'number' | 'date' | 'currency' | 'status';
  sortable?: boolean;
  filterable?: boolean;
  width?: number;
}

export interface CalendarWidgetConfig {
  type: 'calendar';
  view: 'month' | 'week' | 'day';
  eventSource: string;
  colorBy?: string;
  showWeekends: boolean;
}

export interface ListWidgetConfig {
  type: 'list';
  dataSource: string;
  itemTemplate: string;
  maxItems?: number;
  sortBy?: string;
  filters?: Record<string, any>;
}

// Analytics dashboard layout
export interface DashboardLayout {
  id: string;
  name: string;
  role: UserRole;
  isDefault: boolean;
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// Analytics query interface
export interface AnalyticsQuery {
  metric: string;
  period: TimePeriod;
  granularity: DataGranularity;
  filters?: AnalyticsFilter[];
  groupBy?: string[];
  orderBy?: string;
  limit?: number;
  tenantId?: string;
  userId?: string;
}

export interface AnalyticsFilter {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater' | 'less' | 'contains' | 'in' | 'between';
  value: any;
  type: 'string' | 'number' | 'date' | 'boolean';
}

// Role-specific analytics data
export interface RoleAnalyticsData {
  role: UserRole;
  tenantId?: string;
  userId?: string;
  kpis: KpiMetric[];
  timeSeriesData: Record<string, TimeSeriesData>;
  summary: AnalyticsSummary;
  permissions: AnalyticsPermissions;
}

export interface AnalyticsSummary {
  totalBookings: number;
  totalRevenue: number;
  totalCustomers: number;
  averageBookingValue: number;
  customerSatisfaction?: number;
  staffUtilization?: number;
  period: TimePeriod;
  comparisonPeriod?: {
    period: TimePeriod;
    percentageChange: number;
  };
}

export interface AnalyticsPermissions {
  canViewGlobalData: boolean;
  canViewTenantData: boolean;
  canViewTeamData: boolean;
  canViewPersonalData: boolean;
  canExportData: boolean;
  canCreateDashboards: boolean;
  canShareDashboards: boolean;
  dataRetentionDays: number;
}

// Specific analytics for different roles
export interface SuperadminAnalytics extends RoleAnalyticsData {
  role: 'superadmin';
  globalMetrics: {
    totalTenants: number;
    activeTenants: number;
    totalUsers: number;
    systemHealth: number;
    apiUsage: TimeSeriesData;
  };
  tenantPerformance: Array<{
    tenantId: string;
    tenantName: string;
    bookings: number;
    revenue: number;
    users: number;
    lastActivity: string;
  }>;
}

export interface OwnerAnalytics extends RoleAnalyticsData {
  role: 'owner';
  businessMetrics: {
    monthlyRecurringRevenue: number;
    customerLifetimeValue: number;
    churnRate: number;
    growthRate: number;
  };
  staffPerformance: Array<{
    staffId: string;
    staffName: string;
    bookings: number;
    revenue: number;
    utilization: number;
    rating: number;
  }>;
  serviceAnalytics: Array<{
    serviceId: string;
    serviceName: string;
    bookings: number;
    revenue: number;
    averageDuration: number;
    popularity: number;
  }>;
}

export interface ManagerAnalytics extends RoleAnalyticsData {
  role: 'manager';
  teamMetrics: {
    teamSize: number;
    teamUtilization: number;
    teamRevenue: number;
    teamBookings: number;
  };
  operationalMetrics: {
    schedulingEfficiency: number;
    noShowRate: number;
    rebookingRate: number;
    customerSatisfaction: number;
  };
  staffInsights: Array<{
    staffId: string;
    staffName: string;
    bookingsToday: number;
    utilizationRate: number;
    performanceScore: number;
  }>;
}

export interface StaffAnalytics extends RoleAnalyticsData {
  role: 'staff';
  personalMetrics: {
    bookingsToday: number;
    bookingsThisWeek: number;
    bookingsThisMonth: number;
    averageServiceTime: number;
    customerRating: number;
    earnings: number;
  };
  scheduleMetrics: {
    utilizationRate: number;
    busyHours: Array<{
      hour: number;
      bookingCount: number;
    }>;
    preferredServices: Array<{
      serviceId: string;
      serviceName: string;
      count: number;
      percentage: number;
    }>;
  };
}

// Analytics event tracking
export interface AnalyticsEvent {
  id: string;
  type: 'page_view' | 'user_action' | 'booking_event' | 'system_event';
  userId?: string;
  tenantId?: string;
  timestamp: string;
  properties: Record<string, any>;
  sessionId?: string;
  source: 'web' | 'mobile' | 'api' | 'whatsapp';
}

// Real-time analytics
export interface RealtimeMetric {
  metric: string;
  value: number;
  timestamp: string;
  tenantId?: string;
  metadata?: Record<string, any>;
}

export interface RealtimeUpdate {
  type: 'metric_update' | 'new_booking' | 'cancelled_booking' | 'user_online';
  data: RealtimeMetric | Record<string, any>;
  timestamp: string;
}

// Analytics export formats
export interface AnalyticsExport {
  format: 'csv' | 'xlsx' | 'pdf' | 'json';
  data: any;
  filters: AnalyticsQuery;
  generatedAt: string;
  generatedBy: string;
  fileName: string;
}

// Utility functions for analytics
export function calculateTrend(current: number, previous: number): {
  direction: 'up' | 'down' | 'stable';
  percentage: number;
} {
  if (previous === 0) {
    return { direction: 'stable', percentage: 0 };
  }
  
  const change = ((current - previous) / previous) * 100;
  
  if (Math.abs(change) < 1) {
    return { direction: 'stable', percentage: 0 };
  }
  
  return {
    direction: change > 0 ? 'up' : 'down',
    percentage: Math.abs(change)
  };
}

export function formatMetricValue(
  value: number,
  unit: 'number' | 'currency' | 'percentage' | 'time'
): string {
  switch (unit) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(value);
    case 'percentage':
      return `${value.toFixed(1)}%`;
    case 'time':
      const hours = Math.floor(value / 3600);
      const minutes = Math.floor((value % 3600) / 60);
      return `${hours}h ${minutes}m`;
    default:
      return value.toLocaleString();
  }
}

export function getAnalyticsForRole(role: UserRole): {
  availableMetrics: string[];
  permissions: AnalyticsPermissions;
} {
  const basePermissions: AnalyticsPermissions = {
    canViewGlobalData: false,
    canViewTenantData: false,
    canViewTeamData: false,
    canViewPersonalData: true,
    canExportData: false,
    canCreateDashboards: false,
    canShareDashboards: false,
    dataRetentionDays: 90
  };

  switch (role) {
    case 'superadmin':
      return {
        availableMetrics: ['all'],
        permissions: {
          ...basePermissions,
          canViewGlobalData: true,
          canViewTenantData: true,
          canViewTeamData: true,
          canExportData: true,
          canCreateDashboards: true,
          canShareDashboards: true,
          dataRetentionDays: -1 // unlimited
        }
      };
    case 'owner':
      return {
        availableMetrics: [
          'bookings', 'revenue', 'customers', 'staff_performance',
          'service_analytics', 'business_metrics'
        ],
        permissions: {
          ...basePermissions,
          canViewTenantData: true,
          canViewTeamData: true,
          canExportData: true,
          canCreateDashboards: true,
          canShareDashboards: true,
          dataRetentionDays: 365
        }
      };
    case 'manager':
      return {
        availableMetrics: [
          'team_bookings', 'team_revenue', 'staff_utilization',
          'operational_metrics', 'schedule_efficiency'
        ],
        permissions: {
          ...basePermissions,
          canViewTeamData: true,
          canExportData: true,
          dataRetentionDays: 180
        }
      };
    case 'staff':
      return {
        availableMetrics: [
          'personal_bookings', 'personal_revenue', 'personal_rating',
          'schedule_utilization'
        ],
        permissions: {
          ...basePermissions,
          dataRetentionDays: 90
        }
      };
  }
}

// Export all types
export type {
  TimePeriod,
  DataGranularity,
  MetricType,
  DataPoint,
  TimeSeriesData,
  KpiMetric,
  DashboardWidget,
  WidgetConfig,
  DashboardLayout,
  AnalyticsQuery,
  AnalyticsFilter,
  RoleAnalyticsData,
  AnalyticsSummary,
  AnalyticsPermissions,
  SuperadminAnalytics,
  OwnerAnalytics,
  ManagerAnalytics,
  StaffAnalytics,
  AnalyticsEvent,
  RealtimeMetric,
  RealtimeUpdate,
  AnalyticsExport
};