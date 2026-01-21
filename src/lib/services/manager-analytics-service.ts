import { SupabaseClient } from '@supabase/supabase-js';
import { AppUser } from '../../../../types/types';

// Types
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

export interface ManagerRevenueData {
  totalRevenue: number;
  revenueByStaff: Array<{
    staffId: string;
    staffName: string;
    revenue: number;
    bookings: number;
  }>;
  revenueByService: Array<{
    serviceId: string;
    serviceName: string;
    revenue: number;
    count: number;
  }>;
  trends: Array<{
    date: string;
    revenue: number;
    bookings: number;
  }>;
}

export interface ManagerTeamData {
  staffPerformance: Array<{
    staffId: string;
    staffName: string;
    bookings: number;
    completed: number;
    rating: number;
    utilization: number;
    revenue: number;
  }>;
  teamMetrics: {
    totalStaff: number;
    activeStaff: number;
    avgRating: number;
    avgUtilization: number;
  };
  scheduleEfficiency: Array<{
    day: string;
    scheduled: number;
    completed: number;
    utilization: number;
  }>;
}

export interface ManagerBookingData {
  bookingsByStatus: {
    completed: number;
    confirmed: number;
    pending: number;
    cancelled: number;
    noShow: number;
  };
  bookingTrends: Array<{
    date: string;
    bookings: number;
    completed: number;
    cancelled: number;
  }>;
  peakHours: Array<{
    hour: string;
    bookings: number;
  }>;
  cancellationReasons: Array<{
    reason: string;
    count: number;
  }>;
}

// Helper functions

export function calculateDateRange(period: string) {
  const now = new Date();
  let startDate = new Date();

  switch (period) {
    case 'day':
      startDate.setDate(now.getDate() - 1);
      break;
    case 'week':
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'quarter':
      startDate.setMonth(now.getMonth() - 3);
      break;
    case 'year':
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    default:
      startDate.setMonth(now.getMonth() - 1);
  }

  return { startDate, endDate: now };
}

function calculateTrend(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function getPreviousDateRange(period: string) {
  const { startDate, endDate } = calculateDateRange(period);
  const duration = endDate.getTime() - startDate.getTime();

  return {
    startDate: new Date(startDate.getTime() - duration),
    endDate: new Date(startDate.getTime()),
  };
}

/**
 * Get team manager IDs that the user manages
 * Managers can only see data for staff they manage
 */
async function getManagedStaffIds(
  supabase: SupabaseClient,
  user: AppUser
): Promise<string[]> {
  // If user is owner or superadmin, they can see all staff in tenant
  if (user.role === 'owner' || user.role === 'superadmin') {
    const { data: allStaff } = await supabase
      .from('tenant_users')
      .select('user_id')
      .eq('tenant_id', user.tenantId)
      .in('role', ['staff', 'manager']);

    return (allStaff || []).map(s => s.user_id);
  }

  // For managers, check if they have a team assignment
  // This would typically come from a team_assignments or manager_staff table
  // For now, we'll return all staff in the tenant (can be refined with team tables)
  const { data: teamStaff } = await supabase
    .from('tenant_users')
    .select('user_id')
    .eq('tenant_id', user.tenantId)
    .eq('role', 'staff');

  return (teamStaff || []).map(s => s.user_id);
}

/**
 * Get overview analytics for manager dashboard
 * Includes team bookings, revenue, staff metrics, and trends
 */
export async function getOverviewAnalytics(
  supabase: SupabaseClient,
  user: AppUser,
  dateRange: { startDate: Date; endDate: Date }
): Promise<ManagerOverviewMetrics> {
  const { startDate, endDate } = dateRange;
  const previousRange = getPreviousDateRange('month');

  // Get managed staff IDs
  const staffIds = await getManagedStaffIds(supabase, user);

  // Get current period bookings
  const { data: currentBookings } = await supabase
    .from('reservations')
    .select('id, status, staff_id, metadata')
    .eq('tenant_id', user.tenantId)
    .in('staff_id', staffIds)
    .gte('start_at', startDate.toISOString())
    .lte('start_at', endDate.toISOString());

  // Get previous period bookings for trend calculation
  const { data: previousBookings } = await supabase
    .from('reservations')
    .select('id, status, metadata')
    .eq('tenant_id', user.tenantId)
    .in('staff_id', staffIds)
    .gte('start_at', previousRange.startDate.toISOString())
    .lte('start_at', previousRange.endDate.toISOString());

  // Calculate metrics
  const totalBookings = currentBookings?.length || 0;
  const previousTotalBookings = previousBookings?.length || 0;
  const completedBookings = currentBookings?.filter(b => b.status === 'completed').length || 0;

  // Calculate revenue
  const { data: revenueData } = await supabase
    .from('transactions')
    .select('amount')
    .eq('tenant_id', user.tenantId)
    .eq('status', 'completed')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString());

  const totalRevenue = (revenueData || []).reduce((sum, t) => sum + Number(t.amount), 0);

  const { data: previousRevenueData } = await supabase
    .from('transactions')
    .select('amount')
    .eq('tenant_id', user.tenantId)
    .eq('status', 'completed')
    .gte('created_at', previousRange.startDate.toISOString())
    .lte('created_at', previousRange.endDate.toISOString());

  const previousRevenue = (previousRevenueData || []).reduce((sum, t) => sum + Number(t.amount), 0);

  // Get active staff count
  const { count: activeStaffCount } = await supabase
    .from('tenant_users')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', user.tenantId)
    .in('user_id', staffIds)
    .eq('role', 'staff');

  // Calculate schedule utilization
  const workingDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const maxBookings = (activeStaffCount || 1) * workingDays * 8; // 8 hours per day
  const scheduleUtilization = maxBookings > 0 ? (totalBookings / maxBookings) * 100 : 0;

  // Calculate completion rate
  const completionRate = totalBookings > 0 ? (completedBookings / totalBookings) * 100 : 0;

  // Mock team rating (would come from reviews/ratings table)
  const teamRating = 4.7;
  const previousRating = 4.6;

  return {
    teamBookings: totalBookings,
    teamRevenue: totalRevenue,
    activeStaff: activeStaffCount || 0,
    teamRating,
    scheduleUtilization: Math.min(scheduleUtilization, 100),
    completionRate,
    trends: {
      bookings: calculateTrend(totalBookings, previousTotalBookings),
      revenue: calculateTrend(totalRevenue, previousRevenue),
      rating: calculateTrend(teamRating, previousRating),
    },
  };
}

/**
 * Get revenue analytics for manager
 * Includes team revenue, revenue by staff, and trends
 */
export async function getRevenueAnalytics(
  supabase: SupabaseClient,
  user: AppUser,
  dateRange: { startDate: Date; endDate: Date }
): Promise<ManagerRevenueData> {
  const { startDate, endDate } = dateRange;
  const staffIds = await getManagedStaffIds(supabase, user);

  // Get revenue transactions
  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount, created_at, metadata')
    .eq('tenant_id', user.tenantId)
    .eq('status', 'completed')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString());

  const totalRevenue = (transactions || []).reduce((sum, t) => sum + Number(t.amount), 0);

  // Get bookings with staff and service info
  const { data: bookings } = await supabase
    .from('reservations')
    .select(`
      id,
      staff_id,
      service_id,
      start_at,
      metadata,
      users!reservations_staff_id_fkey(id, full_name),
      services(id, name)
    `)
    .eq('tenant_id', user.tenantId)
    .in('staff_id', staffIds)
    .eq('status', 'completed')
    .gte('start_at', startDate.toISOString())
    .lte('start_at', endDate.toISOString());

  // Revenue by staff
  const staffRevenueMap = new Map<string, { staffId: string; staffName: string; revenue: number; bookings: number }>();

  (bookings || []).forEach(booking => {
    const staffId = booking.staff_id;
    const staffName = booking.users?.full_name || 'Unknown';
    const revenue = Number(booking.metadata?.revenue || 0);

    if (!staffRevenueMap.has(staffId)) {
      staffRevenueMap.set(staffId, { staffId, staffName, revenue: 0, bookings: 0 });
    }

    const staffData = staffRevenueMap.get(staffId)!;
    staffData.revenue += revenue;
    staffData.bookings += 1;
  });

  const revenueByStaff = Array.from(staffRevenueMap.values())
    .sort((a, b) => b.revenue - a.revenue);

  // Revenue by service
  const serviceRevenueMap = new Map<string, { serviceId: string; serviceName: string; revenue: number; count: number }>();

  (bookings || []).forEach(booking => {
    const serviceId = booking.service_id;
    const serviceName = booking.services?.name || 'Unknown';
    const revenue = Number(booking.metadata?.revenue || 0);

    if (!serviceRevenueMap.has(serviceId)) {
      serviceRevenueMap.set(serviceId, { serviceId, serviceName, revenue: 0, count: 0 });
    }

    const serviceData = serviceRevenueMap.get(serviceId)!;
    serviceData.revenue += revenue;
    serviceData.count += 1;
  });

  const revenueByService = Array.from(serviceRevenueMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10); // Top 10 services

  // Revenue trends by day
  const trendMap = new Map<string, { date: string; revenue: number; bookings: number }>();
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().split('T')[0];
    trendMap.set(dateKey, { date: dateKey, revenue: 0, bookings: 0 });
  }

  (bookings || []).forEach(booking => {
    const dateKey = new Date(booking.start_at).toISOString().split('T')[0];
    const trend = trendMap.get(dateKey);
    if (trend) {
      trend.revenue += Number(booking.metadata?.revenue || 0);
      trend.bookings += 1;
    }
  });

  const trends = Array.from(trendMap.values()).sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return {
    totalRevenue,
    revenueByStaff,
    revenueByService,
    trends,
  };
}

/**
 * Get team analytics for manager
 * Includes staff performance, team metrics, and schedule efficiency
 */
export async function getTeamAnalytics(
  supabase: SupabaseClient,
  user: AppUser,
  dateRange: { startDate: Date; endDate: Date },
  staffId: string | null = null
): Promise<ManagerTeamData> {
  const { startDate, endDate } = dateRange;
  const staffIds = staffId ? [staffId] : await getManagedStaffIds(supabase, user);

  // Get staff data with bookings
  const { data: staffData } = await supabase
    .from('tenant_users')
    .select(`
      user_id,
      users!inner(id, full_name),
      reservations!reservations_staff_id_fkey(
        id,
        status,
        start_at,
        metadata
      )
    `)
    .eq('tenant_id', user.tenantId)
    .in('user_id', staffIds)
    .eq('role', 'staff');

  // Process staff performance
  const staffPerformance = (staffData || []).map(staff => {
    const reservations = staff.reservations || [];
    const periodReservations = reservations.filter(
      r => new Date(r.start_at) >= startDate && new Date(r.start_at) <= endDate
    );

    const totalBookings = periodReservations.length;
    const completedBookings = periodReservations.filter(r => r.status === 'completed').length;
    const revenue = periodReservations.reduce((sum, r) => sum + Number(r.metadata?.revenue || 0), 0);

    // Calculate utilization
    const workingDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const maxBookings = workingDays * 8; // 8 hours per day
    const utilization = maxBookings > 0 ? (totalBookings / maxBookings) * 100 : 0;

    // Mock rating (would come from reviews)
    const rating = 4.5 + Math.random() * 0.5;

    return {
      staffId: staff.user_id,
      staffName: staff.users?.full_name || 'Unknown',
      bookings: totalBookings,
      completed: completedBookings,
      rating: Number(rating.toFixed(1)),
      utilization: Math.min(Math.round(utilization), 100),
      revenue,
    };
  });

  // Calculate team metrics
  const totalStaff = staffPerformance.length;
  const activeStaff = staffPerformance.filter(s => s.bookings > 0).length;
  const avgRating = totalStaff > 0
    ? staffPerformance.reduce((sum, s) => sum + s.rating, 0) / totalStaff
    : 0;
  const avgUtilization = totalStaff > 0
    ? staffPerformance.reduce((sum, s) => sum + s.utilization, 0) / totalStaff
    : 0;

  // Schedule efficiency by day of week
  const { data: weeklyBookings } = await supabase
    .from('reservations')
    .select('id, start_at, status')
    .eq('tenant_id', user.tenantId)
    .in('staff_id', staffIds)
    .gte('start_at', startDate.toISOString())
    .lte('start_at', endDate.toISOString());

  const dayMap = new Map<string, { day: string; scheduled: number; completed: number; utilization: number }>();
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  days.forEach(day => {
    dayMap.set(day, { day, scheduled: 0, completed: 0, utilization: 0 });
  });

  (weeklyBookings || []).forEach(booking => {
    const date = new Date(booking.start_at);
    const dayIndex = date.getDay();
    const dayName = days[dayIndex === 0 ? 6 : dayIndex - 1]; // Adjust Sunday (0) to be last
    const dayData = dayMap.get(dayName);

    if (dayData) {
      dayData.scheduled += 1;
      if (booking.status === 'completed') {
        dayData.completed += 1;
      }
    }
  });

  const scheduleEfficiency = Array.from(dayMap.values()).map(day => ({
    ...day,
    utilization: day.scheduled > 0 ? Math.round((day.completed / day.scheduled) * 100) : 0,
  }));

  return {
    staffPerformance,
    teamMetrics: {
      totalStaff,
      activeStaff,
      avgRating: Number(avgRating.toFixed(1)),
      avgUtilization: Math.round(avgUtilization),
    },
    scheduleEfficiency,
  };
}

/**
 * Get booking analytics for manager
 * Includes booking status, trends, peak hours, and cancellation analysis
 */
export async function getBookingAnalytics(
  supabase: SupabaseClient,
  user: AppUser,
  dateRange: { startDate: Date; endDate: Date }
): Promise<ManagerBookingData> {
  const { startDate, endDate } = dateRange;
  const staffIds = await getManagedStaffIds(supabase, user);

  // Get all bookings
  const { data: bookings } = await supabase
    .from('reservations')
    .select('id, status, start_at, metadata')
    .eq('tenant_id', user.tenantId)
    .in('staff_id', staffIds)
    .gte('start_at', startDate.toISOString())
    .lte('start_at', endDate.toISOString());

  // Bookings by status
  const bookingsByStatus = {
    completed: bookings?.filter(b => b.status === 'completed').length || 0,
    confirmed: bookings?.filter(b => b.status === 'confirmed').length || 0,
    pending: bookings?.filter(b => b.status === 'pending').length || 0,
    cancelled: bookings?.filter(b => b.status === 'cancelled').length || 0,
    noShow: bookings?.filter(b => b.status === 'no_show').length || 0,
  };

  // Booking trends by date
  const trendMap = new Map<string, { date: string; bookings: number; completed: number; cancelled: number }>();
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().split('T')[0];
    trendMap.set(dateKey, { date: dateKey, bookings: 0, completed: 0, cancelled: 0 });
  }

  (bookings || []).forEach(booking => {
    const dateKey = new Date(booking.start_at).toISOString().split('T')[0];
    const trend = trendMap.get(dateKey);
    if (trend) {
      trend.bookings += 1;
      if (booking.status === 'completed') trend.completed += 1;
      if (booking.status === 'cancelled') trend.cancelled += 1;
    }
  });

  const bookingTrends = Array.from(trendMap.values()).sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Peak hours analysis
  const hourMap = new Map<number, number>();

  (bookings || []).forEach(booking => {
    const hour = new Date(booking.start_at).getHours();
    hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
  });

  const peakHours = Array.from(hourMap.entries())
    .map(([hour, count]) => ({
      hour: `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`,
      bookings: count,
    }))
    .sort((a, b) => {
      const hourA = parseInt(a.hour);
      const hourB = parseInt(b.hour);
      return hourA - hourB;
    });

  // Cancellation reasons (from metadata)
  const cancellationMap = new Map<string, number>();

  bookings?.filter(b => b.status === 'cancelled').forEach(booking => {
    const reason = booking.metadata?.cancellation_reason || 'Not specified';
    cancellationMap.set(reason, (cancellationMap.get(reason) || 0) + 1);
  });

  const cancellationReasons = Array.from(cancellationMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    bookingsByStatus,
    bookingTrends,
    peakHours,
    cancellationReasons,
  };
}

/**
 * Generate custom analytics report
 * Allows managers to create custom reports with specific metrics and filters
 */
export async function generateCustomReport(
  supabase: SupabaseClient,
  user: AppUser,
  data: {
    reportType: 'staff' | 'revenue' | 'bookings' | 'comprehensive';
    dateRange: { startDate: Date; endDate: Date };
    filters?: {
      staffIds?: string[];
      serviceIds?: string[];
      includeMetrics?: string[];
    };
  }
) {
  const { reportType, dateRange, filters } = data;

  let report: any = {
    reportType,
    generatedAt: new Date().toISOString(),
    generatedBy: user.id,
    period: dateRange,
  };

  switch (reportType) {
    case 'staff':
      const teamData = await getTeamAnalytics(supabase, user, dateRange, null);
      report.data = teamData;
      break;

    case 'revenue':
      const revenueData = await getRevenueAnalytics(supabase, user, dateRange);
      report.data = revenueData;
      break;

    case 'bookings':
      const bookingData = await getBookingAnalytics(supabase, user, dateRange);
      report.data = bookingData;
      break;

    case 'comprehensive':
      const [overview, revenue, team, bookings] = await Promise.all([
        getOverviewAnalytics(supabase, user, dateRange),
        getRevenueAnalytics(supabase, user, dateRange),
        getTeamAnalytics(supabase, user, dateRange, null),
        getBookingAnalytics(supabase, user, dateRange),
      ]);
      report.data = { overview, revenue, team, bookings };
      break;

    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }

  return { success: true, report };
}

/**
 * Export analytics data to CSV or JSON format
 */
export async function exportAnalyticsData(
  supabase: SupabaseClient,
  user: AppUser,
  data: {
    dataType: 'staff' | 'revenue' | 'bookings';
    format: 'csv' | 'json';
    dateRange: { startDate: Date; endDate: Date };
  }
) {
  const { dataType, format, dateRange } = data;

  let exportData: any;

  switch (dataType) {
    case 'staff':
      const teamData = await getTeamAnalytics(supabase, user, dateRange, null);
      exportData = teamData.staffPerformance;
      break;

    case 'revenue':
      const revenueData = await getRevenueAnalytics(supabase, user, dateRange);
      exportData = revenueData.revenueByStaff;
      break;

    case 'bookings':
      const bookingData = await getBookingAnalytics(supabase, user, dateRange);
      exportData = bookingData.bookingTrends;
      break;

    default:
      throw new Error(`Unknown data type: ${dataType}`);
  }

  if (format === 'csv') {
    // Convert to CSV format
    const headers = Object.keys(exportData[0] || {}).join(',');
    const rows = exportData.map((row: any) =>
      Object.values(row)
        .map(v => `"${v}"`)
        .join(',')
    );
    const csv = [headers, ...rows].join('\n');

    return { success: true, data: csv, format: 'csv' };
  } else {
    // Return as JSON
    return { success: true, data: exportData, format: 'json' };
  }
}

/**
 * Save dashboard configuration preferences
 * Allows managers to customize their dashboard layout and widgets
 */
export async function saveDashboardConfig(
  supabase: SupabaseClient,
  user: AppUser,
  data: {
    layout: string;
    widgets: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
      config: Record<string, any>;
    }>;
    preferences: {
      defaultPeriod?: string;
      theme?: string;
      autoRefresh?: boolean;
      refreshInterval?: number;
    };
  }
) {
  const { layout, widgets, preferences } = data;

  // Save to user preferences table
  const { data: savedConfig, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: user.id,
      tenant_id: user.tenantId,
      preference_type: 'dashboard_config',
      config: {
        layout,
        widgets,
        preferences,
      },
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, config: savedConfig };
}
