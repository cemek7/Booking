'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { authGet, authPost } from '@/lib/auth/auth-api-client';

interface Flag {
  id: string;
  review_id: string;
  reason: string;
  status: string;
}

/**
 * Self-contained review-moderation queue for owners/managers. Lists pending
 * report flags and lets a moderator take down the review or resolve/dismiss the
 * report. Drops into the dashboard with a one-line mount.
 */
export default function ReviewModerationQueue() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await authGet<{ flags: Flag[] }>('/api/moderation/reviews?status=pending');
    setFlags(res.data?.flags ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hide = async (reviewId: string) => {
    setBusy(true);
    try {
      await authPost(`/api/reviews/${reviewId}/moderate`, { action: 'hide' });
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (flagId: string, status: 'resolved' | 'dismissed') => {
    setBusy(true);
    try {
      await authPost(`/api/moderation/reviews/${flagId}`, { status });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-[#e7e3d7] bg-white p-4">
      <h3 className="text-sm font-semibold text-[#10211a]">Review moderation</h3>

      {loaded && flags.length === 0 && (
        <p className="mt-2 text-xs text-[#3a4a43]">No reports to review. 🎉</p>
      )}

      <ul className="mt-3 space-y-3">
        {flags.map((f) => (
          <li key={f.id} className="rounded border border-[#e7e3d7] p-3">
            <p className="text-xs text-[#3a4a43]">
              Reported review <span className="font-mono">{f.review_id}</span>
            </p>
            <p className="mt-1 text-sm text-[#10211a]">Reason: {f.reason}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => hide(f.review_id)} disabled={busy} className="rounded bg-red-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">
                Take down review
              </button>
              <button type="button" onClick={() => resolve(f.id, 'resolved')} disabled={busy} className="rounded border px-3 py-1.5 text-xs disabled:opacity-50">
                Resolve
              </button>
              <button type="button" onClick={() => resolve(f.id, 'dismissed')} disabled={busy} className="rounded border px-3 py-1.5 text-xs disabled:opacity-50">
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
