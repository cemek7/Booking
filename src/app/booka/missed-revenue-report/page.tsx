import type { Metadata } from 'next';
import Link from 'next/link';
import RevenueRequestForm from '@/components/booka/RevenueRequestForm';

export const metadata: Metadata = {
  title: 'Booka Missed Revenue Report',
  description:
    'Request a privacy-safe review of missed follow-up, availability dead ends and unfinished WhatsApp or Instagram enquiries.',
};

const reportOutputs = [
  'Enquiries reviewed',
  'Unanswered or materially delayed replies',
  'Conversations without a clear next step',
  'Availability enquiries that ended without alternatives',
  'Prospects who disappeared without follow-up',
  'Missed service or product recommendation opportunities',
  'An estimated recoverable opportunity range with assumptions',
];

export default function MissedRevenueReportPage() {
  return (
    <main className="min-h-screen bg-emerald-50/40 px-5 py-8 text-[#10211a] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/booka" className="text-sm font-medium text-emerald-800 hover:text-emerald-950">
          ← Back to Booka
        </Link>

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <section>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-700/60">
              Missed Revenue Report
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Find the opportunities going quiet in your inbox.
            </h1>
            <p className="mt-5 text-base leading-8 text-slate-600">
              The first version is concierge-assisted. After submission, Booka agrees a consented, minimized sample
              and privacy-safe handoff with you. Do not paste or upload customer conversations in this form.
            </p>

            <div className="mt-8 rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Your report covers</h2>
              <ul className="mt-4 space-y-3">
                {reportOutputs.map((output) => (
                  <li key={output} className="flex gap-3 text-sm leading-7 text-slate-600">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    {output}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-950">
              Opportunity values are ranges based on the supplied sample, your average transaction value and visible
              outcomes. They are planning estimates, not a revenue guarantee.
            </p>
          </section>

          <RevenueRequestForm requestType="missed_revenue_report" />
        </div>
      </div>
    </main>
  );
}
