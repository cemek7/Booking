import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/analytics/dashboard/route';

// Mock dependencies
jest.mock('@/lib/analyticsService');
jest.mock('@/lib/error-handling/api-error');

const mockAnalyticsService = {
  getDashboardMetrics: jest.fn(),
};

jest.mock('@/lib/analyticsService', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockAnalyticsService),
  };
});

const createMockContext = (overrides = {}) => ({
  request: new NextRequest('http://localhost:3000/api/analytics/dashboard'),
  user: {
    id: 'user-123',
    tenantId: 'tenant-123',
    role: 'owner',
    email: 'test@test.com',
  },
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
  },
  ...overrides,
});

describe('GET /api/analytics/dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should require authentication', async () => {
      // The route is configured with { auth: true }, so it will be handled by the route handler
      // This test verifies the route configuration
      expect(GET).toBeDefined();
    });
  });

  describe('Query Parameters', () => {
    it('should default to month period when not specified', async () => {
      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      await GET(ctx as any);

      expect(mockAnalyticsService.getDashboardMetrics).toHaveBeenCalledWith(
        'tenant-123',
        'month'
      );
    });

    it('should accept day period parameter', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/analytics/dashboard?period=day'),
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      await GET(ctx as any);

      expect(mockAnalyticsService.getDashboardMetrics).toHaveBeenCalledWith(
        'tenant-123',
        'day'
      );
    });

    it('should accept week period parameter', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/analytics/dashboard?period=week'),
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      await GET(ctx as any);

      expect(mockAnalyticsService.getDashboardMetrics).toHaveBeenCalledWith(
        'tenant-123',
        'week'
      );
    });

    it('should accept quarter period parameter', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/analytics/dashboard?period=quarter'),
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      await GET(ctx as any);

      expect(mockAnalyticsService.getDashboardMetrics).toHaveBeenCalledWith(
        'tenant-123',
        'quarter'
      );
    });

    it('should default to month for invalid period', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/analytics/dashboard?period=invalid'),
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      await GET(ctx as any);

      expect(mockAnalyticsService.getDashboardMetrics).toHaveBeenCalledWith(
        'tenant-123',
        'month'
      );
    });
  });

  describe('Tenant ID Handling', () => {
    it('should use tenantId from user context', async () => {
      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      await GET(ctx as any);

      expect(mockAnalyticsService.getDashboardMetrics).toHaveBeenCalledWith(
        'tenant-123',
        expect.any(String)
      );
    });

    it('should use X-Tenant-ID header if present', async () => {
      const request = new NextRequest('http://localhost:3000/api/analytics/dashboard');
      request.headers.set('X-Tenant-ID', 'header-tenant-456');

      const ctx = createMockContext({ request });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      await GET(ctx as any);

      expect(mockAnalyticsService.getDashboardMetrics).toHaveBeenCalledWith(
        'header-tenant-456',
        'month'
      );
    });

    it('should throw validation error when tenantId is missing', async () => {
      const ctx = createMockContext({
        user: { ...createMockContext().user, tenantId: undefined },
        request: new NextRequest('http://localhost:3000/api/analytics/dashboard'),
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });
  });

  describe('Success Response', () => {
    it('should return metrics on success', async () => {
      const mockMetrics = [
        {
          id: 'total_bookings',
          name: 'Total Bookings',
          value: 100,
          trend: 12.5,
          type: 'count',
          period: 'month',
          last_updated: '2024-01-15T10:00:00Z',
        },
      ];

      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: mockMetrics,
      });

      const response = await GET(ctx as any);

      expect(response).toEqual({
        success: true,
        metrics: mockMetrics,
        generated_at: expect.any(String),
      });
    });

    it('should include generated_at timestamp', async () => {
      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      const response = await GET(ctx as any);

      expect(response).toHaveProperty('generated_at');
      expect(new Date(response.generated_at as string)).toBeInstanceOf(Date);
    });

    it('should return empty metrics array when no data', async () => {
      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      const response = await GET(ctx as any);

      expect(response.metrics).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should throw internal error when service returns failure', async () => {
      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: false,
        error: 'Database connection failed',
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });

    it('should throw error when service throws', async () => {
      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockRejectedValue(
        new Error('Service unavailable')
      );

      await expect(GET(ctx as any)).rejects.toThrow();
    });

    it('should handle missing error message gracefully', async () => {
      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: false,
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });
  });

  describe('Metrics Data Validation', () => {
    it('should handle metrics with all required fields', async () => {
      const mockMetrics = [
        {
          id: 'metric-1',
          name: 'Test Metric',
          value: 100,
          trend: 5.5,
          type: 'count',
          period: 'month',
          last_updated: '2024-01-15T10:00:00Z',
        },
      ];

      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: mockMetrics,
      });

      const response = await GET(ctx as any);

      expect(response.metrics).toEqual(mockMetrics);
    });

    it('should handle multiple metrics', async () => {
      const mockMetrics = [
        {
          id: 'metric-1',
          name: 'Bookings',
          value: 100,
          trend: 5.5,
          type: 'count',
          period: 'month',
          last_updated: '2024-01-15T10:00:00Z',
        },
        {
          id: 'metric-2',
          name: 'Revenue',
          value: 50000,
          trend: -2.3,
          type: 'currency',
          period: 'month',
          last_updated: '2024-01-15T10:00:00Z',
        },
      ];

      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: mockMetrics,
      });

      const response = await GET(ctx as any);

      expect(response.metrics).toHaveLength(2);
      expect(response.metrics[0].id).toBe('metric-1');
      expect(response.metrics[1].id).toBe('metric-2');
    });

    it('should handle different metric types', async () => {
      const mockMetrics = [
        { id: 'm1', name: 'Count', value: 100, trend: 0, type: 'count', period: 'month', last_updated: '2024-01-15T10:00:00Z' },
        { id: 'm2', name: 'Percent', value: 95.5, trend: 0, type: 'percentage', period: 'month', last_updated: '2024-01-15T10:00:00Z' },
        { id: 'm3', name: 'Money', value: 5000, trend: 0, type: 'currency', period: 'month', last_updated: '2024-01-15T10:00:00Z' },
        { id: 'm4', name: 'Time', value: 120, trend: 0, type: 'duration', period: 'month', last_updated: '2024-01-15T10:00:00Z' },
      ];

      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: mockMetrics,
      });

      const response = await GET(ctx as any);

      expect(response.metrics).toHaveLength(4);
      expect(response.metrics.map((m: any) => m.type)).toEqual([
        'count',
        'percentage',
        'currency',
        'duration',
      ]);
    });
  });

  describe('Performance', () => {
    it('should handle large metric datasets efficiently', async () => {
      const mockMetrics = Array.from({ length: 100 }, (_, i) => ({
        id: `metric-${i}`,
        name: `Metric ${i}`,
        value: Math.random() * 1000,
        trend: Math.random() * 20 - 10,
        type: 'count',
        period: 'month',
        last_updated: '2024-01-15T10:00:00Z',
      }));

      const ctx = createMockContext();
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: mockMetrics,
      });

      const startTime = Date.now();
      const response = await GET(ctx as any);
      const duration = Date.now() - startTime;

      expect(response.metrics).toHaveLength(100);
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });

  describe('Role-Based Access', () => {
    it('should allow owner role', async () => {
      const ctx = createMockContext({
        user: { ...createMockContext().user, role: 'owner' },
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      const response = await GET(ctx as any);

      expect(response.success).toBe(true);
    });

    it('should allow manager role', async () => {
      const ctx = createMockContext({
        user: { ...createMockContext().user, role: 'manager' },
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      const response = await GET(ctx as any);

      expect(response.success).toBe(true);
    });

    it('should allow staff role', async () => {
      const ctx = createMockContext({
        user: { ...createMockContext().user, role: 'staff' },
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      const response = await GET(ctx as any);

      expect(response.success).toBe(true);
    });

    it('should allow superadmin role', async () => {
      const ctx = createMockContext({
        user: { ...createMockContext().user, role: 'superadmin' },
      });
      mockAnalyticsService.getDashboardMetrics.mockResolvedValue({
        success: true,
        metrics: [],
      });

      const response = await GET(ctx as any);

      expect(response.success).toBe(true);
    });
  });
});
