'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import { authFetch } from '@/lib/auth/auth-api-client';

interface DashboardMetrics {
  total_bookings?: number;
  active_staff?: number;
  monthly_revenue?: number;
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
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('100');
  const [topUpMessage, setTopUpMessage] = useState<string | null>(null);
  const [topUpPending, setTopUpPending] = useState(false);
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

  // Sends the owner to Paystack. Credits arrive only when the signed webhook
  // lands — this used to POST straight to /api/billing/wallet, which credited
  // the wallet with no payment at all.
  async function submitTopUp() {
    setTopUpMessage(null);
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopUpMessage('Enter a positive credit amount.');
      return;
    }

    setTopUpPending(true);
    const res = await authFetch<{ authorization_url?: string }>('/api/billing/wallet/checkout', {
      method: 'POST',
      body: {
        amount_credits: amount,
        callback_url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
    });
    setTopUpPending(false);

    if (res.error) {
      setTopUpMessage(res.error.message);
      return;
    }

    const url = (res.data as { authorization_url?: string } | null)?.authorization_url;
    if (!url) {
      setTopUpMessage('Could not start the payment. Please try again.');
      return;
    }
    window.location.href = url;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing &amp; usage</h1>
        <p className="mt-1 text-sm text-gray-600">
          Your balance, what you&rsquo;ve used this month, and how to top up.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Wallet balance</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {walletLoading ? '—' : `${wallet?.balance_credits?.toFixed(2) ?? '0.00'} credits`}
          </p>
          <p className="mt-1 text-sm text-slate-500">Available for AI, messaging, and managed workflows</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">AI usage remaining</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {walletLoading ? '—' : (estimatedTokensLeft != null ? `~${estimatedTokensLeft.toLocaleString()}` : '—')}
          </p>
          <p className="mt-1 text-sm text-slate-500">Estimated AI messages left on your balance</p>
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
                <p className="text-xs uppercase tracking-wide text-slate-500">AI usage this month</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {walletLoading ? '—' : `${wallet?.month_spent_credits?.toFixed(2) ?? '0.00'} credits`}
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
              <li>Your plan covers your workspace — bookings, sales, inventory, and everyday operations.</li>
              <li>AI features — assistant replies, reminders, follow-ups — draw from your balance as you use them.</li>
              <li>Top up any time. You&rsquo;re only ever charged for what you use.</li>
              <li>If your balance runs out, AI features pause until you top up — your bookings and sales keep working.</li>
            </ul>
          </div>
        </div>
      )}

      {activeTab === 'ledger' && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Recent ledger</h2>
            <p className="text-sm text-slate-500">Your top-ups, usage, and refunds.</p>
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
              1 credit = &#8358;1. You&rsquo;ll be taken to Paystack to pay by card; your balance updates once the
              payment is confirmed. Paying by card also lets you turn on auto top-up later.
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
                <p className="mt-1 text-xs text-slate-500">
                  You&rsquo;ll pay &#8358;{Number(topUpAmount) > 0 ? Number(topUpAmount).toLocaleString() : '0'}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={submitTopUp}
                disabled={topUpPending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {topUpPending ? 'Starting payment…' : 'Continue to payment'}
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
