"use client";

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import { authFetch } from '@/lib/auth/auth-api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  BrainCircuit,
  MessageSquareMore,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type OpsPayload = {
  campaigns: Array<{
    id: string;
    campaign_type: string;
    action: string;
    target_phone: string | null;
    status: string | null;
    attempts: number | null;
    scheduled_for: string | null;
    next_retry_at: string | null;
    source_event: string | null;
    metadata: Record<string, unknown> | null;
    error: string | null;
    created_at: string | null;
  }>;
  escalations: Array<{
    id: string;
    customer_phone: string;
    session_id: string;
    reason: string;
    status: string;
    assigned_agent_id: string | null;
    created_at: string;
    resolved_at: string | null;
  }>;
  memory: Array<{
    id: string;
    memory_key: string;
    memory_value: Record<string, unknown>;
    source: string | null;
    confidence: number;
    hit_count: number;
    last_seen_at: string | null;
    updated_at: string;
  }>;
  outcomes: Array<{ id: string; label: string; count: number; value: number }>;
  revenue_recovered_by_day: Array<{ day: string; revenue: number; count: number }>;
  totals: { open_escalations: number; retrying_campaigns: number; pending_campaigns: number };
};

const money = new Intl.NumberFormat('en-NG', {
  maximumFractionDigits: 0,
});

const shortDate = new Intl.DateTimeFormat('en-NG', {
  month: 'short',
  day: 'numeric',
});

const longDateTime = new Intl.DateTimeFormat('en-NG', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatMoney(value: number) {
  return money.format(Math.round(Number(value) || 0));
}

function formatDateTime(value: string | null) {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : longDateTime.format(parsed);
}

function statusTone(status: string | null | undefined) {
  switch (status) {
    case 'resolved':
    case 'sent':
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'claimed':
    case 'retry_scheduled':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'pending':
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-white/80 p-6 text-sm text-slate-500">
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mt-1 leading-6">{description}</p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  hint: string;
  tone: string;
}) {
  return (
    <div className={`overflow-hidden rounded-[28px] border p-5 shadow-sm ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/90 text-slate-950 shadow-sm">
            {icon}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-slate-400" />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{hint}</p>
    </div>
  );
}

export default function OpsClient() {
  const headers = useAuthHeaders();
  const [data, setData] = useState<OpsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const loadOps = useMemo(
    () => async () => {
      if (!headers) return;

      const res = await authFetch('/api/sias/ops', { headers: headers ?? {} });
      if (res.error) {
        setError(res.error.message);
        setData(null);
        return;
      }

      setData((res.data as OpsPayload) ?? null);
      setError(null);
      setLastSyncedAt(new Date().toISOString());
    },
    [headers]
  );

  useEffect(() => {
    let active = true;

    if (!headers) return;

    loadOps()
      .catch(() => {
        if (!active) return;
        setError('Failed to load SIAS operations');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [headers, loadOps]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadOps();
    } finally {
      setRefreshing(false);
    }
  };

  const mutate = async (key: string, fn: () => Promise<void>, successMessage: string) => {
    setBusyKey(key);
    setActionStatus(null);
    try {
      await fn();
      setActionStatus(successMessage);
      await refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Action failed');
    } finally {
      setBusyKey(null);
    }
  };

  const chartData = (data?.revenue_recovered_by_day ?? []).map((row) => ({
    day: shortDate.format(new Date(row.day)),
    revenue: Number(row.revenue ?? 0),
    count: row.count,
  }));
  const totalRecovered = chartData.reduce((sum, row) => sum + row.revenue, 0);

  if (loading) {
    return (
      <div className="grid gap-4 rounded-[28px] border border-slate-200 bg-white/80 p-6 shadow-sm">
        <div className="h-6 w-44 animate-pulse rounded-full bg-slate-200" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-28 animate-pulse rounded-[28px] bg-slate-100" />
          <div className="h-28 animate-pulse rounded-[28px] bg-slate-100" />
          <div className="h-28 animate-pulse rounded-[28px] bg-slate-100" />
        </div>
        <div className="h-72 animate-pulse rounded-[28px] bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <p className="font-semibold text-amber-950">Ops snapshot failed to load</p>
            <p className="max-w-2xl leading-6 text-amber-800">{error}</p>
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
              Retry load
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const metricCards = [
    {
      label: 'Open escalations',
      value: data?.totals.open_escalations ?? 0,
      hint: 'Human takeover requests waiting for claim or resolution.',
      icon: <MessageSquareMore className="h-5 w-5" />,
      tone: 'border-[#ead7cb] bg-[linear-gradient(180deg,#fffaf7_0%,#fff4ec_100%)]',
    },
    {
      label: 'Pending campaigns',
      value: data?.totals.pending_campaigns ?? 0,
      hint: 'Queued SIAS actions waiting to be executed by cron or manual retry.',
      icon: <Sparkles className="h-5 w-5" />,
      tone: 'border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]',
    },
    {
      label: 'Retrying campaigns',
      value: data?.totals.retrying_campaigns ?? 0,
      hint: 'Campaigns in recovery mode with automatic backoff and audit history.',
      icon: <RefreshCcw className="h-5 w-5" />,
      tone: 'border-amber-200 bg-[linear-gradient(180deg,#fffdf5_0%,#fff7e7_100%)]',
    },
  ];

  return (
    <div className="space-y-6">
      {actionStatus ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
          {actionStatus}
        </div>
      ) : null}

      <section className="relative overflow-hidden rounded-[34px] border border-[#ead7cb] bg-[radial-gradient(circle_at_top_left,_#fff9f4,_#f8efe8_55%,_#efe1d7_100%)] shadow-sm">
        <div className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(180deg,rgba(255,255,255,0.26),rgba(255,255,255,0))]" />
        <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div className="max-w-3xl space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full border-[#e4c8b9] bg-white px-3 py-1 text-[#8f563c]">
                SIAS operations center
              </Badge>
              <Badge variant="outline" className="rounded-full border-slate-200 bg-white/80 px-3 py-1 text-slate-600">
                {lastSyncedAt ? `Synced ${formatDateTime(lastSyncedAt)}` : 'Sync pending'}
              </Badge>
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Escalations, campaigns, and memory
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                The managed-ops control room for Booka. This view surfaces what the system is doing,
                what needs a human, and what the tenant is teaching the model over time.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="rounded-full border-slate-200 bg-white/90 text-slate-700 shadow-sm"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCcw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh snapshot
            </Button>
            <Badge className="rounded-full bg-white/90 px-3 py-2 text-slate-700 shadow-sm">
              <Activity className="mr-2 h-4 w-4 text-emerald-500" />
              Revenue recovered: {formatMoney(totalRecovered)}
            </Badge>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {metricCards.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            hint={card.hint}
            icon={card.icon}
            tone={card.tone}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <Card className="overflow-hidden border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff5ee] text-[#8f563c]">
                    <Banknote className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Billing-grade outcome rollup</p>
                    <h2 className="text-lg font-semibold text-slate-950">Revenue recovered by day</h2>
                  </div>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                  Daily recovery signals from the last 30 days, ready for outcome attribution and plan packaging.
                </p>
              </div>
              <Badge className="w-fit rounded-full bg-slate-100 text-slate-700">{chartData.length} days tracked</Badge>
            </div>

            <div className="mt-5 h-[320px] rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#fbfbfb_0%,#f8fafc_100%)] p-3">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => money.format(Number(value))}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const entry = payload[0];
                        return (
                          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
                            <p className="text-sm font-medium text-slate-950">{label}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              Revenue recovered:{' '}
                              <span className="font-semibold text-slate-950">{formatMoney(Number(entry.value ?? 0))}</span>
                            </p>
                            <p className="text-xs text-slate-500">{entry.payload?.count ?? 0} attributed events</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="revenue" fill="#8f563c" radius={[12, 12, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white text-sm text-slate-500">
                  No revenue recovery signals yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-800">
                    <BrainCircuit className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">What the tenant is teaching us</p>
                    <h2 className="text-lg font-semibold text-slate-950">Operational memory</h2>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  Persistent signals the SIAS layer can reuse for reminders, routing, and tone.
                </p>
              </div>
              <Badge className="rounded-full bg-slate-100 text-slate-700">{data?.memory.length ?? 0} memories</Badge>
            </div>

            <div className="mt-4 space-y-3">
              {data?.memory.length ? (
                data.memory.map((item) => (
                  <div key={item.id} className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{item.memory_key}</p>
                        <p className="text-xs text-slate-500">
                          Source: {item.source ?? 'system'} · Last seen {formatDateTime(item.last_seen_at)}
                        </p>
                      </div>
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-600">
                        {(item.confidence * 100).toFixed(0)}%
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full bg-slate-100 px-3 py-1">Hits: {item.hit_count}</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1">Updated: {formatDateTime(item.updated_at)}</span>
                    </div>
                    <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
                      {JSON.stringify(item.memory_value, null, 2)}
                    </pre>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No operational memory yet"
                  description="As Booka handles bookings, retries, and escalations, this section will start learning persistent tenant behavior."
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff5ee] text-[#8f563c]">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Retry queue</p>
                    <h2 className="text-lg font-semibold text-slate-950">Campaign pipeline</h2>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  Recent SIAS actions, their current state, and manual retry controls for recovery.
                </p>
              </div>
              <Badge className="rounded-full bg-slate-100 text-slate-700">{data?.campaigns.length ?? 0} rows</Badge>
            </div>

            <div className="mt-4 space-y-3">
              {data?.campaigns.length ? (
                data.campaigns.map((campaign) => {
                  const canRetry = ['failed', 'retry_scheduled', 'pending'].includes(String(campaign.status ?? ''));
                  return (
                    <div key={campaign.id} className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfb_100%)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{campaign.action.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-slate-500">{campaign.campaign_type}</p>
                        </div>
                        <Badge variant="outline" className={`rounded-full px-3 py-1 ${statusTone(campaign.status)}`}>
                          {campaign.status ?? 'pending'}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Attempts: {campaign.attempts ?? 0}</span>
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Target: {campaign.target_phone ?? 'n/a'}</span>
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Retry: {formatDateTime(campaign.next_retry_at)}</span>
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Source: {campaign.source_event ?? 'n/a'}</span>
                      </div>
                      {campaign.error ? (
                        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          Last error: {campaign.error}
                        </div>
                      ) : null}
                      {canRetry ? (
                        <div className="mt-4 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyKey === `campaign:${campaign.id}`}
                            onClick={() =>
                              mutate(
                                `campaign:${campaign.id}`,
                                async () => {
                                  const res = await authFetch('/api/campaigns/run', {
                                    headers: headers ?? {},
                                    method: 'POST',
                                    body: { campaignId: campaign.id },
                                  });
                                  if (res.error) throw new Error(res.error.message);
                                },
                                `Retried campaign ${campaign.id.slice(0, 8)}`
                              )
                            }
                          >
                            Retry now
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="No campaigns in the queue"
                  description="When the cron runner or the ops team schedules reactivation, reminders, or review follow-ups, they will show up here."
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                    <ShieldAlert className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Human takeover</p>
                    <h2 className="text-lg font-semibold text-slate-950">Escalation inbox</h2>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  Claim, resolve, and track edge cases that the AI should not handle alone.
                </p>
              </div>
              <Badge className="rounded-full bg-slate-100 text-slate-700">{data?.escalations.length ?? 0} rows</Badge>
            </div>

            <div className="mt-4 space-y-3">
              {data?.escalations.length ? (
                data.escalations.map((item) => {
                  const isResolved = item.status === 'resolved';
                  const isClaimed = item.status === 'claimed';
                  return (
                    <div key={item.id} className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfb_100%)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{item.reason}</p>
                          <p className="text-xs text-slate-500">{item.customer_phone}</p>
                        </div>
                        <Badge variant="outline" className={`rounded-full px-3 py-1 ${statusTone(item.status)}`}>
                          {item.status}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Session {item.session_id}</span>
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Assigned: {item.assigned_agent_id ?? 'unassigned'}</span>
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Created: {formatDateTime(item.created_at)}</span>
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">Resolved: {formatDateTime(item.resolved_at)}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {!isClaimed && !isResolved ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyKey === `escalation:${item.id}`}
                            onClick={() =>
                              mutate(
                                `escalation:${item.id}`,
                                async () => {
                                  const res = await authFetch(`/api/escalation/${item.id}`, {
                                    headers: headers ?? {},
                                    method: 'PATCH',
                                    body: { action: 'claim' },
                                  });
                                  if (res.error) throw new Error(res.error.message);
                                },
                                `Claimed escalation ${item.id.slice(0, 8)}`
                              )
                            }
                          >
                            Claim
                          </Button>
                        ) : null}
                        {isClaimed && !isResolved ? (
                          <Button
                            size="sm"
                            disabled={busyKey === `escalation:${item.id}`}
                            onClick={() =>
                              mutate(
                                `escalation:${item.id}`,
                                async () => {
                                  const res = await authFetch(`/api/escalation/${item.id}`, {
                                    headers: headers ?? {},
                                    method: 'PATCH',
                                    body: { action: 'resolve' },
                                  });
                                  if (res.error) throw new Error(res.error.message);
                                },
                                `Resolved escalation ${item.id.slice(0, 8)}`
                              )
                            }
                          >
                            Resolve
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="No active escalations"
                  description="When customers need human handling, Booka will surface the issue here for claim and resolution."
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-slate-200 bg-white/90 shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-800">
                  <BadgeCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Outcome pricing input</p>
                  <h2 className="text-lg font-semibold text-slate-950">Outcome ledger</h2>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Billing-grade impact by signal, suitable for outcome pricing and service-tier reporting.
              </p>
            </div>
            <Badge className="rounded-full bg-slate-100 text-slate-700">{data?.outcomes.length ?? 0} signals</Badge>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data?.outcomes.length ? (
              data.outcomes.map((item) => (
                <div key={item.id} className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{item.label}</p>
                      <p className="text-xs text-slate-500">{item.count} attributed events</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                      <Banknote className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{formatMoney(item.value)}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">credits</p>
                </div>
              ))
            ) : (
              <div className="md:col-span-2 xl:col-span-3">
                <EmptyState
                  title="No outcome signals yet"
                  description="As recovery, retention, and no-show reduction actions fire, their attributed value will appear here."
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
