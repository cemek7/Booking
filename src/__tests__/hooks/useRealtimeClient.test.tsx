import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRealtimeClient } from '@/hooks/useRealtimeClient';
import type { RealtimeClient, RealtimeStatus } from '@/lib/realtimeClient';

// Mock RealtimeClient
const mockRealtimeClient = {
  getStatus: jest.fn(() => 'connecting' as RealtimeStatus),
  onStatus: jest.fn(),
  addHandler: jest.fn(),
  removeHandler: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
};

// Mock getRealtimeClient
jest.mock('@/lib/realtimeClient', () => ({
  getRealtimeClient: jest.fn(() => mockRealtimeClient),
  RealtimeClient: jest.fn(),
}));

// Mock tenant context
jest.mock('@/lib/supabase/tenant-context', () => ({
  useTenant: jest.fn(() => ({ token: null })),
}));

import { getRealtimeClient } from '@/lib/realtimeClient';
import { useTenant } from '@/lib/supabase/tenant-context';

const mockGetRealtimeClient = getRealtimeClient as jest.MockedFunction<typeof getRealtimeClient>;
const mockUseTenant = useTenant as jest.MockedFunction<typeof useTenant>;

describe('useRealtimeClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTenant.mockReturnValue({ token: null });
    mockRealtimeClient.getStatus.mockReturnValue('connecting');
    mockGetRealtimeClient.mockReturnValue(mockRealtimeClient as any);

    // Reset localStorage
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('Hook Initialization', () => {
    it('should initialize with connecting status', () => {
      mockRealtimeClient.getStatus.mockReturnValue('connecting');

      const { result } = renderHook(() => useRealtimeClient());

      expect(result.current.status).toBe('connecting');
    });

    it('should call getRealtimeClient on mount', () => {
      renderHook(() => useRealtimeClient());

      expect(mockGetRealtimeClient).toHaveBeenCalled();
    });

    it('should register status listener', () => {
      renderHook(() => useRealtimeClient());

      expect(mockRealtimeClient.onStatus).toHaveBeenCalled();
    });

    it('should get initial status from client', () => {
      mockRealtimeClient.getStatus.mockReturnValue('open');

      const { result } = renderHook(() => useRealtimeClient());

      expect(result.current.status).toBe('open');
      expect(mockRealtimeClient.getStatus).toHaveBeenCalled();
    });
  });

  describe('Token Handling', () => {
    it('should use token from tenant context', () => {
      mockUseTenant.mockReturnValue({ token: 'tenant-token-123' });

      renderHook(() => useRealtimeClient());

      expect(mockGetRealtimeClient).toHaveBeenCalledWith('tenant-token-123');
    });

    it('should pass undefined when no token available', () => {
      mockUseTenant.mockReturnValue({ token: null });

      renderHook(() => useRealtimeClient());

      expect(mockGetRealtimeClient).toHaveBeenCalledWith(undefined);
    });

    it('should recreate client when token changes', () => {
      mockUseTenant.mockReturnValue({ token: 'token-1' });

      const { rerender } = renderHook(() => useRealtimeClient());

      expect(mockGetRealtimeClient).toHaveBeenCalledWith('token-1');

      // Change token
      mockUseTenant.mockReturnValue({ token: 'token-2' });
      rerender();

      expect(mockGetRealtimeClient).toHaveBeenCalledWith('token-2');
      expect(mockGetRealtimeClient).toHaveBeenCalledTimes(2);
    });

    it('should handle token being undefined', () => {
      mockUseTenant.mockReturnValue({ token: undefined });

      renderHook(() => useRealtimeClient());

      expect(mockGetRealtimeClient).toHaveBeenCalledWith(undefined);
    });
  });

  describe('Status Updates', () => {
    it('should update status when client status changes', () => {
      let statusListener: (s: RealtimeStatus) => void = () => {};
      mockRealtimeClient.onStatus.mockImplementation((listener: any) => {
        statusListener = listener;
      });
      mockRealtimeClient.getStatus.mockReturnValue('connecting');

      const { result } = renderHook(() => useRealtimeClient());

      expect(result.current.status).toBe('connecting');

      // Simulate status change
      act(() => {
        statusListener('open');
      });

      expect(result.current.status).toBe('open');
    });

    it('should handle transition from connecting to open', () => {
      let statusListener: (s: RealtimeStatus) => void = () => {};
      mockRealtimeClient.onStatus.mockImplementation((listener: any) => {
        statusListener = listener;
      });
      mockRealtimeClient.getStatus.mockReturnValue('connecting');

      const { result } = renderHook(() => useRealtimeClient());

      act(() => {
        statusListener('open');
      });

      expect(result.current.status).toBe('open');
    });

    it('should handle transition to error state', () => {
      let statusListener: (s: RealtimeStatus) => void = () => {};
      mockRealtimeClient.onStatus.mockImplementation((listener: any) => {
        statusListener = listener;
      });
      mockRealtimeClient.getStatus.mockReturnValue('connecting');

      const { result } = renderHook(() => useRealtimeClient());

      act(() => {
        statusListener('error');
      });

      expect(result.current.status).toBe('error');
    });

    it('should handle transition to closed state', () => {
      let statusListener: (s: RealtimeStatus) => void = () => {};
      mockRealtimeClient.onStatus.mockImplementation((listener: any) => {
        statusListener = listener;
      });
      mockRealtimeClient.getStatus.mockReturnValue('open');

      const { result } = renderHook(() => useRealtimeClient());

      act(() => {
        statusListener('closed');
      });

      expect(result.current.status).toBe('closed');
    });

    it('should handle multiple status changes', () => {
      let statusListener: (s: RealtimeStatus) => void = () => {};
      mockRealtimeClient.onStatus.mockImplementation((listener: any) => {
        statusListener = listener;
      });
      mockRealtimeClient.getStatus.mockReturnValue('connecting');

      const { result } = renderHook(() => useRealtimeClient());

      act(() => {
        statusListener('open');
      });
      expect(result.current.status).toBe('open');

      act(() => {
        statusListener('closed');
      });
      expect(result.current.status).toBe('closed');

      act(() => {
        statusListener('connecting');
      });
      expect(result.current.status).toBe('connecting');
    });
  });

  describe('Subscribe Function', () => {
    it('should provide subscribe function', () => {
      const { result } = renderHook(() => useRealtimeClient());

      expect(result.current.subscribe).toBeDefined();
      expect(typeof result.current.subscribe).toBe('function');
    });

    it('should call addHandler when subscribing', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      result.current.subscribe('test-event', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('test-event', handler);
    });

    it('should return unsubscribe function', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      const unsubscribe = result.current.subscribe('test-event', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should call removeHandler when unsubscribing', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      const unsubscribe = result.current.subscribe('test-event', handler);
      unsubscribe();

      expect(mockRealtimeClient.removeHandler).toHaveBeenCalledWith(handler);
    });

    it('should handle multiple subscriptions', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      result.current.subscribe('event1', handler1);
      result.current.subscribe('event2', handler2);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('event1', handler1);
      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('event2', handler2);
      expect(mockRealtimeClient.addHandler).toHaveBeenCalledTimes(2);
    });

    it('should allow subscription immediately after mount', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      // Should work immediately after mount
      result.current.subscribe('test-event', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('test-event', handler);
    });

    it('should allow unsubscribe immediately after subscribe', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      const unsubscribe = result.current.subscribe('test-event', handler);
      unsubscribe();

      expect(mockRealtimeClient.removeHandler).toHaveBeenCalledWith(handler);
    });
  });

  describe('Cleanup', () => {
    it('should not call stop on unmount (singleton pattern)', () => {
      const { unmount } = renderHook(() => useRealtimeClient());

      unmount();

      // Singleton should remain active
      expect(mockRealtimeClient.stop).not.toHaveBeenCalled();
    });

    it('should preserve client across multiple hook instances', () => {
      const { unmount: unmount1 } = renderHook(() => useRealtimeClient());
      const { unmount: unmount2 } = renderHook(() => useRealtimeClient());

      unmount1();
      unmount2();

      // Client should only be created once (singleton)
      expect(mockGetRealtimeClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('Event Types', () => {
    it('should subscribe to booking events', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      result.current.subscribe('booking:created', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('booking:created', handler);
    });

    it('should subscribe to message events', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      result.current.subscribe('message:new', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('message:new', handler);
    });

    it('should subscribe to wildcard events', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      result.current.subscribe('*', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('*', handler);
    });

    it('should handle custom event types', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      result.current.subscribe('custom:event:type', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('custom:event:type', handler);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid token changes', () => {
      const { rerender } = renderHook(() => useRealtimeClient());

      mockUseTenant.mockReturnValue({ token: 'token-1' });
      rerender();

      mockUseTenant.mockReturnValue({ token: 'token-2' });
      rerender();

      mockUseTenant.mockReturnValue({ token: 'token-3' });
      rerender();

      expect(mockGetRealtimeClient).toHaveBeenCalledTimes(4); // Initial + 3 changes
    });

    it('should handle multiple event handlers for same event type', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      result.current.subscribe('test-event', handler1);
      result.current.subscribe('test-event', handler2);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('test-event', handler1);
      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('test-event', handler2);
      expect(mockRealtimeClient.addHandler).toHaveBeenCalledTimes(2);
    });

    it('should handle subscription after token change', () => {
      mockUseTenant.mockReturnValue({ token: 'token-1' });
      const { result, rerender } = renderHook(() => useRealtimeClient());

      mockUseTenant.mockReturnValue({ token: 'token-2' });
      rerender();

      const handler = jest.fn();
      result.current.subscribe('test-event', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('test-event', handler);
    });

    it('should handle empty event type string', () => {
      const { result } = renderHook(() => useRealtimeClient());
      const handler = jest.fn();

      result.current.subscribe('', handler);

      expect(mockRealtimeClient.addHandler).toHaveBeenCalledWith('', handler);
    });
  });

  describe('Status Return Value', () => {
    it('should return initial status from client', () => {
      let statusListener: (s: RealtimeStatus) => void = () => {};
      mockRealtimeClient.onStatus.mockImplementation((listener: any) => {
        statusListener = listener;
      });
      mockRealtimeClient.getStatus.mockReturnValue('open');

      const { result } = renderHook(() => useRealtimeClient());

      // Status is set via the listener, but initial value comes from getStatus
      expect(result.current.status).toBe('open');
    });

    it('should update status reactively', () => {
      let statusListener: (s: RealtimeStatus) => void = () => {};
      mockRealtimeClient.onStatus.mockImplementation((listener: any) => {
        statusListener = listener;
      });

      const { result } = renderHook(() => useRealtimeClient());

      const statusHistory: RealtimeStatus[] = [result.current.status];

      act(() => {
        statusListener('open');
      });
      statusHistory.push(result.current.status);

      act(() => {
        statusListener('closed');
      });
      statusHistory.push(result.current.status);

      expect(statusHistory).toEqual(['connecting', 'open', 'closed']);
    });
  });
});
