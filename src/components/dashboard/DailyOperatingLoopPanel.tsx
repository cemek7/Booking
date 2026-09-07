"use client";

import { useCallback, useEffect, useState } from 'react';
import { DailyOperatingLoop, type DailyOperatingLoopAction, type DailyOperatingLoopView } from './DailyOperatingLoop';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

export function DailyOperatingLoopPanel({ enabled }: { enabled: boolean }) {
  const headers = useAuthHeaders();
  const [loop, setLoop] = useState<DailyOperatingLoopView | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !headers) return;
    const response = await fetch('/api/operating-loop', { headers, cache: 'no-store' });
    if (!response.ok) return;
    setLoop(await response.json() as DailyOperatingLoopView);
  }, [enabled, headers]);

  useEffect(() => {
    if (!enabled || !headers) return;
    let cancelled = false;
    void fetch('/api/operating-loop', { headers, cache: 'no-store' }).then(async (response) => {
      if (!response.ok || cancelled) return;
      const nextLoop = await response.json() as DailyOperatingLoopView;
      if (!cancelled) setLoop(nextLoop);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [enabled, headers]);

  const onAction = useCallback(async (action: DailyOperatingLoopAction, objectiveId: string) => {
    if (!headers) return;
    const endpoint = action === 'execute'
      ? `/api/operating-loop/${objectiveId}/execute`
      : action === 'defer'
        ? `/api/operating-loop/${objectiveId}/defer`
        : `/api/operating-loop/${objectiveId}/dismiss`;
    const body = action === 'defer' ? { scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString() } : {};
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (response.ok) await refresh();
  }, [headers, refresh]);

  return loop ? <DailyOperatingLoop enabled={enabled} loop={loop} onAction={onAction} /> : null;
}
