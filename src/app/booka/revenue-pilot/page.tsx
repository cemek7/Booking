import type { Metadata } from 'next';
import Link from 'next/link';
import RevenueRequestForm from '@/components/booka/RevenueRequestForm';

export const metadata: Metadata = {
  title: 'Booka 14-Day Revenue Pilot',
  description:
    'Apply to test Booka on real WhatsApp and Instagram enquiries for 14 active days after configuration and live-channel verification.',
};

export default function RevenuePilotPage() {
  return (
    <main className="min-h-screen bg-emerald-50/40 px-5 py-8 text-[#10211a] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/booka" className="text-sm font-medium text-emerald-800 hover:text-emerald-950">
          ← Back to Booka
        </Link>

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <section>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-700/60">
              Booka 14-Day Revenue Pilot
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Test Booka against real customer enquiries.
            </h1>
            <p className="mt-5 text-base leading-8 text-slate-600">
              This is a qualified, managed pilot—not automatic account provisioning. We first confirm fit, configure
              your offers and rules, connect the eligible channels and complete a successful live-channel test.
              The 14 active days begin after that verification.
            </p>

            <div className="mt-8 grid gap-4">
              <article className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">What setup includes</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Catalogue, price, availability, FAQ and policy setup; booking, deposit and payment-link rules;
                  follow-up and escalation controls; monitoring, calibration and an end-of-pilot report.
                </p>
              </article>
              <article className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Who qualifies</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Businesses with meaningful weekly enquiry volume, accurate operating information, a connectable
                  WhatsApp or Instagram business account, a staff escalation contact and the ability to confirm
                  completed bookings or offline sales.
                </p>
              </article>
              <article className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">How success is judged</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  At least one verified booking, sale, deposit or recovered opportunity must connect to a Booka
                  journey. The pilot does not promise a specific Naira return, conversion lift or no-show reduction.
                </p>
              </article>
            </div>
          </section>

          <RevenueRequestForm requestType="revenue_pilot" />
        </div>
      </div>
    </main>
  );
}
