"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Coins, Gauge, RefreshCw, Sparkles } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';
import { useTenantCurrency } from '@/hooks/useTenantCurrency';

interface UsageDay { day: string; bookings: number; deposits: number; llm_tokens: number; }
interface Quota { allowed: boolean; reason?: string; remaining?: number | null; quota?: number | null; }
interface UsageResponse { window: UsageDay[]; quota: Quota | null; }

interface UsagePanelProps { tenantId: string; className?: string; }

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export const UsagePanel: React.FC<UsagePanelProps> = ({ tenantId, className }) => {
  const { format: formatMoney } = useTenantCurrency();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await authFetch<UsageResponse>(`/api/usage?tenant_id=${encodeURIComponent(tenantId)}`);
    if (r.error || !r.data) {
      setError(r.error?.message || 'Could not load usage.');
      setData(null);
    } else {
      setData(r.data);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const days = data?.window ?? [];
  const quota = data?.quota ?? null;
  const fmtInt = (n: number) => new Intl.NumberFormat().format(Math.round(n || 0));

  const totals = useMemo(() => days.reduce(
    (acc, d) => ({
      bookings: acc.bookings + (d.bookings || 0),
      deposits: acc.deposits + (d.deposits || 0),
      tokens: acc.tokens + (d.llm_tokens || 0),
    }),
    { bookings: 0, deposits: 0, tokens: 0 }
  ), [days]);

  const quotaText = quota
    ? (quota.quota != null
        ? `${fmtInt(quota.remaining ?? 0)} of ${fmtInt(quota.quota)} left`
        : (quota.reason || 'No limit set'))
    : '—';

  return (
    <div className={"space-y-5 " + (className || '')}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Last 7 days</h2>
          <p className="text-sm text-slate-500">Bookings, deposits, and AI activity across your account.</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Bookings" value={fmtInt(totals.bookings)} hint="Reservations in the last 7 days" icon={CalendarCheck} />
            <StatCard label="Deposits taken" value={formatMoney(totals.deposits)} hint="Deposits collected on bookings" icon={Coins} />
            <StatCard label="AI activity" value={fmtInt(totals.tokens)} hint="Language-model tokens your assistant used" icon={Sparkles} />
            <StatCard label="AI allowance" value={quotaText} hint="Remaining AI usage on your plan" icon={Gauge} />
          </div>

          {days.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="text-sm font-semibold text-slate-900">Daily breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-3">Day</th>
                      <th className="px-6 py-3 text-right">Bookings</th>
                      <th className="px-6 py-3 text-right">Deposits</th>
                      <th className="px-6 py-3 text-right">AI tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.day} className="border-b border-slate-100">
                        <td className="px-6 py-2.5 text-slate-700">{new Date(d.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                        <td className="px-6 py-2.5 text-right tabular-nums text-slate-900">{fmtInt(d.bookings)}</td>
                        <td className="px-6 py-2.5 text-right tabular-nums text-slate-900">{formatMoney(d.deposits)}</td>
                        <td className="px-6 py-2.5 text-right tabular-nums text-slate-900">{fmtInt(d.llm_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && days.length > 0 && days.every((d) => d.bookings === 0 && d.deposits === 0 && d.llm_tokens === 0) && (
            <p className="text-sm text-slate-500">No activity recorded in the last 7 days yet.</p>
          )}
        </>
      )}
    </div>
  );
};

export default UsagePanel;
