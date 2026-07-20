'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

interface ReconciliationRun {
  id: string;
  business_date: string;
  status: string;
  currency: string;
  expected_revenue_cents: number;
  adjusted_expected_cents: number;
  recorded_payments_cents: number;
  approved_outstanding_cents: number;
  revenue_gap_cents: number;
  delivered_at?: string | null;
  computed_at?: string | null;
}

interface ReconciliationItem {
  id: string;
  item_type: string;
  severity: 'low' | 'medium' | 'high';
  entity_type?: string | null;
  entity_id?: string | null;
  expected_cents?: number | null;
  actual_cents?: number | null;
  difference_cents?: number | null;
  detail?: Record<string, unknown>;
}

function formatMoney(cents: number | null | undefined) {
  return `₦${Math.round(Number(cents ?? 0) / 100).toLocaleString()}`;
}

function severityTone(severity: ReconciliationItem['severity']) {
  if (severity === 'high') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (severity === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export default function CloseReportsClient() {
  const headers = useAuthHeaders();
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<ReconciliationRun | null>(null);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!headers) return;

    authFetch<{ runs: ReconciliationRun[] }>('/api/owner/close-reports', { headers })
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setError(res.error.message);
          return;
        }

        const nextRuns = (res.data?.runs ?? []) as ReconciliationRun[];
        setRuns(nextRuns);
        setError(null);
        if (nextRuns[0]) {
          setSelectedDate((current) => current ?? nextRuns[0].business_date);
        }
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load close reports');
      })
      .finally(() => {
        if (!active) return;
        setLoadingRuns(false);
      });

    return () => {
      active = false;
    };
  }, [headers]);

  useEffect(() => {
    let active = true;
    if (!headers || !selectedDate) return;

    authFetch<{ run: ReconciliationRun; items: ReconciliationItem[] }>(
      `/api/owner/close-reports/${selectedDate}`,
      { headers }
    )
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setError(res.error.message);
          setSelectedRun(null);
          setItems([]);
          return;
        }

        setSelectedRun((res.data?.run ?? null) as ReconciliationRun | null);
        setItems((res.data?.items ?? []) as ReconciliationItem[]);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setError('Failed to load close report details');
      })
      .finally(() => {
        if (!active) return;
        setLoadingDetail(false);
      });

    return () => {
      active = false;
    };
  }, [headers, selectedDate]);

  const selectedGapTone = useMemo(() => {
    const gap = Math.abs(selectedRun?.revenue_gap_cents ?? 0);
    return gap > 0 ? 'text-rose-700' : 'text-emerald-700';
  }, [selectedRun]);

  async function recomputeSelected() {
    if (!selectedDate) return;
    setRecomputeMessage(null);
    setLoadingDetail(true);

    const response = await authFetch<{ runId: string }>(
      `/api/owner/close-reports/${selectedDate}/recompute`,
      { method: 'POST', headers }
    );

    if (response.error) {
      setRecomputeMessage(response.error.message);
      return;
    }

    setRecomputeMessage('Close report recomputed.');
    setSelectedDate(selectedDate);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Revenue assurance</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Daily close reports</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review expected revenue, recorded payments, and unresolved gaps before the day closes.
          </p>
        </div>
        <button
          type="button"
          onClick={recomputeSelected}
          disabled={!selectedDate}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Recompute selected day
        </button>
      </div>

      {recomputeMessage ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {recomputeMessage}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Archive</h2>
            <p className="text-sm text-slate-500">Last 90 business days.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Expected</th>
                  <th className="px-4 py-3">Recorded</th>
                  <th className="px-4 py-3">Gap</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingRuns ? (
                  <tr>
                    <td className="px-4 py-5 text-slate-500" colSpan={5}>
                      Loading close reports…
                    </td>
                  </tr>
                ) : runs.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-slate-500" colSpan={5}>
                      No close reports yet. Recompute a day to seed the archive.
                    </td>
                  </tr>
                ) : (
                  runs.map((run) => {
                    const selected = selectedDate === run.business_date;
                    return (
                      <tr
                        key={run.id}
                        className={`cursor-pointer transition hover:bg-slate-50 ${selected ? 'bg-slate-50' : ''}`}
                        onClick={() => {
                          setLoadingDetail(true);
                          setSelectedDate(run.business_date);
                        }}
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">{run.business_date}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMoney(run.expected_revenue_cents)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMoney(run.recorded_payments_cents)}</td>
                        <td className={`px-4 py-3 font-medium ${Math.abs(run.revenue_gap_cents) > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {formatMoney(run.revenue_gap_cents)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{run.status}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Selected day</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                {selectedRun?.business_date ?? 'Choose a close report'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Review unresolved differences before they become month-end cleanup.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${selectedGapTone} bg-slate-50`}>
              {selectedRun ? formatMoney(selectedRun.revenue_gap_cents) : '—'}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Expected revenue</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {formatMoney(selectedRun?.expected_revenue_cents)}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Recorded payments</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {formatMoney(selectedRun?.recorded_payments_cents)}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Adjusted expected</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {formatMoney(selectedRun?.adjusted_expected_cents)}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Approved outstanding</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {formatMoney(selectedRun?.approved_outstanding_cents)}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Items requiring review</h3>
              <p className="text-sm text-slate-500">These are the rows the close engine could not reconcile automatically.</p>
            </div>

            {loadingDetail ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Loading report details…
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-sm text-emerald-700">
                No review items for this day.
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.item_type.replace(/_/g, ' ')}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {item.entity_type ?? 'entity'} {item.entity_id ? `• ${item.entity_id}` : ''}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${severityTone(item.severity)}`}>
                        {item.severity}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Expected</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">{formatMoney(item.expected_cents)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Actual</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">{formatMoney(item.actual_cents)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Difference</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">{formatMoney(item.difference_cents)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
