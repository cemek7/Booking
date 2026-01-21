import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  calculateDateRange,
  getOverviewAnalytics,
  getRevenueAnalytics,
  getTeamAnalytics,
  getBookingAnalytics,
  generateCustomReport,
  exportAnalyticsData,
  saveDashboardConfig,
} from '@/lib/services/manager-analytics-service';
import { AppUser } from '../../../../types/types';

// Mock Supabase client
const createMockSupabase = () => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  single: jest.fn(),
  upsert: jest.fn().mockReturnThis(),
});

const mockManagerUser: AppUser = {
  id: 'manager-123',
  email: 'manager@test.com',
  role: 'manager',
  tenantId: 'tenant-123',
  full_name: 'Test Manager',
};

const mockOwnerUser: AppUser = {
  id: 'owner-123',
  email: 'owner@test.com',
  role: 'owner',
  tenantId: 'tenant-123',
  full_name: 'Test Owner',
};

describe('manager-analytics-service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    jest.clearAllMocks();
  });

  describe('calculateDateRange', () => {
    it('should calculate day range correctly', () => {
      const { startDate, endDate } = calculateDateRange('day');
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(1);
    });

    it('should calculate week range correctly', () => {
      const { startDate, endDate } = calculateDateRange('week');
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(7);
    });

    it('should calculate month range correctly', () => {
      const { startDate, endDate } = calculateDateRange('month');
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it('should calculate quarter range correctly', () => {
      const { startDate, endDate } = calculateDateRange('quarter');
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(89);
      expect(diffDays).toBeLessThanOrEqual(92);
    });

    it('should calculate year range correctly', () => {
      const { startDate, endDate } = calculateDateRange('year');
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(365);
      expect(diffDays).toBeLessThanOrEqual(366);
    });

    it('should default to month range for unknown period', () => {
      const { startDate, endDate } = calculateDateRange('invalid');
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    });
  });

  describe('getOverviewAnalytics', () => {
    const dateRange = {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
    };

    beforeEach(() => {
      // Mock tenant_users query for staff IDs
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenant_users') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [{ user_id: 'staff-1' }, { user_id: 'staff-2' }],
            }),
          };
        }
        return mockSupabase;
      });
    });

    it('should calculate team bookings correctly', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                { id: '1', status: 'completed', metadata: {} },
                { id: '2', status: 'completed', metadata: {} },
                { id: '3', status: 'pending', metadata: {} },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getOverviewAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.teamBookings).toBe(3);
      expect(result.completionRate).toBeGreaterThan(0);
    });

    it('should calculate trends correctly', async () => {
      const result = await getOverviewAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result).toHaveProperty('trends');
      expect(result.trends).toHaveProperty('bookings');
      expect(result.trends).toHaveProperty('revenue');
      expect(result.trends).toHaveProperty('rating');
      expect(typeof result.trends.bookings).toBe('number');
    });

    it('should handle zero bookings gracefully', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({ data: [] }),
          };
        }
        return mockSupabase;
      });

      const result = await getOverviewAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.teamBookings).toBe(0);
      expect(result.completionRate).toBe(0);
    });

    it('should calculate schedule utilization within bounds', async () => {
      const result = await getOverviewAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.scheduleUtilization).toBeGreaterThanOrEqual(0);
      expect(result.scheduleUtilization).toBeLessThanOrEqual(100);
    });

    it('should return valid team rating', async () => {
      const result = await getOverviewAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.teamRating).toBeGreaterThanOrEqual(0);
      expect(result.teamRating).toBeLessThanOrEqual(5);
    });
  });

  describe('getRevenueAnalytics', () => {
    const dateRange = {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
    };

    it('should calculate total revenue correctly', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                { amount: 100 },
                { amount: 150 },
                { amount: 200 },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getRevenueAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.totalRevenue).toBe(450);
    });

    it('should return revenue by staff', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                {
                  staff_id: 'staff-1',
                  users: { full_name: 'John Doe' },
                  metadata: { revenue: 100 },
                },
                {
                  staff_id: 'staff-1',
                  users: { full_name: 'John Doe' },
                  metadata: { revenue: 150 },
                },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getRevenueAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.revenueByStaff).toHaveLength(1);
      expect(result.revenueByStaff[0].revenue).toBe(250);
      expect(result.revenueByStaff[0].bookings).toBe(2);
    });

    it('should return revenue by service', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                {
                  service_id: 'service-1',
                  services: { name: 'Haircut' },
                  metadata: { revenue: 50 },
                },
                {
                  service_id: 'service-1',
                  services: { name: 'Haircut' },
                  metadata: { revenue: 50 },
                },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getRevenueAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.revenueByService).toHaveLength(1);
      expect(result.revenueByService[0].revenue).toBe(100);
      expect(result.revenueByService[0].count).toBe(2);
    });

    it('should return revenue trends by date', async () => {
      const result = await getRevenueAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(Array.isArray(result.trends)).toBe(true);
      expect(result.trends.length).toBeGreaterThan(0);
      expect(result.trends[0]).toHaveProperty('date');
      expect(result.trends[0]).toHaveProperty('revenue');
      expect(result.trends[0]).toHaveProperty('bookings');
    });

    it('should sort revenue by staff in descending order', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                {
                  staff_id: 'staff-1',
                  users: { full_name: 'John' },
                  metadata: { revenue: 100 },
                },
                {
                  staff_id: 'staff-2',
                  users: { full_name: 'Jane' },
                  metadata: { revenue: 200 },
                },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getRevenueAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.revenueByStaff[0].revenue).toBeGreaterThanOrEqual(
        result.revenueByStaff[result.revenueByStaff.length - 1]?.revenue || 0
      );
    });

    it('should limit top services to 10', async () => {
      const services = Array.from({ length: 15 }, (_, i) => ({
        service_id: `service-${i}`,
        services: { name: `Service ${i}` },
        metadata: { revenue: 10 + i },
      }));

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({ data: services }),
          };
        }
        return mockSupabase;
      });

      const result = await getRevenueAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.revenueByService.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getTeamAnalytics', () => {
    const dateRange = {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
    };

    it('should return staff performance data', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenant_users') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                {
                  user_id: 'staff-1',
                  users: { full_name: 'John Doe' },
                  reservations: [
                    { status: 'completed', start_at: '2024-01-15', metadata: { revenue: 100 } },
                  ],
                },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getTeamAnalytics(mockSupabase, mockManagerUser, dateRange, null);

      expect(Array.isArray(result.staffPerformance)).toBe(true);
      expect(result.staffPerformance[0]).toHaveProperty('staffId');
      expect(result.staffPerformance[0]).toHaveProperty('staffName');
      expect(result.staffPerformance[0]).toHaveProperty('bookings');
      expect(result.staffPerformance[0]).toHaveProperty('completed');
      expect(result.staffPerformance[0]).toHaveProperty('rating');
      expect(result.staffPerformance[0]).toHaveProperty('utilization');
    });

    it('should calculate team metrics correctly', async () => {
      const result = await getTeamAnalytics(mockSupabase, mockManagerUser, dateRange, null);

      expect(result.teamMetrics).toHaveProperty('totalStaff');
      expect(result.teamMetrics).toHaveProperty('activeStaff');
      expect(result.teamMetrics).toHaveProperty('avgRating');
      expect(result.teamMetrics).toHaveProperty('avgUtilization');
      expect(typeof result.teamMetrics.totalStaff).toBe('number');
    });

    it('should return schedule efficiency by day', async () => {
      const result = await getTeamAnalytics(mockSupabase, mockManagerUser, dateRange, null);

      expect(Array.isArray(result.scheduleEfficiency)).toBe(true);
      expect(result.scheduleEfficiency).toHaveLength(7); // 7 days of week
      expect(result.scheduleEfficiency[0]).toHaveProperty('day');
      expect(result.scheduleEfficiency[0]).toHaveProperty('scheduled');
      expect(result.scheduleEfficiency[0]).toHaveProperty('completed');
      expect(result.scheduleEfficiency[0]).toHaveProperty('utilization');
    });

    it('should filter by specific staff ID when provided', async () => {
      const staffId = 'staff-1';
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenant_users') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn((field: string, values: string[]) => {
              expect(values).toEqual([staffId]);
              return mockSupabase;
            }),
            then: jest.fn().mockResolvedValue({ data: [] }),
          };
        }
        return mockSupabase;
      });

      await getTeamAnalytics(mockSupabase, mockManagerUser, dateRange, staffId);
    });

    it('should cap utilization at 100%', async () => {
      const result = await getTeamAnalytics(mockSupabase, mockManagerUser, dateRange, null);

      result.staffPerformance.forEach(staff => {
        expect(staff.utilization).toBeLessThanOrEqual(100);
      });
    });

    it('should calculate avg rating correctly', async () => {
      const result = await getTeamAnalytics(mockSupabase, mockManagerUser, dateRange, null);

      expect(result.teamMetrics.avgRating).toBeGreaterThanOrEqual(0);
      expect(result.teamMetrics.avgRating).toBeLessThanOrEqual(5);
    });
  });

  describe('getBookingAnalytics', () => {
    const dateRange = {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
    };

    it('should return bookings by status', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                { status: 'completed' },
                { status: 'completed' },
                { status: 'pending' },
                { status: 'cancelled' },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getBookingAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(result.bookingsByStatus).toHaveProperty('completed');
      expect(result.bookingsByStatus).toHaveProperty('confirmed');
      expect(result.bookingsByStatus).toHaveProperty('pending');
      expect(result.bookingsByStatus).toHaveProperty('cancelled');
      expect(result.bookingsByStatus).toHaveProperty('noShow');
      expect(result.bookingsByStatus.completed).toBe(2);
      expect(result.bookingsByStatus.pending).toBe(1);
      expect(result.bookingsByStatus.cancelled).toBe(1);
    });

    it('should return booking trends by date', async () => {
      const result = await getBookingAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(Array.isArray(result.bookingTrends)).toBe(true);
      expect(result.bookingTrends[0]).toHaveProperty('date');
      expect(result.bookingTrends[0]).toHaveProperty('bookings');
      expect(result.bookingTrends[0]).toHaveProperty('completed');
      expect(result.bookingTrends[0]).toHaveProperty('cancelled');
    });

    it('should return peak hours analysis', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                { start_at: '2024-01-15T09:00:00Z' },
                { start_at: '2024-01-15T09:30:00Z' },
                { start_at: '2024-01-15T14:00:00Z' },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getBookingAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(Array.isArray(result.peakHours)).toBe(true);
      expect(result.peakHours[0]).toHaveProperty('hour');
      expect(result.peakHours[0]).toHaveProperty('bookings');
    });

    it('should return cancellation reasons', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                { status: 'cancelled', metadata: { cancellation_reason: 'Client Request' } },
                { status: 'cancelled', metadata: { cancellation_reason: 'Client Request' } },
                { status: 'cancelled', metadata: { cancellation_reason: 'No Show' } },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getBookingAnalytics(mockSupabase, mockManagerUser, dateRange);

      expect(Array.isArray(result.cancellationReasons)).toBe(true);
      expect(result.cancellationReasons[0]).toHaveProperty('reason');
      expect(result.cancellationReasons[0]).toHaveProperty('count');
    });

    it('should handle bookings with no cancellation reason', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [{ status: 'cancelled', metadata: {} }],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await getBookingAnalytics(mockSupabase, mockManagerUser, dateRange);

      const notSpecified = result.cancellationReasons.find(r => r.reason === 'Not specified');
      expect(notSpecified).toBeDefined();
    });
  });

  describe('generateCustomReport', () => {
    const dateRange = {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
    };

    it('should generate staff report', async () => {
      const result = await generateCustomReport(mockSupabase, mockManagerUser, {
        reportType: 'staff',
        dateRange,
      });

      expect(result.success).toBe(true);
      expect(result.report).toHaveProperty('reportType', 'staff');
      expect(result.report).toHaveProperty('generatedAt');
      expect(result.report).toHaveProperty('generatedBy', mockManagerUser.id);
      expect(result.report).toHaveProperty('data');
    });

    it('should generate revenue report', async () => {
      const result = await generateCustomReport(mockSupabase, mockManagerUser, {
        reportType: 'revenue',
        dateRange,
      });

      expect(result.success).toBe(true);
      expect(result.report.reportType).toBe('revenue');
    });

    it('should generate bookings report', async () => {
      const result = await generateCustomReport(mockSupabase, mockManagerUser, {
        reportType: 'bookings',
        dateRange,
      });

      expect(result.success).toBe(true);
      expect(result.report.reportType).toBe('bookings');
    });

    it('should generate comprehensive report', async () => {
      const result = await generateCustomReport(mockSupabase, mockManagerUser, {
        reportType: 'comprehensive',
        dateRange,
      });

      expect(result.success).toBe(true);
      expect(result.report.data).toHaveProperty('overview');
      expect(result.report.data).toHaveProperty('revenue');
      expect(result.report.data).toHaveProperty('team');
      expect(result.report.data).toHaveProperty('bookings');
    });

    it('should throw error for unknown report type', async () => {
      await expect(
        generateCustomReport(mockSupabase, mockManagerUser, {
          reportType: 'invalid' as any,
          dateRange,
        })
      ).rejects.toThrow('Unknown report type: invalid');
    });

    it('should include period in report', async () => {
      const result = await generateCustomReport(mockSupabase, mockManagerUser, {
        reportType: 'staff',
        dateRange,
      });

      expect(result.report).toHaveProperty('period');
      expect(result.report.period).toEqual(dateRange);
    });
  });

  describe('exportAnalyticsData', () => {
    const dateRange = {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
    };

    it('should export staff data as CSV', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenant_users') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                {
                  user_id: 'staff-1',
                  users: { full_name: 'John' },
                  reservations: [],
                },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await exportAnalyticsData(mockSupabase, mockManagerUser, {
        dataType: 'staff',
        format: 'csv',
        dateRange,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('csv');
      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('staffId');
    });

    it('should export revenue data as JSON', async () => {
      const result = await exportAnalyticsData(mockSupabase, mockManagerUser, {
        dataType: 'revenue',
        format: 'json',
        dateRange,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('json');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should export bookings data', async () => {
      const result = await exportAnalyticsData(mockSupabase, mockManagerUser, {
        dataType: 'bookings',
        format: 'json',
        dateRange,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should throw error for unknown data type', async () => {
      await expect(
        exportAnalyticsData(mockSupabase, mockManagerUser, {
          dataType: 'invalid' as any,
          format: 'json',
          dateRange,
        })
      ).rejects.toThrow('Unknown data type: invalid');
    });

    it('should properly quote CSV values', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenant_users') {
          return {
            ...mockSupabase,
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            then: jest.fn().mockResolvedValue({
              data: [
                {
                  user_id: 'staff-1',
                  users: { full_name: 'John, Doe' },
                  reservations: [],
                },
              ],
            }),
          };
        }
        return mockSupabase;
      });

      const result = await exportAnalyticsData(mockSupabase, mockManagerUser, {
        dataType: 'staff',
        format: 'csv',
        dateRange,
      });

      expect(result.data).toContain('"');
    });
  });

  describe('saveDashboardConfig', () => {
    const mockConfig = {
      layout: 'grid',
      widgets: [
        {
          id: 'widget-1',
          type: 'chart',
          position: { x: 0, y: 0 },
          size: { width: 6, height: 4 },
          config: { chartType: 'line' },
        },
      ],
      preferences: {
        defaultPeriod: 'month',
        theme: 'light',
        autoRefresh: true,
        refreshInterval: 60000,
      },
    };

    it('should save dashboard configuration', async () => {
      mockSupabase.upsert.mockReturnThis();
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValue({
        data: { id: '123', config: mockConfig },
        error: null,
      });

      const result = await saveDashboardConfig(mockSupabase, mockManagerUser, mockConfig);

      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
    });

    it('should include user and tenant IDs in config', async () => {
      mockSupabase.upsert.mockImplementation((data: any) => {
        expect(data.user_id).toBe(mockManagerUser.id);
        expect(data.tenant_id).toBe(mockManagerUser.tenantId);
        return mockSupabase;
      });

      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValue({
        data: { id: '123' },
        error: null,
      });

      await saveDashboardConfig(mockSupabase, mockManagerUser, mockConfig);
    });

    it('should handle database errors', async () => {
      mockSupabase.upsert.mockReturnThis();
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await saveDashboardConfig(mockSupabase, mockManagerUser, mockConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should save widget configuration', async () => {
      mockSupabase.upsert.mockImplementation((data: any) => {
        expect(data.config.widgets).toEqual(mockConfig.widgets);
        return mockSupabase;
      });

      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValue({
        data: { id: '123' },
        error: null,
      });

      await saveDashboardConfig(mockSupabase, mockManagerUser, mockConfig);
    });

    it('should save preferences', async () => {
      mockSupabase.upsert.mockImplementation((data: any) => {
        expect(data.config.preferences).toEqual(mockConfig.preferences);
        return mockSupabase;
      });

      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValue({
        data: { id: '123' },
        error: null,
      });

      await saveDashboardConfig(mockSupabase, mockManagerUser, mockConfig);
    });
  });
});
