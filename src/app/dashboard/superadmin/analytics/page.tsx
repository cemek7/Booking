export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import SuperAdminMetrics from '@/components/analytics/SuperAdminMetrics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BadgeCheck, Database, Gauge, Globe, MessagesSquare, ReceiptText, TrendingUp, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import SystemHealthCards from '@/components/superadmin/SystemHealthCards';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { buildBookaUnitEconomics } from '@/lib/analytics/booka-unit-economics';

export const metadata: Metadata = {
  title: 'Platform Analytics | Booka',
  description: 'System-wide analytics and platform health metrics',
};

async function loadBookaUnitEconomics() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  try {
    return await buildBookaUnitEconomics(createSupabaseAdminClient(), {
      start: start.toISOString(),
      end: end.toISOString(),
    });
  } catch {
    return null;
  }
}

function credits(value: number | null) {
  if (value === null) return '—';
  return `${value.toLocaleString('en-NG', { maximumFractionDigits: 4 })} credits`;
}

export default async function SuperAdminAnalyticsPage() {
  await requireAuth(['superadmin']);
  const unitEconomics = await loadBookaUnitEconomics();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Platform Analytics
          </h1>
          <p className="text-muted-foreground">
            System-wide metrics, tenant performance, and platform health
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/superadmin">← Back to Dashboard</Link>
          </Button>
          <Button variant="outline">
            <Database className="h-4 w-4 mr-2" />
            System Report
          </Button>
        </div>
      </div>

      {/* System Health Status */}
      <SystemHealthCards />

      {/* Main Analytics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Platform-Wide Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SuperAdminMetrics />
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-800 bg-slate-950 text-slate-50 shadow-xl">
        <CardHeader className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_42%)] pb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">Internal only · Last 30 days</p>
              <CardTitle className="mt-2 flex items-center gap-2 text-xl text-white">
                <Gauge className="h-5 w-5 text-emerald-300" />
                Booka Unit Economics
              </CardTitle>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Ledger-derived revenue and provider cost. Customer-facing reports never expose these figures.
              </p>
            </div>
            {unitEconomics && !unitEconomics.totals.cost_capture_complete && (
              <span className="w-fit rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-200">
                Incomplete provider-cost capture
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          {!unitEconomics ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-5 py-6 text-sm text-slate-400">
              Unit economics are unavailable until the attribution schema and finance-ledger queries are ready.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: 'Recognized revenue', value: credits(unitEconomics.totals.recognized_revenue_credits), icon: WalletCards },
                  { label: 'Provider cost', value: credits(unitEconomics.totals.provider_cost_credits), icon: ReceiptText },
                  { label: 'Gross contribution', value: credits(unitEconomics.totals.gross_contribution_credits), icon: TrendingUp },
                  {
                    label: 'Gross margin',
                    value: unitEconomics.totals.gross_margin_percent === null
                      ? '—'
                      : `${unitEconomics.totals.gross_margin_percent.toFixed(1)}%`,
                    icon: Gauge,
                  },
                  { label: 'Verified outcomes', value: unitEconomics.totals.verified_outcomes.toLocaleString(), icon: BadgeCheck },
                  {
                    label: 'Cost / verified outcome',
                    value: credits(unitEconomics.totals.cost_per_verified_outcome_credits),
                    icon: MessagesSquare,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-400">
                      <Icon className="h-4 w-4 text-emerald-300" /> {label}
                    </div>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-white/[0.05] text-xs uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Tenant</th>
                      <th className="px-4 py-3 text-right font-medium">Revenue</th>
                      <th className="px-4 py-3 text-right font-medium">Cost</th>
                      <th className="px-4 py-3 text-right font-medium">Contribution</th>
                      <th className="px-4 py-3 text-right font-medium">Conversations</th>
                      <th className="px-4 py-3 text-right font-medium">Verified outcomes</th>
                      <th className="px-4 py-3 font-medium">Cost capture</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {unitEconomics.tenants.map((tenant) => (
                      <tr key={tenant.tenant_id} className="text-slate-300">
                        <td className="px-4 py-3 font-mono text-xs text-slate-200">{tenant.tenant_id}</td>
                        <td className="px-4 py-3 text-right">{credits(tenant.recognized_revenue_credits)}</td>
                        <td className="px-4 py-3 text-right">{credits(tenant.provider_cost_credits)}</td>
                        <td className="px-4 py-3 text-right text-emerald-300">{credits(tenant.gross_contribution_credits)}</td>
                        <td className="px-4 py-3 text-right">{tenant.conversation_volume}</td>
                        <td className="px-4 py-3 text-right">{tenant.verified_outcomes}</td>
                        <td className="px-4 py-3">
                          <span className={tenant.cost_capture_complete ? 'text-emerald-300' : 'text-amber-300'}>
                            {tenant.cost_capture_complete ? 'Complete' : 'Incomplete'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Additional System Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operational Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Operational metrics are now sourced from the live system dashboard feed.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
