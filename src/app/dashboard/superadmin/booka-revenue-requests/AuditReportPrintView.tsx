'use client';

import type { AuditSummary } from '@/lib/booka/revenue-intake';

function ngn(value: number) {
  return `₦${Math.round(value).toLocaleString('en-US')}`;
}

const countLabels: Array<[keyof AuditSummary, string]> = [
  ['enquiries_reviewed', 'Enquiries reviewed'],
  ['unanswered_or_delayed', 'Unanswered or delayed'],
  ['missing_next_step', 'Missing a clear next step'],
  ['availability_dead_ends', 'Availability dead ends'],
  ['missing_follow_ups', 'Missing follow-ups'],
  ['missed_recommendations', 'Missed recommendations'],
];

export default function AuditReportPrintView({
  businessName,
  createdAt,
  summary,
}: {
  businessName: string;
  createdAt: string;
  summary: AuditSummary;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-950 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Booka Missed Revenue Report</p>
          <h3 className="mt-2 text-3xl font-semibold tracking-tight">{businessName}</h3>
          <p className="mt-2 text-sm text-slate-500">
            Prepared {new Date(createdAt).toLocaleDateString('en-NG', { dateStyle: 'long' })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="print:hidden rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
        >
          Print or save as PDF
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {countLabels.map(([key, label]) => (
          <div key={key} className="rounded-xl border border-slate-200 p-4 print:break-inside-avoid">
            <p className="text-xs leading-5 text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{summary[key] as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5 print:break-inside-avoid">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Estimated opportunity range</p>
        <p className="mt-2 text-3xl font-semibold text-emerald-950">
          {ngn(summary.opportunity_low_ngn)}–{ngn(summary.opportunity_high_ngn)}
        </p>
      </div>

      <div className="mt-6 print:break-inside-avoid">
        <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Assumptions</h4>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {summary.assumptions.map((assumption) => (
            <li key={assumption} className="text-sm leading-6 text-slate-600">
              {assumption}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
        This is an opportunity estimate, not a revenue guarantee. It is based on the agreed sample, merchant-supplied
        values and visible outcomes at the time of review.
      </p>
    </section>
  );
}
