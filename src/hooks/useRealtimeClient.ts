"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRealtimeClient, RealtimeClient, RealtimeStatus } from '@/lib/realtimeClient';
import type { RealtimeEvent } from '@/lib/realtimeClient';
import { useTenant } from '@/lib/supabase/tenant-context';

export function useRealtimeClient() {
  const tenantContext = useTenant() as unknown as Record<string, unknown>;
  const token = typeof tenantContext.token === 'string' ? tenantContext.token : undefined;
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [client, setClient] = useState<RealtimeClient | null>(null);

  useEffect(() => {
    // Use token from tenant context; avoid reading from localStorage to reduce XSS surface
    const c = getRealtimeClient(token || undefined);
    c.onStatus(setStatus);
    setStatus(c.getStatus());
    setClient(c);
    return () => { /* keep singleton; do not stop */ };
  }, [token]);

  // Stable identity so consumers can safely place `subscribe` in effect deps
  // without re-subscribing on every render.
  const subscribe = useCallback((type: string, handler: (event: RealtimeEvent) => void) => {
    client?.addHandler(type, handler);
    return () => client?.removeHandler(handler);
  }, [client]);

  return useMemo(() => ({ status, subscribe }), [status, subscribe]);
}
