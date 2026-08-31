'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { RevenueFrontDeskReport as RevenueFrontDeskReportData } from '@/lib/analytics/revenue-front-desk-report';

const PERIOD_OPTIONS = [
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
] as const;

function buildPeriod(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function isEmpty(report: RevenueFrontDeskReportData) {
  return Object.values(report.funnel).every((value) => value === 0)
    && Object.values(report.revenue).every((value) => value === 0)
    && Object.values(report.handling).every((value) => value === 0);
}

export default function RevenueFrontDeskReport() {
  const [days, setDays] = useState(14);
  const [report, setReport] = useState<RevenueFrontDeskReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const period = buildPeriod(days);
    const params = new URLSearchParams(period);

    authFetch<RevenueFrontDeskReportData>(`/api/analytics/revenue-front-desk?${params}`)
      .then((response) => {
        if (!active) return;
        if (response.error || !response.data) {
          throw new Error(response.error?.message ?? 'The report could not be loaded');
        }
        setReport(response.data);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setReport(null);
        setError(loadError instanceof Error ? loadError.message : 'The report could not be loaded');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [days]);

  const money = useMemo(() => {
    const currency = report?.currency ?? 'NGN';
    try {
      return new Intl.NumberFormat(currency === 'NGN' ? 'en-NG' : undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }, [report?.currency]);

  const formatMoney = (cents: number) => money.format(cents / 100);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-emerald-950/10 bg-[#f4f7ef] shadow-[0_24px_70px_-45px_rgba(6,78,59,0.65)]">
      <div className="relative overflow-hidden bg-[#10231d] px-6 py-7 text-white sm:px-8 lg:px-10">
        <div aria-hidden="true" className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">Booka outcome ledger</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">Revenue front desk report</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50/70">
              Verified commercial outcomes from enquiry to payment, kept separate by what Booka processed, influenced, or recovered.
            </p>
          </div>
          <label className="flex w-fit flex-col gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100/70">
            Report period
            <select
              aria-label="Report period"
              value={days}
              onChange={(event) => {
                setLoading(true);
                setDays(Number(event.target.value));
              }}
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium normal-case tracking-normal text-white outline-none ring-emerald-300 transition focus:ring-2"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="text-slate-900">{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="p-5 sm:p-7 lg:p-8">
        {loading && (
          <div className="rounded-2xl border border-emerald-950/10 bg-white px-5 py-8 text-sm text-slate-600">
            Building the revenue report from verified outcomes…
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && report && isEmpty(report) && (
          <div className="rounded-2xl border border-dashed border-emerald-900/20 bg-white/80 px-6 py-10 text-center">
            <p className="text-base font-semibold text-slate-900">No Booka outcomes were recorded for this period.</p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
              This is an empty evidence window—not a zero-revenue claim. Check channel event capture and payment attribution before drawing a conclusion.
            </p>
          </div>
        )}

        {!loading && !error && report && !isEmpty(report) && (
          <div className="space-y-6">
            <div className="grid gap-3 lg:grid-cols-3">
              {[
                {
                  label: 'Processed revenue',
                  value: report.revenue.processed_cents,
                  note: 'Verified payments Booka handled. This does not claim Booka created the original demand.',
                  accent: 'border-sky-200 bg-sky-50/80 text-sky-950',
                },
                {
                  label: 'Influenced revenue',
                  value: report.revenue.influenced_cents,
                  note: 'Verified outcomes where a Booka recommendation or sales step influenced the journey.',
                  accent: 'border-violet-200 bg-violet-50/80 text-violet-950',
                },
                {
                  label: 'Recovered revenue',
                  value: report.revenue.recovered_cents,
                  note: 'Verified outcomes recovered after a follow-up, alternative, or save-the-sale action.',
                  accent: 'border-emerald-200 bg-emerald-50/90 text-emerald-950',
                },
              ].map((item) => (
                <article key={item.label} className={`rounded-2xl border p-5 ${item.accent}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-65">{item.label}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight">{formatMoney(item.value)}</p>
                  <p className="mt-3 text-xs leading-5 opacity-70">{item.note}</p>
                </article>
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
              <article className="rounded-2xl border border-emerald-950/10 bg-white p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Conversion path</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">Enquiry → Qualified → Booking/Sale → Payment</h3>
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(report.period.start).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
                    {' – '}
                    {new Date(report.period.end).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
                  </p>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-emerald-950/10 sm:grid-cols-4">
                  {[
                    { label: 'Enquiry', value: String(report.funnel.enquiries) },
                    { label: 'Qualified', value: String(report.funnel.qualified) },
                    { label: 'Booking / sale', value: `${report.funnel.bookings} / ${report.funnel.sales}` },
                    { label: 'Payment', value: String(report.funnel.deposits_or_payments) },
                  ].map((step) => (
                    <div key={step.label} className="bg-[#fbfcf8] px-4 py-5">
                      <p className="text-xs text-slate-500">{step.label}</p>
                      <p className="mt-1 text-2xl font-semibold text-slate-950">{step.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <p className="rounded-xl bg-slate-50 px-4 py-3"><span className="font-semibold text-slate-950">{report.funnel.followups_sent}</span> <span className="text-slate-600">follow-ups sent</span></p>
                  <p className="rounded-xl bg-slate-50 px-4 py-3"><span className="font-semibold text-slate-950">{report.funnel.recovered_opportunities}</span> <span className="text-slate-600">verified recoveries</span></p>
                  <p className="rounded-xl bg-slate-50 px-4 py-3"><span className="font-semibold text-slate-950">{report.funnel.escalations}</span> <span className="text-slate-600">human escalations</span></p>
                </div>
              </article>

              <article className="rounded-2xl border border-emerald-950/10 bg-white p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Conversation handling</p>
                <div className="mt-5 space-y-4">
                  {[
                    { label: 'Automated', value: report.handling.automated },
                    { label: 'Human-assisted', value: report.handling.human },
                    { label: 'Unresolved', value: report.handling.unresolved },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
                      <span className="text-sm text-slate-600">{item.label}</span>
                      <span className="text-xl font-semibold text-slate-950">{item.value}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            {report.completeness.offline_confirmation_required && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
                <p className="font-semibold">Some outcomes need human confirmation before they can be treated as money.</p>
                <p className="mt-1">
                  {report.completeness.unverified_attributions} attribution records still need verification.{' '}
                  {report.completeness.missing_amount_events} outcome records are missing an explicit amount or currency.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
