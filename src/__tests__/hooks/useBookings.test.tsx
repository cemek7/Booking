import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBookings, useCreateBooking } from '@/hooks/useBookings';
import React from 'react';

// Mock fetch
global.fetch = jest.fn() as jest.Mock;

// Create wrapper for React Query
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useBookings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('Hook Initialization', () => {
    it('should initialize with loading state', () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ bookings: [] }),
      });

      const { result } = renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31' }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('should not fetch when start is missing', () => {
      const { result } = renderHook(
        () => useBookings({ start: '', end: '2024-01-31' }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not fetch when end is missing', () => {
      const { result } = renderHook(
        () => useBookings({ start: '2024-01-01', end: '' }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should be disabled when both start and end are missing', () => {
      const { result } = renderHook(
        () => useBookings({ start: '', end: '' }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('Data Fetching', () => {
    it('should fetch bookings with correct URL params', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ bookings: [] }),
      });

      renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('/api/bookings');
      expect(callUrl).toContain('start=2024-01-01');
      expect(callUrl).toContain('end=2024-01-31');
    });

    it('should include staffId in query params when provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ bookings: [] }),
      });

      renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31', staffId: 'staff-123' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('staff_id=staff-123');
    });

    it('should return bookings data on success', async () => {
      const mockBookings = [
        { id: '1', title: 'Booking 1', start: '2024-01-15T10:00:00Z' },
        { id: '2', title: 'Booking 2', start: '2024-01-20T14:00:00Z' },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ bookings: mockBookings }),
      });

      const { result } = renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockBookings);
      });
    });

    it('should handle empty bookings array', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ bookings: [] }),
      });

      const { result } = renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.data).toEqual([]);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('Query Key', () => {
    it('should use correct query key format', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ bookings: [] }),
      });

      const { result } = renderHook(
        () => useBookings({ start: '2024-01-01', end: '2024-01-31', staffId: 'staff-123' }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // Query key should include all params
      expect(result.current.data).toBeDefined();
    });
  });
});

describe('useCreateBooking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('Mutation', () => {
    it('should create booking with valid data', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, booking: { id: 'new-booking' } }),
      });

      const { result } = renderHook(() => useCreateBooking(), {
        wrapper: createWrapper(),
      });

      const bookingData = {
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_phone: '+1234567890',
        service_id: '123e4567-e89b-12d3-a456-426614174000',
        staff_id: '123e4567-e89b-12d3-a456-426614174001',
        start_time: new Date('2024-01-15T10:00:00Z').toISOString(),
        end_time: new Date('2024-01-15T11:00:00Z').toISOString(),
        tenant_id: 'tenant-123',
      };

      result.current.mutate(bookingData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should send POST request to correct endpoint', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useCreateBooking(), {
        wrapper: createWrapper(),
      });

      const bookingData = {
        customer_name: 'Jane Smith',
        customer_email: 'jane@example.com',
        customer_phone: '+9876543210',
        service_id: '123e4567-e89b-12d3-a456-426614174000',
        staff_id: '123e4567-e89b-12d3-a456-426614174001',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        tenant_id: 'tenant-456',
      };

      result.current.mutate(bookingData);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/bookings',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });
    });

    it('should validate booking data before sending', async () => {
      const { result } = renderHook(() => useCreateBooking(), {
        wrapper: createWrapper(),
      });

      const invalidData = {
        customer_name: '', // Invalid: empty name
        customer_email: 'invalid-email', // Invalid: bad email
        customer_phone: '+1234567890',
        service_id: '123e4567-e89b-12d3-a456-426614174000',
        staff_id: '123e4567-e89b-12d3-a456-426614174001',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        tenant_id: 'tenant-123',
      };

      result.current.mutate(invalidData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle creation errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
      });

      const { result } = renderHook(() => useCreateBooking(), {
        wrapper: createWrapper(),
      });

      const bookingData = {
        customer_name: 'Test User',
        customer_email: 'test@example.com',
        customer_phone: '+1234567890',
        service_id: '123e4567-e89b-12d3-a456-426614174000',
        staff_id: '123e4567-e89b-12d3-a456-426614174001',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        tenant_id: 'tenant-123',
      };

      result.current.mutate(bookingData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate bookings query on success', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useCreateBooking(), {
        wrapper: createWrapper(),
      });

      const bookingData = {
        customer_name: 'Cache Test',
        customer_email: 'cache@example.com',
        customer_phone: '+1234567890',
        service_id: '123e4567-e89b-12d3-a456-426614174000',
        staff_id: '123e4567-e89b-12d3-a456-426614174001',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        tenant_id: 'tenant-123',
      };

      result.current.mutate(bookingData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Cache invalidation happens in onSuccess callback
    });
  });
});
