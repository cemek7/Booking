"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Coins, Hash, RefreshCw } from 'lucide-react';
import { authFetch } from '@/lib/auth/auth-api-client';

type LlmUsage = { requests: number; total_tokens: number; cost: number };

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

export default function OwnerLLMMetrics() {
  const [usage, setUsage] = useState<LlmUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // The API defaults tenant scope to the signed-in owner's tenant.
    const r = await authFetch<LlmUsage>('/api/admin/llm-usage');
    if (r.error || !r.data) {
      setError(r.error?.message || 'Could not load AI usage.');
      setUsage(null);
    } else {
      setUsage(r.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const fmtInt = (n: number) => new Intl.NumberFormat().format(Math.round(n || 0));
  const fmtCost = (n: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n || 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">AI usage</h2>
          <p className="text-sm text-slate-500">How much your AI front desk has worked, and what it cost.</p>
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

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading && !usage ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Assistant requests" value={fmtInt(usage?.requests ?? 0)} hint="AI replies and actions handled for you" icon={Bot} />
          <StatCard label="Tokens used" value={fmtInt(usage?.total_tokens ?? 0)} hint="Total language-model tokens processed" icon={Hash} />
          <StatCard label="Estimated cost" value={fmtCost(usage?.cost ?? 0)} hint="Approximate AI spend for this tenant" icon={Coins} />
        </div>
      )}

      {!loading && usage && usage.requests === 0 && (
        <p className="text-sm text-slate-500">
          No AI usage recorded yet. Once your assistant starts handling WhatsApp and Instagram conversations, usage will appear here.
        </p>
      )}
    </div>
  );
}
