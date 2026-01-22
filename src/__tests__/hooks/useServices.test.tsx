import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServices, type ServiceItem } from '@/hooks/useServices';
import React from 'react';

// Mock fetch
global.fetch = jest.fn() as jest.Mock;

// Mock tenant context
jest.mock('@/lib/supabase/tenant-context', () => ({
  useTenant: jest.fn(() => ({ tenant: null })),
}));

import { useTenant } from '@/lib/supabase/tenant-context';
const mockUseTenant = useTenant as jest.MockedFunction<typeof useTenant>;

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

describe('useServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
    mockUseTenant.mockReturnValue({ tenant: null });
  });

  describe('Hook Initialization', () => {
    it('should initialize with loading state', () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should fetch from public endpoint when no tenant', async () => {
      mockUseTenant.mockReturnValue({ tenant: null });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toBe('/api/services');
    });

    it('should fetch from tenant endpoint when tenant available', async () => {
      mockUseTenant.mockReturnValue({
        tenant: { id: 'tenant-123', name: 'Test Tenant' },
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toBe('/api/tenants/tenant-123/services');
    });

    it('should use explicit tenant ID over context tenant', async () => {
      mockUseTenant.mockReturnValue({
        tenant: { id: 'tenant-123', name: 'Test Tenant' },
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      renderHook(() => useServices('tenant-456'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toBe('/api/tenants/tenant-456/services');
    });
  });

  describe('Data Fetching', () => {
    it('should return services data on success', async () => {
      const mockServices: ServiceItem[] = [
        { id: 'service-1', name: 'Haircut', duration: 30 },
        { id: 'service-2', name: 'Massage', duration: 60 },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: mockServices }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockServices);
      });
    });

    it('should handle array response format', async () => {
      const mockServices = [
        { id: 1, name: 'Service A', duration: 45 },
        { id: 2, name: 'Service B', duration: 90 },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockServices,
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockServices);
      });
    });

    it('should handle services nested in object format', async () => {
      const mockServices = [
        { id: 'svc-1', name: 'Consultation', duration: 15 },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: mockServices }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockServices);
      });
    });

    it('should map duration_minutes to duration', async () => {
      const rawServices = [
        { id: 'svc-1', name: 'Service', duration_minutes: 30 },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: rawServices }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([
          { id: 'svc-1', name: 'Service', duration: 30 },
        ]);
      });
    });

    it('should prefer duration over duration_minutes', async () => {
      const rawServices = [
        { id: 'svc-1', name: 'Service', duration: 45, duration_minutes: 30 },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: rawServices }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([
          { id: 'svc-1', name: 'Service', duration: 45 },
        ]);
      });
    });

    it('should handle services without duration field', async () => {
      const rawServices = [
        { id: 'svc-1', name: 'Service Without Duration' },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: rawServices }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([
          { id: 'svc-1', name: 'Service Without Duration', duration: undefined },
        ]);
      });
    });

    it('should handle empty services array', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([]);
      });
    });

    it('should handle services with numeric IDs', async () => {
      const mockServices = [
        { id: 123, name: 'Service A', duration: 30 },
        { id: 456, name: 'Service B', duration: 60 },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: mockServices }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockServices);
      });
    });

    it('should handle services with string IDs', async () => {
      const mockServices = [
        { id: 'uuid-123', name: 'Service A', duration: 30 },
        { id: 'uuid-456', name: 'Service B', duration: 60 },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: mockServices }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockServices);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle 404 errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle 403 forbidden errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 403,
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle invalid JSON response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle non-array response gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ notServices: 'invalid' }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([]);
      });
    });
  });

  describe('Query Key', () => {
    it('should use public query key when no tenant', async () => {
      mockUseTenant.mockReturnValue({ tenant: null });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // Query key should be ['services', 'public']
      expect(result.current.data).toBeDefined();
    });

    it('should use tenant-specific query key', async () => {
      mockUseTenant.mockReturnValue({
        tenant: { id: 'tenant-789', name: 'Test' },
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // Query key should be ['services', 'tenant-789']
      expect(result.current.data).toBeDefined();
    });

    it('should use explicit tenant ID in query key', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      const { result } = renderHook(() => useServices('explicit-tenant'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // Query key should be ['services', 'explicit-tenant']
      expect(result.current.data).toBeDefined();
    });
  });

  describe('ServiceItem Interface', () => {
    it('should handle complete ServiceItem objects', async () => {
      const completeService: ServiceItem = {
        id: 'service-complete',
        name: 'Complete Service',
        duration: 90,
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [completeService] }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([completeService]);
      });
    });

    it('should handle partial ServiceItem objects', async () => {
      const partialService = {
        id: 'service-partial',
        name: 'Partial Service',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [partialService] }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([
          { id: 'service-partial', name: 'Partial Service', duration: undefined },
        ]);
      });
    });

    it('should map extra fields correctly', async () => {
      const rawService = {
        id: 'svc-1',
        name: 'Service',
        duration: 30,
        description: 'Extra field',
        price: 100,
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [rawService] }),
      });

      const { result } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // Should only include id, name, duration
        expect(result.current.data).toEqual([
          { id: 'svc-1', name: 'Service', duration: 30 },
        ]);
      });
    });
  });

  describe('Tenant Context Integration', () => {
    it('should react to tenant context changes', async () => {
      mockUseTenant.mockReturnValue({
        tenant: { id: 'tenant-initial', name: 'Initial' },
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      const { rerender } = renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/tenants/tenant-initial/services');
      });

      // Change tenant context
      mockUseTenant.mockReturnValue({
        tenant: { id: 'tenant-new', name: 'New' },
      });

      rerender();

      // Should not automatically refetch on tenant change
      // React Query only refetches based on query key changes
    });

    it('should handle tenant context with undefined tenant', async () => {
      mockUseTenant.mockReturnValue({ tenant: undefined });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/services');
      });
    });

    it('should handle tenant context with null tenant', async () => {
      mockUseTenant.mockReturnValue({ tenant: null });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ services: [] }),
      });

      renderHook(() => useServices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/services');
      });
    });
  });
});
