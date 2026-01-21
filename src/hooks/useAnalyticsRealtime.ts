'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export interface AnalyticsRealtimeConfig {
  tenantId: string;
  enabled?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
  tables?: string[]; // Tables to subscribe to
}

export interface AnalyticsUpdate {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: any;
  old_record?: any;
  timestamp: string;
}

export interface UseAnalyticsRealtimeReturn {
  updates: AnalyticsUpdate[];
  lastUpdate: AnalyticsUpdate | null;
  isConnected: boolean;
  error: Error | null;
  updateCount: number;
  clearUpdates: () => void;
  refreshMetrics: () => void;
}

/**
 * useAnalyticsRealtime Hook
 *
 * Subscribes to Supabase realtime for analytics-related tables
 * Auto-refreshes metrics when new bookings, cancellations, or transactions occur
 *
 * @example
 * ```tsx
 * const { lastUpdate, isConnected, refreshMetrics } = useAnalyticsRealtime({
 *   tenantId: 'tenant-123',
 *   enabled: true,
 *   autoRefresh: true,
 *   tables: ['reservations', 'transactions']
 * });
 *
 * useEffect(() => {
 *   if (lastUpdate?.type === 'INSERT' && lastUpdate?.table === 'reservations') {
 *     console.log('New booking created:', lastUpdate.record);
 *   }
 * }, [lastUpdate]);
 * ```
 */
export function useAnalyticsRealtime({
  tenantId,
  enabled = true,
  autoRefresh = false,
  refreshInterval = 30000, // 30 seconds default
  tables = ['reservations', 'transactions', 'customers'],
}: AnalyticsRealtimeConfig): UseAnalyticsRealtimeReturn {
  const [updates, setUpdates] = useState<AnalyticsUpdate[]>([]);
  const [lastUpdate, setLastUpdate] = useState<AnalyticsUpdate | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [updateCount, setUpdateCount] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const metricsCallbackRef = useRef<(() => void) | null>(null);

  /**
   * Clear all updates
   */
  const clearUpdates = useCallback(() => {
    setUpdates([]);
    setUpdateCount(0);
  }, []);

  /**
   * Refresh metrics callback
   * This should be set by the parent component to trigger a metric refresh
   */
  const refreshMetrics = useCallback(() => {
    if (metricsCallbackRef.current) {
      metricsCallbackRef.current();
    }
  }, []);

  /**
   * Handle realtime update
   */
  const handleRealtimeUpdate = useCallback(
    (payload: any) => {
      const update: AnalyticsUpdate = {
        type: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
        table: payload.table,
        record: payload.new || payload.old,
        old_record: payload.old,
        timestamp: new Date().toISOString(),
      };

      setLastUpdate(update);
      setUpdates((prev) => [...prev.slice(-99), update]); // Keep last 100 updates
      setUpdateCount((prev) => prev + 1);

      // Auto-refresh metrics if enabled
      if (autoRefresh) {
        // Debounce refresh to avoid too many calls
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
        refreshTimeoutRef.current = setTimeout(() => {
          refreshMetrics();
        }, 1000); // Wait 1 second before refreshing
      }
    },
    [autoRefresh, refreshMetrics]
  );

  /**
   * Subscribe to realtime updates
   */
  useEffect(() => {
    if (!enabled || !tenantId) return;

    const supabase = getSupabaseBrowserClient();

    try {
      // Create a unique channel for this tenant
      const channelName = `analytics-${tenantId}`;
      const channel = supabase.channel(channelName);

      // Subscribe to each table
      tables.forEach((table) => {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: `tenant_id=eq.${tenantId}`,
          },
          handleRealtimeUpdate
        );
      });

      // Subscribe to the channel
      channel
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setError(null);
          } else if (status === 'CHANNEL_ERROR') {
            setIsConnected(false);
            setError(new Error('Failed to connect to realtime channel'));
          } else if (status === 'TIMED_OUT') {
            setIsConnected(false);
            setError(new Error('Realtime connection timed out'));
          } else if (status === 'CLOSED') {
            setIsConnected(false);
          }
        });

      channelRef.current = channel;

      // Cleanup function
      return () => {
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
        setIsConnected(false);
      };
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setIsConnected(false);
    }
  }, [enabled, tenantId, tables, handleRealtimeUpdate]);

  /**
   * Auto-refresh interval (optional)
   */
  useEffect(() => {
    if (!autoRefresh || !refreshInterval || !isConnected) return;

    const interval = setInterval(() => {
      refreshMetrics();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, isConnected, refreshMetrics]);

  return {
    updates,
    lastUpdate,
    isConnected,
    error,
    updateCount,
    clearUpdates,
    refreshMetrics,
  };
}

/**
 * Set the metrics refresh callback
 * Call this from your component to enable auto-refresh
 *
 * @example
 * ```tsx
 * const { refreshMetrics, setRefreshCallback } = useAnalyticsRealtime(config);
 *
 * useEffect(() => {
 *   setRefreshCallback(() => {
 *     // Fetch fresh metrics here
 *     fetchDashboardMetrics();
 *   });
 * }, []);
 * ```
 */
export function useAnalyticsRealtimeWithCallback(
  config: AnalyticsRealtimeConfig,
  onRefresh: () => void
): UseAnalyticsRealtimeReturn {
  const result = useAnalyticsRealtime(config);

  useEffect(() => {
    const ref = result as any;
    if (ref.metricsCallbackRef) {
      ref.metricsCallbackRef.current = onRefresh;
    }
  }, [onRefresh, result]);

  return result;
}

/**
 * Hook for monitoring specific analytics events
 * Filters updates to only those relevant for analytics
 *
 * @example
 * ```tsx
 * const { newBookings, cancelledBookings, newTransactions } = useAnalyticsEvents({
 *   tenantId: 'tenant-123',
 *   enabled: true,
 * });
 * ```
 */
export function useAnalyticsEvents(config: AnalyticsRealtimeConfig) {
  const { updates, isConnected, error } = useAnalyticsRealtime(config);

  const newBookings = updates.filter(
    (u) => u.type === 'INSERT' && u.table === 'reservations'
  );

  const cancelledBookings = updates.filter(
    (u) =>
      u.type === 'UPDATE' &&
      u.table === 'reservations' &&
      u.record?.status === 'cancelled'
  );

  const completedBookings = updates.filter(
    (u) =>
      u.type === 'UPDATE' &&
      u.table === 'reservations' &&
      u.record?.status === 'completed'
  );

  const newTransactions = updates.filter(
    (u) => u.type === 'INSERT' && u.table === 'transactions'
  );

  const newCustomers = updates.filter(
    (u) => u.type === 'INSERT' && u.table === 'customers'
  );

  return {
    newBookings,
    cancelledBookings,
    completedBookings,
    newTransactions,
    newCustomers,
    isConnected,
    error,
  };
}

/**
 * Hook for displaying realtime notifications
 * Returns formatted messages for UI display
 *
 * @example
 * ```tsx
 * const { notifications, dismissNotification } = useAnalyticsNotifications({
 *   tenantId: 'tenant-123',
 *   enabled: true,
 * });
 *
 * {notifications.map(notif => (
 *   <Toast key={notif.id} message={notif.message} onClose={() => dismissNotification(notif.id)} />
 * ))}
 * ```
 */
export interface AnalyticsNotification {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

export function useAnalyticsNotifications(config: AnalyticsRealtimeConfig) {
  const { lastUpdate } = useAnalyticsRealtime(config);
  const [notifications, setNotifications] = useState<AnalyticsNotification[]>([]);

  useEffect(() => {
    if (!lastUpdate) return;

    let message = '';
    let type: AnalyticsNotification['type'] = 'info';

    // Format message based on update type
    if (lastUpdate.table === 'reservations' && lastUpdate.type === 'INSERT') {
      message = `New booking created: ${lastUpdate.record.customer_name || 'Unknown'}`;
      type = 'success';
    } else if (
      lastUpdate.table === 'reservations' &&
      lastUpdate.type === 'UPDATE' &&
      lastUpdate.record.status === 'cancelled'
    ) {
      message = `Booking cancelled: ${lastUpdate.record.customer_name || 'Unknown'}`;
      type = 'warning';
    } else if (
      lastUpdate.table === 'reservations' &&
      lastUpdate.type === 'UPDATE' &&
      lastUpdate.record.status === 'completed'
    ) {
      message = `Booking completed: ${lastUpdate.record.customer_name || 'Unknown'}`;
      type = 'success';
    } else if (lastUpdate.table === 'transactions' && lastUpdate.type === 'INSERT') {
      const amount = lastUpdate.record.amount || 0;
      message = `New transaction: $${amount.toFixed(2)}`;
      type = 'info';
    } else if (lastUpdate.table === 'customers' && lastUpdate.type === 'INSERT') {
      message = `New customer registered: ${lastUpdate.record.customer_name || 'Unknown'}`;
      type = 'success';
    }

    if (message) {
      const notification: AnalyticsNotification = {
        id: `${lastUpdate.timestamp}-${Math.random()}`,
        type,
        message,
        timestamp: lastUpdate.timestamp,
      };

      setNotifications((prev) => [...prev.slice(-9), notification]); // Keep last 10

      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      }, 5000);
    }
  }, [lastUpdate]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return {
    notifications,
    dismissNotification,
  };
}
