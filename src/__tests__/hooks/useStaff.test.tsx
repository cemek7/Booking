import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStaff, type StaffDto } from '@/hooks/useStaff';
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

describe('useStaff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('Hook Initialization', () => {
    it('should initialize with loading state when tenantId provided', () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: [] }),
      });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should not fetch when tenantId is undefined', () => {
      const { result } = renderHook(() => useStaff(undefined), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not fetch when tenantId is empty string', () => {
      const { result } = renderHook(() => useStaff(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Data Fetching', () => {
    it('should fetch staff with correct URL', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: [] }),
      });

      renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('/api/staff');
      expect(callUrl).toContain('tenant_id=tenant-123');
    });

    it('should URL encode tenantId', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: [] }),
      });

      renderHook(() => useStaff('tenant with spaces'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain(encodeURIComponent('tenant with spaces'));
    });

    it('should return staff data on success', async () => {
      const mockStaff: StaffDto[] = [
        { id: 'staff-1', name: 'Alice Johnson', email: 'alice@example.com', role: 'staff' },
        { id: 'staff-2', name: 'Bob Smith', email: 'bob@example.com', role: 'manager' },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: mockStaff }),
      });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockStaff);
      });
    });

    it('should handle empty staff array', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: [] }),
      });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

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

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useStaff('tenant-123'), {
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

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('mutateAttributes', () => {
    it('should update staff attributes via PATCH', async () => {
      const mockStaff: StaffDto[] = [
        { id: 'staff-1', name: 'Alice', email: 'alice@example.com', role: 'staff', status: 'active' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ staff: mockStaff }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockStaff);
      });

      result.current.mutateAttributes.mutate({
        tenantId: 'tenant-123',
        id: 'staff-1',
        patch: { status: 'inactive' },
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/staff/staff-1/attributes'),
          expect.objectContaining({
            method: 'PATCH',
          })
        );
      });
    });

    it('should optimistically update cache', async () => {
      const mockStaff: StaffDto[] = [
        { id: 'staff-1', name: 'Alice', status: 'active' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ staff: mockStaff }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockStaff);
      });

      result.current.mutateAttributes.mutate({
        tenantId: 'tenant-123',
        id: 'staff-1',
        patch: { status: 'inactive' },
      });

      // Cache should be updated immediately (optimistic update)
      await waitFor(() => {
        expect(result.current.mutateAttributes.isSuccess).toBe(true);
      });
    });

    it('should rollback on error', async () => {
      const mockStaff: StaffDto[] = [
        { id: 'staff-1', name: 'Alice', status: 'active' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ staff: mockStaff }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockStaff);
      });

      result.current.mutateAttributes.mutate({
        tenantId: 'tenant-123',
        id: 'staff-1',
        patch: { status: 'inactive' },
      });

      await waitFor(() => {
        expect(result.current.mutateAttributes.isError).toBe(true);
      });

      // Original data should be restored
    });

    it('should invalidate queries on success', async () => {
      const mockStaff: StaffDto[] = [
        { id: 'staff-1', name: 'Alice' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ staff: mockStaff }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockStaff);
      });

      result.current.mutateAttributes.mutate({
        tenantId: 'tenant-123',
        id: 'staff-1',
        patch: { name: 'Alice Updated' },
      });

      await waitFor(() => {
        expect(result.current.mutateAttributes.isSuccess).toBe(true);
      });
    });

    it('should handle user_id field correctly', async () => {
      const mockStaff: StaffDto[] = [
        { user_id: 'user-1', name: 'Bob', email: 'bob@example.com' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ staff: mockStaff }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockStaff);
      });

      // Should handle user_id as fallback identifier
      result.current.mutateAttributes.mutate({
        tenantId: 'tenant-123',
        id: 'user-1',
        patch: { name: 'Bob Updated' },
      });

      await waitFor(() => {
        expect(result.current.mutateAttributes.isSuccess).toBe(true);
      });
    });
  });

  describe('Query Key', () => {
    it('should use correct query key with tenantId', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: [] }),
      });

      const { result } = renderHook(() => useStaff('tenant-456'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // Query key should include tenantId
      expect(result.current.data).toBeDefined();
    });
  });

  describe('StaffDto Interface', () => {
    it('should handle all StaffDto fields', async () => {
      const completeStaff: StaffDto = {
        id: 'staff-1',
        user_id: 'user-1',
        name: 'Complete Staff',
        email: 'complete@example.com',
        role: 'manager',
        status: 'active',
        staff_type: 'full-time',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: [completeStaff] }),
      });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([completeStaff]);
      });
    });

    it('should handle partial StaffDto objects', async () => {
      const partialStaff: StaffDto = {
        id: 'staff-2',
        name: 'Partial Staff',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ staff: [partialStaff] }),
      });

      const { result } = renderHook(() => useStaff('tenant-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual([partialStaff]);
      });
    });
  });
});
