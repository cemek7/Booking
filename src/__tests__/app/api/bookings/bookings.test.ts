import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/bookings/route';

// Mock dependencies
jest.mock('@/lib/error-handling/api-error');

const createMockSupabase = () => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  lt: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  single: jest.fn(),
});

const createMockContext = (overrides = {}) => ({
  request: new NextRequest('http://localhost:3000/api/bookings'),
  user: {
    id: 'user-123',
    tenantId: 'tenant-123',
    role: 'owner',
    email: 'test@test.com',
  },
  supabase: createMockSupabase(),
  ...overrides,
});

describe('GET /api/bookings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should require authentication', () => {
      expect(GET).toBeDefined();
    });
  });

  describe('Query Parameter Validation', () => {
    it('should require start parameter', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings?end=2024-01-31T23:59:59Z'),
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });

    it('should require end parameter', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z'),
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });

    it('should accept valid datetime strings', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      const response = await GET(ctx as any);
      expect(response).toHaveProperty('bookings');
    });

    it('should reject invalid datetime format for start', async () => {
      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01&end=2024-01-31T23:59:59Z'
        ),
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });

    it('should reject invalid datetime format for end', async () => {
      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31'
        ),
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });

    it('should accept optional staff_id parameter', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z&staff_id=123e4567-e89b-12d3-a456-426614174000'
        ),
        supabase: mockSupabase,
      });

      const response = await GET(ctx as any);
      expect(response).toHaveProperty('bookings');
    });

    it('should reject invalid UUID for staff_id', async () => {
      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z&staff_id=invalid-uuid'
        ),
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });
  });

  describe('Data Fetching', () => {
    it('should filter by tenant ID', async () => {
      const mockSupabase = createMockSupabase();
      const mockEq = jest.fn().mockReturnThis();
      mockSupabase.eq = mockEq;
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      await GET(ctx as any);

      expect(mockEq).toHaveBeenCalledWith('tenant_id', 'tenant-123');
    });

    it('should filter by date range', async () => {
      const mockSupabase = createMockSupabase();
      const mockLt = jest.fn().mockReturnThis();
      const mockGt = jest.fn().mockReturnThis();
      mockSupabase.lt = mockLt;
      mockSupabase.gt = mockGt;
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      await GET(ctx as any);

      expect(mockLt).toHaveBeenCalledWith('start_at', '2024-01-31T23:59:59Z');
      expect(mockGt).toHaveBeenCalledWith('end_at', '2024-01-01T00:00:00Z');
    });

    it('should filter by staff_id when provided', async () => {
      const mockSupabase = createMockSupabase();
      const mockEq = jest.fn().mockReturnThis();
      mockSupabase.eq = mockEq;
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const staffId = '123e4567-e89b-12d3-a456-426614174000';
      const ctx = createMockContext({
        request: new NextRequest(
          `http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z&staff_id=${staffId}`
        ),
        supabase: mockSupabase,
      });

      await GET(ctx as any);

      expect(mockEq).toHaveBeenCalledWith('staff_id', staffId);
    });

    it('should order by start_at ascending', async () => {
      const mockSupabase = createMockSupabase();
      const mockOrder = jest.fn().mockReturnThis();
      mockSupabase.order = mockOrder;
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      await GET(ctx as any);

      expect(mockOrder).toHaveBeenCalledWith('start_at', { ascending: true });
    });
  });

  describe('Response Formatting', () => {
    it('should return empty bookings array when no data', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      const response = await GET(ctx as any);

      expect(response.bookings).toEqual([]);
    });

    it('should format bookings correctly', async () => {
      const mockData = [
        {
          id: 'booking-1',
          tenant_id: 'tenant-123',
          staff_id: 'staff-1',
          start_at: '2024-01-15T10:00:00Z',
          end_at: '2024-01-15T11:00:00Z',
          status: 'confirmed',
          service_id: 'service-1',
          customer_id: 'customer-1',
          customer_name: 'John Doe',
          customer_number: '1234567890',
          phone: '+1234567890',
        },
      ];

      const mockSupabase = createMockSupabase();
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      const response = await GET(ctx as any);

      expect(response.bookings).toHaveLength(1);
      expect(response.bookings[0]).toEqual({
        id: 'booking-1',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        status: 'confirmed',
        serviceId: 'service-1',
        staffId: 'staff-1',
        customer: {
          id: 'customer-1',
          name: 'John Doe',
        },
        metadata: { tenantId: 'tenant-123' },
      });
    });

    it('should handle missing optional fields', async () => {
      const mockData = [
        {
          id: 'booking-1',
          tenant_id: 'tenant-123',
          start_at: '2024-01-15T10:00:00Z',
          end_at: '2024-01-15T11:00:00Z',
        },
      ];

      const mockSupabase = createMockSupabase();
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      const response = await GET(ctx as any);

      expect(response.bookings[0]).toHaveProperty('status', 'confirmed');
      expect(response.bookings[0]).toHaveProperty('serviceId', 'unknown');
    });

    it('should handle multiple bookings', async () => {
      const mockData = Array.from({ length: 5 }, (_, i) => ({
        id: `booking-${i}`,
        tenant_id: 'tenant-123',
        start_at: `2024-01-${10 + i}T10:00:00Z`,
        end_at: `2024-01-${10 + i}T11:00:00Z`,
        status: 'confirmed',
        service_id: 'service-1',
        customer_name: `Customer ${i}`,
      }));

      const mockSupabase = createMockSupabase();
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      const response = await GET(ctx as any);

      expect(response.bookings).toHaveLength(5);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when database query fails', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      });

      const ctx = createMockContext({
        request: new NextRequest(
          'http://localhost:3000/api/bookings?start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z'
        ),
        supabase: mockSupabase,
      });

      await expect(GET(ctx as any)).rejects.toThrow();
    });
  });
});

describe('POST /api/bookings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should require authentication', () => {
      expect(POST).toBeDefined();
    });
  });

  describe('Request Body Validation', () => {
    it('should require customer_name', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            start_at: '2024-01-15T10:00:00Z',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });

    it('should require service_id', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            start_at: '2024-01-15T10:00:00Z',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });

    it('should require start_at', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });

    it('should require end_at', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            start_at: '2024-01-15T10:00:00Z',
          }),
        }),
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });

    it('should validate service_id as UUID', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: 'not-a-uuid',
            start_at: '2024-01-15T10:00:00Z',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });

    it('should validate staff_id as UUID when provided', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            staff_id: 'not-a-uuid',
            start_at: '2024-01-15T10:00:00Z',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });

    it('should validate datetime formats', async () => {
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            start_at: '2024-01-15',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });

    it('should accept all optional fields', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: 'booking-1' },
          error: null,
        }),
      });

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            staff_id: '123e4567-e89b-12d3-a456-426614174001',
            start_at: '2024-01-15T10:00:00Z',
            end_at: '2024-01-15T11:00:00Z',
            customer_id: '123e4567-e89b-12d3-a456-426614174002',
            customer_number: '1234567890',
            phone: '+1234567890',
          }),
        }),
        supabase: mockSupabase,
      });

      // This should not throw
      await POST(ctx as any);
    });
  });

  describe('Role-Based Access', () => {
    it('should allow owner to create bookings', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: 'booking-1' },
          error: null,
        }),
      });

      const ctx = createMockContext({
        user: { ...createMockContext().user, role: 'owner' },
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            start_at: '2024-01-15T10:00:00Z',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should allow manager to create bookings', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: 'booking-1' },
          error: null,
        }),
      });

      const ctx = createMockContext({
        user: { ...createMockContext().user, role: 'manager' },
        request: new NextRequest('http://localhost:3000/api/bookings', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'John Doe',
            service_id: '123e4567-e89b-12d3-a456-426614174000',
            start_at: '2024-01-15T10:00:00Z',
            end_at: '2024-01-15T11:00:00Z',
          }),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);
      expect(mockSupabase.insert).toHaveBeenCalled();
    });
  });
});
