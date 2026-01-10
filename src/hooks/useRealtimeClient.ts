"use client";
import { useEffect, useState } from 'react';
import { getRealtimeClient, RealtimeClient, RealtimeStatus } from '@/lib/realtimeClient';
import { useTenant } from '@/lib/supabase/tenant-context';

export function useRealtimeClient() {
  const { token } = useTenant() as any; // assuming tenant-context provides token; fallback below.
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [client, setClient] = useState<RealtimeClient | null>(null);

  useEffect(() => {
    const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('auth_token') || undefined : undefined);
    const c = getRealtimeClient(authToken || undefined);
    c.onStatus(setStatus);
    setStatus(c.getStatus());
    setClient(c);
    return () => { /* keep singleton; do not stop */ };
  }, [token]);

  function subscribe(type: string, handler: (e: any) => void) {
    client?.addHandler(type, handler);
    return () => client?.removeHandler(handler);
  }

  return { status, subscribe };
}
