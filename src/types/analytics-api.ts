export type DashboardPeriod = 'day' | 'week' | 'month' | 'quarter';
export type StaffPeriod = 'week' | 'month' | 'quarter';
export type ManagerPeriod = 'week' | 'month' | 'quarter' | 'year';

export interface DashboardMetric {
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

export interface ManagerOverviewMetrics {
  teamBookings: number;
  teamRevenue: number;
  activeStaff: number;
  teamRating: number;
  scheduleUtilization: number;
  completionRate: number;
  trends: {
    bookings: number;
    revenue: number;
    rating: number;
  };
}

export interface AdminTenantMetric {
  tenant_id: string;
  tenant_name?: string;
  total_tokens: number;
  call_count: number;
}

export interface StaffMemberMetric {
  user_id: string;
  rating: number | null;
  completed: number;
  revenue: number;
}
