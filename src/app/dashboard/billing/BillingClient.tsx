'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import { authFetch } from '@/lib/auth/auth-api-client';
import { SIAS_BILLING_PLANS, SIAS_OUTCOME_ATRIBUTION } from '@/lib/sias';

interface DashboardMetrics {
  total_bookings?: number;
  active_staff?: number;
  monthly_revenue?: number;
}

interface SiasOutcomeSummary {
  id: string;
  label: string;
  count: number;
  value: number;
}

interface SiasSummary {
  open_escalations: number;
  pending_campaigns: number;
  retrying_campaigns: number;
  memory_signals: number;
  attribution_records: number;
  attributed_revenue: number;
  campaign_success_rate: number;
  outcomes: SiasOutcomeSummary[];
}

interface WalletLedgerEntry {
  id: string;
  kind: 'topup' | 'reservation' | 'usage' | 'refund' | 'adjustment';
  amount_credits: number;
  description?: string | null;
  created_at?: string | null;
}

interface WalletSummary {
  balance_credits: number;
  lifetime_topups_credits: number;
  lifetime_spent_credits: number;
  low_balance_threshold_credits: number;
  month_topups_credits: number;
  month_spent_credits: number;
  month_profit_credits: number;
  month_usage_revenue_credits: number;
  month_actual_cost_credits: number;
  month_realized_profit_credits: number;
  month_withdrawable_profit_credits: number;
  cash_collected_credits: number;
  recognized_revenue_credits: number;
  actual_cost_credits: number;
  realized_profit_credits: number;
  withdrawable_profit_credits: number;
  profit_reserve_credits: number;
  unsettled_liabilities_credits: number;
  month_tokens: number;
  token_rate: number;
  recent_ledger: WalletLedgerEntry[];
}

export default function BillingClient() {
  const [activeTab, setActiveTab] = useState<'overview' | 'ledger' | 'payment'>('overview');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [sias, setSias] = useState<SiasSummary | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('100');
  const [topUpDescription, setTopUpDescription] = useState('Manual top-up');
  const [topUpMessage, setTopUpMessage] = useState<string | null>(null);
  const headers = useAuthHeaders();

  useEffect(() => {
    let active = true;
    if (!headers) return;

    authFetch('/api/analytics/dashboard?period=month', { headers })
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setMetricsError(res.error.message);
          return;
        }
        setMetrics((res.data as { metrics?: DashboardMetrics })?.metrics ?? null);
        setSias((res.data as { sias?: SiasSummary })?.sias ?? null);
        setMetricsError(null);
      })
      .catch(() => {
        if (!active) return;
        setMetricsError('Failed to load usage data');
      })
      .finally(() => {
        if (!active) return;
        setMetricsLoading(false);
      });

    authFetch<WalletSummary>('/api/billing/wallet', { headers })
      .then((res) => {
        if (!active) return;
        if (res.error) {
          setWalletError(res.error.message);
          return;
        }
        setWallet((res.data as WalletSummary) ?? null);
        setWalletError(null);
      })
      .catch(() => {
        if (!active) return;
        setWalletError('Failed to load wallet summary');
      })
      .finally(() => {
        if (!active) return;
        setWalletLoading(false);
      });

    return () => {
      active = false;
    };
  }, [headers]);

  const estimatedTokensLeft = useMemo(() => {
    if (!wallet || !wallet.token_rate) return null;
    return Math.max(0, Math.floor(wallet.balance_credits / wallet.token_rate));
  }, [wallet]);

  const lowBalanceThreshold = wallet?.low_balance_threshold_credits ?? 0;
  const outcomeCards = [
    { id: 'revenue_recovery', label: 'Revenue recovered' },
    { id: 'no_show_reduction', label: 'No-show interventions' },
    { id: 'repeat_booking_lift', label: 'Repeat-booking signals' },
    { id: 'reactivation_lift', label: 'Reactivation signals' },
  ];

  async function submitTopUp() {
    setTopUpMessage(null);
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpMessage('Enter a positive credit amount.');
      return;
    }

    const res = await authFetch<WalletSummary>('/api/billing/wallet', {
      method: 'POST',
      body: {
        amount_credits: amount,
        description: topUpDescription.trim() || 'Manual top-up',
      },
    });

    if (res.error) {
      setTopUpMessage(res.error.message);
      return;
    }

    setWallet((res.data as WalletSummary) ?? null);
    setTopUpMessage('Top-up applied.');
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">SIAS billing</p>
        <h1 className="mt-2 text-2xl font-semibold">Outcome-based pricing and wallet controls</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage subscription, usage, managed service tiers, and real profit in one place.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Billing model</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Subscription + usage + managed services</h2>
              <p className="mt-2 max-w-xl text-sm text-slate-600">
                Booka stops being sold as a calendar. It becomes a managed operating layer priced by the work it removes and the revenue it recovers.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Current reserve</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{wallet?.profit_reserve_credits?.toFixed(2) ?? '0.00'} credits</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {SIAS_BILLING_PLANS.map((plan) => (
              <div key={plan.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{plan.name}</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{plan.price}</p>
                <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
                <div className="mt-3 space-y-1">
                  {plan.included.slice(0, 3).map((item) => (
                    <div key={item} className="text-xs text-slate-500">• {item}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Outcome attribution</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">Measure the business impact, not just usage</h2>
          <div className="mt-4 space-y-3">
            {SIAS_OUTCOME_ATRIBUTION.map((item, index) => (
              <div key={item.id} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                  <div className="mt-1 text-sm text-slate-600">{item.description}</div>
                </div>
                <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                  {String(index + 1).padStart(2, '0')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Billing-grade SIAS reporting</p>
            <h2 className="text-lg font-semibold text-slate-950">Operational outcomes, not just product usage</h2>
            <p className="max-w-2xl text-sm text-slate-600">
              The report below groups reminders, reactivation, escalations, and memory updates into the same business language you would use when reviewing ROI with a client.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Open escalations</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{sias?.open_escalations ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Campaign success</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{Math.round(sias?.campaign_success_rate ?? 0)}%</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Memory signals</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{sias?.memory_signals ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attributed revenue</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{Number(sias?.attributed_revenue ?? 0).toFixed(2)} credits</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attribution records</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{sias?.attribution_records ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pending campaigns</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{sias?.pending_campaigns ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Retrying campaigns</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{sias?.retrying_campaigns ?? 0}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {outcomeCards.map((card) => {
            const outcome = sias?.outcomes?.find((item) => item.id === card.id);
            return (
              <div key={card.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{outcome?.count ?? 0}</p>
                <p className="mt-1 text-sm text-slate-600">
                  Value: {Number(outcome?.value ?? 0).toFixed(2)} credits
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Pricing model</p>
            <h2 className="text-lg font-semibold text-slate-950">Subscription + included credits + overage</h2>
            <p className="max-w-2xl text-sm text-slate-600">
              Tenants pay for the platform, the automation they consume, and the managed service tier they need. Heavy usage stays isolated inside the tenant wallet.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Included credits</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">Plan-based</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Overage</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">Wallet-based</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Reserve</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{wallet?.profit_reserve_credits?.toFixed(2) ?? '0.00'} credits</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Wallet balance</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {walletLoading ? '—' : `${wallet?.balance_credits?.toFixed(2) ?? '0.00'} credits`}
          </p>
          <p className="mt-1 text-sm text-slate-500">Available for AI, messaging, and managed workflows</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tokens left</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {walletLoading ? '—' : (estimatedTokensLeft != null ? estimatedTokensLeft.toLocaleString() : '—')}
          </p>
          <p className="mt-1 text-sm text-slate-500">Estimated from your token rate</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Recognized revenue</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {walletLoading ? '—' : `${wallet?.month_usage_revenue_credits?.toFixed(2) ?? '0.00'} credits`}
          </p>
          <p className="mt-1 text-sm text-slate-500">What Booka earned from assistant and managed ops usage</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Actual cost</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {walletLoading ? '—' : `${wallet?.month_actual_cost_credits?.toFixed(2) ?? '0.00'} credits`}
          </p>
          <p className="mt-1 text-sm text-slate-500">What OpenRouter or the model stack actually cost</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Withdrawable profit</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {walletLoading ? '—' : `${wallet?.withdrawable_profit_credits?.toFixed(2) ?? '0.00'} credits`}
          </p>
          <p className="mt-1 text-sm text-slate-500">Realized profit after reserve</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {(['overview', 'ledger', 'payment'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'payment' ? 'Top Up' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Usage snapshot</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">This month&apos;s activity</h2>
              </div>
              {wallet?.balance_credits != null && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  Low balance alert: {lowBalanceThreshold.toFixed(2)}
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Bookings</p>
                {metricsLoading && <p className="mt-2 text-sm text-slate-400">Loading…</p>}
                {metricsError && <p className="mt-2 text-sm text-red-500">{metricsError}</p>}
                {!metricsLoading && !metricsError && (
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{metrics?.total_bookings ?? '—'}</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Monthly revenue</p>
                {metricsLoading && <p className="mt-2 text-sm text-slate-400">Loading…</p>}
                {!metricsLoading && !metricsError && (
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {metrics?.monthly_revenue != null
                      ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(metrics.monthly_revenue)
                      : '—'}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Cash collected</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {walletLoading ? '—' : `${wallet?.cash_collected_credits?.toFixed(2) ?? '0.00'} credits`}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">AI spend</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {walletLoading ? '—' : `${wallet?.month_spent_credits?.toFixed(2) ?? '0.00'} credits`}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">AI tokens</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {walletLoading ? '—' : wallet?.month_tokens?.toLocaleString() ?? '—'}
                </p>
              </div>
            </div>

            {walletError && (
              <p className="mt-4 text-sm text-red-500">{walletError}</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">How it works</p>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
              <li>Your subscription covers platform access and a managed outcome layer.</li>
              <li>Extra usage draws from the tenant wallet as overage, so one tenant never absorbs another tenant&apos;s spend.</li>
              <li>Every AI call reserves credits before generation and settles on the provider&apos;s exact usage cost when available.</li>
              <li>Outcome attribution will eventually connect campaigns, reminders, and escalations to recovered revenue and repeat visits.</li>
              <li>If the wallet is empty, only that tenant is blocked.</li>
            </ul>
          </div>
        </div>
      )}

      {activeTab === 'ledger' && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Recent ledger</h2>
            <p className="text-sm text-slate-500">Top-ups, reservations, settlements, and refunds for this tenant.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kind</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {(wallet?.recent_ledger || []).map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{entry.kind}</td>
                    <td className="px-4 py-3 text-right text-sm text-slate-700">
                      {Number(entry.amount_credits || 0).toFixed(2)} credits
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{entry.description || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
                {!wallet?.recent_ledger?.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                      No ledger entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'payment' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Top up credits</h2>
            <p className="mt-1 text-sm text-slate-500">
              This is a manual top-up for now. We can wire Paystack/Stripe later without changing the wallet model.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">Credits to add</label>
                <input
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                  placeholder="100"
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Description</label>
                <input
                  value={topUpDescription}
                  onChange={(e) => setTopUpDescription(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                  placeholder="Manual top-up"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={submitTopUp}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Add credits
              </button>
              {topUpMessage && <span className="text-sm text-slate-600">{topUpMessage}</span>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Profit view</h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Cash collected</span>
                <span className="font-medium text-slate-900">{wallet?.cash_collected_credits?.toFixed(2) ?? '0.00'} credits</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Recognized revenue</span>
                <span className="font-medium text-slate-900">{wallet?.month_usage_revenue_credits?.toFixed(2) ?? '0.00'} credits</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Actual cost</span>
                <span className="font-medium text-slate-900">{wallet?.month_actual_cost_credits?.toFixed(2) ?? '0.00'} credits</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-3 text-slate-600">
                <span>Realized profit</span>
                <span className="font-semibold text-slate-900">{wallet?.month_realized_profit_credits?.toFixed(2) ?? '0.00'} credits</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Withdrawable profit</span>
                <span className="font-semibold text-slate-900">{wallet?.month_withdrawable_profit_credits?.toFixed(2) ?? '0.00'} credits</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
