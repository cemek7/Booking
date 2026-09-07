'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

type Session = {
  id: string;
  location_id?: string | null;
  status: string;
  snapshot_at?: string | null;
  approved_at?: string | null;
  shrinkage_value_cents?: number | null;
  created_at?: string | null;
};

type Item = {
  id: string;
  product_id?: string | null;
  variant_id?: string | null;
  expected_quantity: number;
  counted_quantity?: number | null;
  variance?: number | null;
  variance_value_cents?: number | null;
  flags?: Record<string, unknown> | null;
};

function formatMoney(cents: number | null | undefined) {
  return `₦${Math.round(Number(cents ?? 0) / 100).toLocaleString()}`;
}

export default function OwnerStockCountsClient() {
  const headers = useAuthHeaders();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [sessions, selectedId]
  );

  useEffect(() => {
    let active = true;
    if (!headers) return;

    authFetch<{ sessions: Session[] }>('/api/owner/stock-counts', { headers })
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setError(res.error.message);
          return;
        }
        const next = res.data?.sessions ?? [];
        setSessions(next);
        setLoadingItems(Boolean(next[0]));
        setSelectedId((current) => current ?? next[0]?.id ?? null);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load stock count sessions');
      })
      .finally(() => {
        if (!active) return;
        setLoadingSessions(false);
      });

    return () => {
      active = false;
    };
  }, [headers]);

  useEffect(() => {
    let active = true;
    if (!headers || !selectedId) return;

    authFetch<{ session: Session; items: Item[] }>(`/api/owner/stock-counts/${selectedId}`, { headers })
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setError(res.error.message);
          return;
        }
        setItems(res.data?.items ?? []);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load stock count details');
      })
      .finally(() => {
        if (!active) return;
        setLoadingItems(false);
      });

    return () => {
      active = false;
    };
  }, [headers, selectedId]);

  async function createSession() {
    if (!headers) return;
    setCreating(true);
    const res = await authFetch<{ session: Session }>('/api/owner/stock-counts', {
      method: 'POST',
      headers,
      body: { location_id: null },
    });
    setCreating(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    const next = res.data?.session;
    if (!next) return;
    setLoadingItems(true);
    setSessions((current) => [next, ...current]);
    setSelectedId(next.id);
    setError(null);
  }

  async function updateCount(itemId: string, countedQuantity: number) {
    if (!headers || !selectedId) return;
    const res = await authFetch<{ item: Item }>(`/api/owner/stock-counts/${selectedId}`, {
      method: 'PATCH',
      headers,
      body: { item_id: itemId, counted_quantity: countedQuantity },
    });
    if (res.error) {
      setError(res.error.message);
      return;
    }
    const next = res.data?.item;
    if (!next) return;
    setItems((current) => current.map((item) => (item.id === next.id ? { ...item, ...next } : item)));
    setError(null);
  }

  async function approveSelected() {
    if (!headers || !selectedId) return;
    setApproving(true);
    const res = await authFetch<{ session: Session }>(`/api/owner/stock-counts/${selectedId}/approve`, {
      method: 'POST',
      headers,
    });
    setApproving(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    const next = res.data?.session;
    if (!next) return;
    setSessions((current) => current.map((session) => (session.id === next.id ? { ...session, ...next } : session)));
    setError(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Inventory control</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Stock counts</h1>
          <p className="mt-1 text-sm text-slate-600">
            Count what is physically on hand, compare it against the ledger snapshot, and post clean adjustments.
          </p>
        </div>
        <button
          type="button"
          onClick={createSession}
          disabled={creating}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? 'Starting…' : 'Start stock count'}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Sessions</h2>
            <p className="text-sm text-slate-500">One active count per location.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Shrinkage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingSessions ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={3}>Loading sessions…</td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={3}>No stock counts yet.</td></tr>
                ) : sessions.map((session) => (
                  <tr
                    key={session.id}
                    className={`cursor-pointer transition hover:bg-slate-50 ${selectedId === session.id ? 'bg-slate-50' : ''}`}
                    onClick={() => {
                      setLoadingItems(true);
                      setSelectedId(session.id);
                    }}
                  >
                    <td className="px-4 py-3 text-slate-700">
                      {session.snapshot_at ? new Date(session.snapshot_at).toLocaleString() : 'Draft'}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{session.status}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(session.shrinkage_value_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Selected count</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                {selectedSession ? selectedSession.status : 'Choose a stock count'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Enter physical quantities. Uncounted rows are skipped during approval.
              </p>
            </div>
            {selectedSession ? (
              <button
                type="button"
                onClick={approveSelected}
                disabled={approving}
                className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approving ? 'Approving…' : 'Approve count'}
              </button>
            ) : null}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Expected</th>
                  <th className="px-4 py-3">Counted</th>
                  <th className="px-4 py-3">Variance</th>
                  <th className="px-4 py-3">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingItems ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={5}>Loading items…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td className="px-4 py-5 text-slate-500" colSpan={5}>Pick a session to view count items.</td></tr>
                ) : items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="font-medium text-slate-900">{item.product_id ?? 'Unknown product'}</div>
                      {item.variant_id ? <div className="text-xs text-slate-500">Variant {item.variant_id}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{item.expected_quantity}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        defaultValue={item.counted_quantity ?? ''}
                        className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        onBlur={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isInteger(next) || next < 0) return;
                          if (item.counted_quantity === next) return;
                          updateCount(item.id, next);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{item.variance ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(item.variance_value_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
