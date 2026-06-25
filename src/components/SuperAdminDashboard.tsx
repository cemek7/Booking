'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch, authPost } from '@/lib/auth/auth-api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Bell,
  CheckCircle,
  Cloud,
  Clock3,
  Database,
  Download,
  Layers3,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';

type Kpi = { title: string; value: string | number; status: 'good' | 'warning' | 'critical'; icon: string; change?: string };
type TenantProfitability = {
  tenant_id: string;
  tenant_name?: string;
  status: 'healthy' | 'warning' | 'critical' | 'suspended' | 'inactive';
  plan?: string | null;
  wallet_balance_credits: number;
  low_balance_threshold_credits: number;
  month_topups_credits: number;
  month_spent_credits: number;
  month_profit_credits: number;
  month_usage_revenue_credits: number;
  month_actual_cost_credits: number;
  month_realized_profit_credits: number;
  month_withdrawable_profit_credits: number;
  lifetime_topups_credits: number;
  lifetime_spent_credits: number;
  lifetime_profit_credits: number;
  lifetime_usage_revenue_credits: number;
  lifetime_actual_cost_credits: number;
  lifetime_realized_profit_credits: number;
  lifetime_withdrawable_profit_credits: number;
  cash_collected_credits: number;
  actual_cost_credits: number;
  realized_profit_credits: number;
  withdrawable_profit_credits: number;
  profit_reserve_credits: number;
  total_tokens: number;
  call_count: number;
  user_count: number;
  reservation_count: number;
  completed_reservations: number;
  active_staff_count: number;
  bookings_revenue_ngn: number;
  last_activity_at?: string | null;
  margin_pct: number;
  risk_reason?: string;
  provider?: string | null;
};

type DashboardResponse = {
  kpis?: Kpi[];
  platformMetrics?: {
    totalTenants: number;
    activeTenants: number;
    newTenants24h: number;
    totalBookings: number;
    bookings24h: number;
    revenue24h: number;
    avgResponseTime: number;
    errorRate: number;
    llmCostsToday: number;
    systemUptime: number;
  };
  platformFinancials?: {
    currency: 'credits';
    month_topups_credits: number;
    month_spent_credits: number;
    month_profit_credits: number;
    month_usage_revenue_credits: number;
    month_actual_cost_credits: number;
    month_realized_profit_credits: number;
    month_withdrawable_profit_credits: number;
    lifetime_topups_credits: number;
    lifetime_spent_credits: number;
    lifetime_profit_credits: number;
    lifetime_usage_revenue_credits: number;
    lifetime_actual_cost_credits: number;
    lifetime_realized_profit_credits: number;
    lifetime_withdrawable_profit_credits: number;
    total_wallet_balance_credits: number;
    cash_collected_credits: number;
    actual_cost_credits: number;
    realized_profit_credits: number;
    withdrawable_profit_credits: number;
    profit_reserve_credits: number;
    profitable_tenants: number;
    loss_making_tenants: number;
    low_balance_tenants: number;
    booking_revenue_ngn: number;
    booking_revenue_30d_ngn: number;
    active_tenants: number;
  };
  operationalMetrics?: Array<{ name: string; current: number; threshold: number; status: 'normal' | 'warning' | 'critical' }>;
  incidents?: Array<{ id: string; severity: 'low' | 'medium' | 'high' | 'critical'; title: string; service: string; startedAt: string; status: 'active' | 'investigating' | 'resolved'; owner?: string }>;
  bookingConflicts?: Array<{ id: string; bookingIds: string[]; resource: string; timeSlot: string; status: 'pending' | 'resolved'; resolvedAt?: string }>;
  paymentMismatches?: Array<{ id: string; transactionId: string; internalAmount: number; pspAmount: number; delta: number; status: 'pending' | 'resolved' }>;
  tenantHealth?: Array<{ id: string; name: string; status: 'healthy' | 'degraded' | 'critical' | 'offline'; lastActivity: string; bookingsToday: number; errorRate: number; responseTime: number; uptime: number }>;
  tenantProfitability?: TenantProfitability[];
  systemHealth?: {
    database?: { status?: 'healthy' | 'degraded' | 'critical' | 'unknown'; query_latency_ms?: number; note?: string };
    api?: { status?: 'healthy' | 'degraded' | 'critical' | 'unknown'; request_count_5m?: number; error_rate_pct?: number; p95_latency_ms?: number; note?: string };
    security?: { status?: 'healthy' | 'degraded' | 'critical' | 'unknown'; active_incidents?: number; critical_incidents?: number; failed_auth_1h?: number; note?: string };
  };
  lastUpdated?: string;
};

interface SuperAdminDashboardProps {
  compact?: boolean;
}

const statusStyles: Record<string, string> = {
  good: 'text-emerald-600 bg-emerald-50 ring-emerald-100',
  warning: 'text-amber-700 bg-amber-50 ring-amber-100',
  critical: 'text-rose-700 bg-rose-50 ring-rose-100',
  healthy: 'text-emerald-600 bg-emerald-50 ring-emerald-100',
  degraded: 'text-amber-700 bg-amber-50 ring-amber-100',
  offline: 'text-slate-600 bg-slate-100 ring-slate-200',
  inactive: 'text-slate-600 bg-slate-100 ring-slate-200',
  suspended: 'text-rose-700 bg-rose-50 ring-rose-100',
};

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', statusStyles[tone] || statusStyles.warning)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'critical' || tone === 'suspended' ? 'bg-rose-500' : tone === 'warning' || tone === 'degraded' ? 'bg-amber-500' : 'bg-emerald-500')} />
      {label}
    </span>
  );
}

function fmtMoney(value: number, digits = 2) {
  return `${value.toFixed(digits)} cr`;
}

function fmtNgn(value: number) {
  return `₦${value.toLocaleString()}`;
}

export default function SuperAdminDashboard({ compact = false }: SuperAdminDashboardProps) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<'suspend' | 'activate' | 'pro' | 'free' | ''>('');
  const [topUpTenantId, setTopUpTenantId] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('100');
  const [topUpNote, setTopUpNote] = useState('Superadmin top-up');
  const [actionBusy, setActionBusy] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch<DashboardResponse>(`/api/superadmin/dashboard?range=${timeRange}`);
      if (response.error) throw new Error(response.error.message);
      setData((response.data as DashboardResponse) ?? null);
    } catch (error) {
      console.error('Failed to fetch superadmin dashboard:', error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchDashboardData, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchDashboardData]);

  const profitability = useMemo(
    () => [...(data?.tenantProfitability || [])].sort((a, b) => b.realized_profit_credits - a.realized_profit_credits),
    [data?.tenantProfitability]
  );

  const platformMetrics = data?.platformMetrics;
  const financials = data?.platformFinancials;
  const incidents = data?.incidents || [];
  const conflicts = data?.bookingConflicts || [];
  const mismatches = data?.paymentMismatches || [];
  const health = data?.systemHealth;

  const toggleTenant = (tenantId: string) => {
    setSelectedTenants((current) =>
      current.includes(tenantId) ? current.filter((id) => id !== tenantId) : [...current, tenantId]
    );
  };

  const runBulkAction = async () => {
    if (!bulkAction || selectedTenants.length === 0) return;
    setActionBusy(true);
    try {
      const response = await authPost('/api/superadmin/bulk-actions', {
        action: bulkAction,
        tenantIds: selectedTenants,
      });
      if (response.error) throw new Error(response.error.message);
      await fetchDashboardData();
      setSelectedTenants([]);
      setBulkAction('');
    } catch (error) {
      console.error(error);
    } finally {
      setActionBusy(false);
    }
  };

  const topUpWallet = async () => {
    if (!topUpTenantId) return;
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setActionBusy(true);
    try {
      const response = await authFetch(`/api/superadmin/tenants/${topUpTenantId}`, {
        method: 'PATCH',
        body: {
          wallet_topup_credits: amount,
          wallet_topup_description: topUpNote,
        },
      });
      if (response.error) throw new Error(response.error.message);
      await fetchDashboardData();
    } catch (error) {
      console.error(error);
    } finally {
      setActionBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Card key={idx}>
              <CardContent className="p-5">
                <div className="h-4 w-24 rounded bg-slate-200 animate-pulse" />
                <div className="mt-4 h-7 w-32 rounded bg-slate-200 animate-pulse" />
                <div className="mt-2 h-3 w-40 rounded bg-slate-100 animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-slate-600">Failed to load superadmin dashboard.</p>
          <Button className="mt-4" onClick={fetchDashboardData}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-6', compact ? '' : 'pb-10')}>
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            <Sparkles className="h-4 w-4" />
            Platform command center
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Super Admin Dashboard</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Monitor platform revenue, AI spend, tenant profitability, and system health from one control surface.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['1h', '6h', '24h', '7d', '30d'] as TimeRange[]).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeRange(range)}
              className="rounded-full"
            >
              {range}
            </Button>
          ))}
          <Button variant={autoRefresh ? 'default' : 'outline'} size="sm" onClick={() => setAutoRefresh((v) => !v)} className="rounded-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Auto refresh {autoRefresh ? 'on' : 'off'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchDashboardData} className="rounded-full">
            <Cloud className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="rounded-full">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(data.kpis || []).map((kpi) => (
          <Card key={kpi.title} className="overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className={cn('rounded-2xl p-3 ring-1 ring-inset', statusStyles[kpi.status])}>
                  <span className="text-lg">{kpi.icon}</span>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold tracking-tight text-slate-950">{kpi.value}</div>
                  {kpi.change && (
                    <div className={cn('mt-1 inline-flex items-center gap-1 text-xs font-medium', kpi.change.startsWith('+') ? 'text-emerald-600' : 'text-rose-600')}>
                      {kpi.change.startsWith('+') ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {kpi.change}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700">{kpi.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" />
              Financial summary
            </CardTitle>
            <CardDescription>Cash collected, recognized revenue, actual cost, and withdrawable profit for the selected window.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Cash collected</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{fmtMoney(financials?.cash_collected_credits ?? 0)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Recognized revenue</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{fmtMoney(financials?.month_usage_revenue_credits ?? 0)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Actual cost</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{fmtMoney(financials?.month_actual_cost_credits ?? 0)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Realized profit</p>
                <p className={cn('mt-2 text-2xl font-semibold', (financials?.month_realized_profit_credits ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {fmtMoney(financials?.month_realized_profit_credits ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Wallet balance</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{fmtMoney(financials?.total_wallet_balance_credits ?? 0)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Withdrawable profit</p>
                <p className={cn('mt-2 text-2xl font-semibold', (financials?.withdrawable_profit_credits ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {fmtMoney(financials?.withdrawable_profit_credits ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Profit reserve</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{fmtMoney(financials?.profit_reserve_credits ?? 0)}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Profitable tenants</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{financials?.profitable_tenants ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Loss-making tenants</p>
                <p className="mt-1 text-xl font-semibold text-rose-600">{financials?.loss_making_tenants ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Low-balance tenants</p>
                <p className="mt-1 text-xl font-semibold text-amber-700">{financials?.low_balance_tenants ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Platform controls
            </CardTitle>
            <CardDescription>Quick actions for tenant wallets and platform operations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <label className="text-sm font-medium text-slate-700">Tenant ID for top-up</label>
              <input
                value={topUpTenantId}
                onChange={(e) => setTopUpTenantId(e.target.value)}
                placeholder="UUID"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-offset-white focus:ring-2 focus:ring-slate-300"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-slate-700">Credits</label>
                  <input
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    type="number"
                    min="1"
                    step="1"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Note</label>
                  <input
                    value={topUpNote}
                    onChange={(e) => setTopUpNote(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
              </div>
              <Button onClick={topUpWallet} disabled={actionBusy || !topUpTenantId} className="rounded-xl">
                Apply top-up
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                className="justify-start rounded-xl"
                onClick={() => setBulkAction('suspend')}
                disabled={actionBusy}
              >
                <ShieldAlert className="mr-2 h-4 w-4" />
                Bulk suspend
              </Button>
              <Button
                variant="outline"
                className="justify-start rounded-xl"
                onClick={() => setBulkAction('activate')}
                disabled={actionBusy}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Bulk activate
              </Button>
              <Button
                variant="outline"
                className="justify-start rounded-xl"
                onClick={() => setBulkAction('pro')}
                disabled={actionBusy}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Bulk upgrade
              </Button>
              <Button
                variant="outline"
                className="justify-start rounded-xl"
                onClick={() => setBulkAction('free')}
                disabled={actionBusy}
              >
                <Layers3 className="mr-2 h-4 w-4" />
                Bulk downgrade
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Selected tenants</p>
                <p className="text-xs text-slate-500">{selectedTenants.length} selected</p>
              </div>
              <Button onClick={runBulkAction} disabled={actionBusy || !bulkAction || selectedTenants.length === 0} className="rounded-xl">
                Run action
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Tenant profitability
            </CardTitle>
            <CardDescription>Ranked by monthly profit, with wallet health and margin visibility.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-10">&nbsp;</TH>
                    <TH>Tenant</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Wallet</TH>
                    <TH className="text-right">Cash</TH>
                    <TH className="text-right">Revenue</TH>
                    <TH className="text-right">Cost</TH>
                    <TH className="text-right">Realized</TH>
                    <TH className="text-right">Withdrawable</TH>
                    <TH className="text-right">Margin</TH>
                    <TH className="text-right">AI Tokens</TH>
                    <TH className="text-right">Bookings</TH>
                  </TR>
                </THead>
                <TBody>
                  {profitability.slice(0, 12).map((tenant) => {
                    const selected = selectedTenants.includes(tenant.tenant_id);
                    return (
                      <TR key={tenant.tenant_id} className={cn(selected && 'bg-slate-50')}>
                        <TD>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                            checked={selected}
                            onChange={() => toggleTenant(tenant.tenant_id)}
                            aria-label={`Select ${tenant.tenant_name || tenant.tenant_id}`}
                          />
                        </TD>
                        <TD className="whitespace-normal">
                          <div className="space-y-1">
                            <p className="font-medium text-slate-950">{tenant.tenant_name || tenant.tenant_id}</p>
                            <p className="text-xs text-slate-500">{tenant.plan || 'free'} · {tenant.tenant_id.slice(0, 8)}</p>
                          </div>
                        </TD>
                        <TD>
                          <StatusPill label={tenant.risk_reason ? tenant.risk_reason.replace(/_/g, ' ') : tenant.status} tone={tenant.status === 'healthy' ? 'healthy' : tenant.status} />
                        </TD>
                        <TD className="text-right font-medium">{fmtMoney(tenant.wallet_balance_credits)}</TD>
                        <TD className="text-right font-medium">{fmtMoney(tenant.cash_collected_credits)}</TD>
                        <TD className="text-right font-medium">{fmtMoney(tenant.month_usage_revenue_credits)}</TD>
                        <TD className="text-right font-medium text-slate-700">{fmtMoney(tenant.month_actual_cost_credits)}</TD>
                        <TD className={cn('text-right font-medium', tenant.month_realized_profit_credits >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {fmtMoney(tenant.month_realized_profit_credits)}
                        </TD>
                        <TD className={cn('text-right font-medium', tenant.month_withdrawable_profit_credits >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {fmtMoney(tenant.month_withdrawable_profit_credits)}
                        </TD>
                        <TD className="text-right">{tenant.margin_pct.toFixed(1)}%</TD>
                        <TD className="text-right">{tenant.total_tokens.toLocaleString()}</TD>
                        <TD className="text-right">{tenant.reservation_count.toLocaleString()}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                System health
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {health?.database && (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-900">Database</p>
                    <StatusPill label={(health.database.status || 'unknown').toString()} tone={health.database.status || 'warning'} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{health.database.note || 'Database healthy'}</p>
                </div>
              )}
              {health?.api && (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-900">API</p>
                    <StatusPill label={(health.api.status || 'unknown').toString()} tone={health.api.status || 'warning'} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">5m errors: {(health.api.error_rate_pct ?? 0).toFixed(2)}%</p>
                </div>
              )}
              {health?.security && (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-900">Security</p>
                    <StatusPill label={(health.security.status || 'unknown').toString()} tone={health.security.status || 'warning'} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{health.security.note || 'No incidents'}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Incident queue
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {incidents.slice(0, 3).map((incident) => (
                <div key={incident.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <StatusPill label={incident.severity} tone={incident.severity === 'critical' ? 'critical' : incident.severity === 'high' ? 'warning' : 'healthy'} />
                    <span className="text-xs text-slate-500">{incident.startedAt}</span>
                  </div>
                  <p className="mt-2 font-medium text-slate-950">{incident.title}</p>
                  <p className="text-sm text-slate-600">{incident.service}</p>
                </div>
              ))}
              {incidents.length === 0 && <p className="text-sm text-slate-500">No active incidents.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Booking conflicts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {conflicts.slice(0, 4).map((conflict) => (
              <div key={conflict.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-950">{conflict.resource}</p>
                  <StatusPill label={conflict.status} tone={conflict.status === 'resolved' ? 'healthy' : 'warning'} />
                </div>
                <p className="mt-2 text-sm text-slate-600">{conflict.timeSlot}</p>
              </div>
            ))}
            {conflicts.length === 0 && <p className="text-sm text-slate-500">No booking conflicts.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" />
              Payment mismatches
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mismatches.slice(0, 4).map((mismatch) => (
              <div key={mismatch.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-950">{mismatch.transactionId}</p>
                  <StatusPill label={mismatch.status} tone={mismatch.status === 'resolved' ? 'healthy' : 'critical'} />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Delta: {fmtMoney(Math.abs(mismatch.delta))}
                </p>
              </div>
            ))}
            {mismatches.length === 0 && <p className="text-sm text-slate-500">No payment mismatches.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2">
            <Database className="h-4 w-4" />
            Updated: {data.lastUpdated || '—'}
          </div>
          <div className="inline-flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            Range: {timeRange}
          </div>
          <div className="inline-flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Booking revenue: {fmtNgn(financials?.booking_revenue_ngn ?? 0)}
          </div>
          <div className="inline-flex items-center gap-2">
            <Users className="h-4 w-4" />
            Active tenants: {platformMetrics?.activeTenants ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}
