import Link from 'next/link';
import BrandMark from '@/components/brand/BrandMark';
import DemoConversation from '@/components/homepage/DemoConversation';
import {
  SIAS_BILLING_PLANS,
  SIAS_OUTCOME_ATRIBUTION,
  SIAS_VERTICAL_PACKAGES,
} from '@/lib/sias';

const howItWorks = [
  {
    step: '01',
    title: 'Set up the front desk',
    copy: 'Booka learns your services, products, offers, hours, tone, and WhatsApp plus Instagram setup, then configures the front desk around how you already sell and book.',
  },
  {
    step: '02',
    title: 'Handle sales and booking together',
    copy: 'It answers questions, recommends the right service or offer, converts interest into a booking, sends reminders, and escalates edge cases instead of leaving revenue sitting in chat history.',
  },
  {
    step: '03',
    title: 'Keep getting sharper',
    copy: 'Booka remembers customer patterns, weak slots, repeat objections, and missed follow-up opportunities so the operation improves over time.',
  },
];

const features = [
  {
    title: 'WhatsApp + Instagram',
    copy: 'Customers message in the channels they already use. Booka keeps WhatsApp chats and Instagram DMs moving without extra admin or missed handoffs.',
  },
  {
    title: 'Sales + booking in one flow',
    copy: 'Booka does not stop at answering questions. It qualifies demand, recommends the right service or product, handles objections, and moves the customer into a confirmed booking.',
  },
  {
    title: 'Human escalation',
    copy: 'Sensitive cases, refunds, and conflicts move to staff when the assistant should step back.',
  },
  {
    title: 'Follow-up and recovery',
    copy: 'No-shows, drop-offs, repeat visits, and reactivation are tracked and pushed forward as part of the product, not left to chance.',
  },
];

const faqItems = [
  {
    question: 'Is Booka just booking software?',
    answer:
      'No. Booka is an AI front desk that handles sales conversations, service recommendations, booking, reminders, follow-up, escalation, and recovery in one place for service businesses.',
  },
  {
    question: 'How does pricing work?',
    answer:
      'The model is subscription plus usage plus managed service tier. Core starts at ₦15k/mo, and higher tiers add more automation and support.',
  },
  {
    question: 'Can humans still step in?',
    answer:
      'Yes. Booka routes exceptions to a person when the situation is sensitive, risky, or outside the standard workflow.',
  },
  {
    question: 'Who is this for?',
    answer:
      'Booka is built for operators who handle high-intent enquiries in chat: salons and spas, clinics and practices, and restaurants or hospitality teams.',
  },
];

const launchNotes = [
  'A Techclave product',
  'Sales + booking in one front desk',
  'WhatsApp + Instagram',
  'Managed onboarding included',
];

const verticalUseCases: Record<
  string,
  {
    sales: string[];
    booking: string[];
  }
> = {
  beauty: {
    sales: [
      'Answer treatment enquiries and recommend the right service, stylist, or add-on',
      'Convert price-sensitive chats with deposits, bundles, and repeat-visit nudges',
    ],
    booking: [
      'Book the right slot, stylist, and service combination without back-and-forth',
      'Handle reminders, reschedules, no-show recovery, and rebooking automatically',
    ],
  },
  hospitality: {
    sales: [
      'Convert dining and stay enquiries into higher-value reservations',
      'Sell deposits, premium tables, special packages, and occasion add-ons before arrival',
    ],
    booking: [
      'Confirm tables, rooms, or event slots across chat without manual inbox juggling',
      'Handle reservation reminders, guest follow-up, and abandoned booking recovery',
    ],
  },
  medicine: {
    sales: [
      'Convert non-sensitive treatment and consultation enquiries into booked visits',
      'Guide patients toward the right consultation type, test, or follow-up path',
    ],
    booking: [
      'Book appointments with the right practitioner, timing, and visit type',
      'Handle reminders, recall, follow-up, and escalation for sensitive cases',
    ],
  },
};

export default function BookaLanding() {
  const verticals = [SIAS_VERTICAL_PACKAGES[0], SIAS_VERTICAL_PACKAGES[2], SIAS_VERTICAL_PACKAGES[1]];
  const pricingPlans = SIAS_BILLING_PLANS.slice(0, 4);

  return (
    <main className="min-h-screen bg-white text-[#10211a]">
      <section className="mx-auto flex w-full max-w-7xl flex-col px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 border-b border-emerald-100/80 pb-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark variant="booka" className="h-11 w-11 shadow-sm shadow-emerald-600/20" />
            <div>
              <p className="brand-kicker text-emerald-700/65">Booka</p>
              <p className="mt-1 text-sm text-slate-500">by Techclave</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            <Link
              href="/"
              className="rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-800"
            >
              Techclave
            </Link>
            <Link
              href="#how-it-works"
              className="rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-800"
            >
              How it works
            </Link>
            <Link
              href="#pricing"
              className="rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-800"
            >
              Pricing
            </Link>
            <Link
              href="/booka/auth/onboarding"
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700"
            >
              Start onboarding
            </Link>
            <Link
              href="/booka/auth/signin"
              className="rounded-full border border-emerald-200 bg-emerald-50/60 px-4 py-2 text-sm font-medium text-emerald-900 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              Sign in
            </Link>
          </nav>
        </header>

        <section className="grid gap-12 pb-20 pt-12 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-18">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-4 py-2 text-sm text-emerald-900 shadow-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
              Booka by Techclave
            </div>

            <p className="mt-5 text-xs font-medium uppercase tracking-[0.34em] text-emerald-700/55">
              AI front desk for sales and bookings
            </p>
            <h1 className="mt-4 text-5xl font-semibold leading-[0.94] tracking-tight text-[#10211a] sm:text-6xl lg:text-7xl">
              Turn WhatsApp and Instagram enquiries into sales and confirmed bookings.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
              Booka replies fast, qualifies demand, recommends the right service or offer, books the right slot,
              sends reminders, follows up after no-shows, and hands edge cases to a human for salons, clinics, and
              hospitality teams.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/booka/auth/onboarding"
                className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-medium text-white shadow-[0_12px_30px_rgba(5,150,105,0.18)] transition hover:-translate-y-0.5 hover:bg-emerald-700"
              >
                Start managed onboarding
              </Link>
              <Link
                href="/booka/auth/signin"
                className="rounded-full border border-emerald-200 bg-emerald-50/60 px-6 py-3 text-sm font-medium text-emerald-900 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50"
              >
                Sign in to dashboard
              </Link>
              <Link
                href="#pricing"
                className="rounded-full border border-emerald-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:text-emerald-900"
              >
                See pricing
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {launchNotes.map((note) => (
                <span
                  key={note}
                  className="rounded-full border border-emerald-100 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm"
                >
                  {note}
                </span>
              ))}
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                { value: '< 1 min', label: 'Lead response time' },
                { value: '40%', label: 'No-show reduction' },
                { value: '₦3.6m', label: 'Revenue recovered' },
              ].map((metric) => (
                <div key={metric.label} className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <div className="text-[11px] uppercase tracking-[0.26em] text-emerald-700/45">{metric.label}</div>
                  <div className="mt-3 text-2xl font-semibold text-[#10211a]">{metric.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-[2.5rem] bg-emerald-100/35 blur-3xl" />
            <div className="relative">
              <DemoConversation />
            </div>
          </div>
        </section>

        <section id="how-it-works" className="pb-20">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-700/45">How it works</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                Set it up once. Let it run.
              </h2>
            </div>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {howItWorks.map((item) => (
              <article key={item.step} className="rounded-[1.75rem] border border-emerald-100 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700/45">{item.step}</p>
                <h3 className="mt-4 text-2xl font-semibold tracking-tight text-[#10211a]">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pb-20">
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm">
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-700/45">Features & benefits</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                Built for the front-desk work teams repeat every day.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                Booka feels simple on the surface because the infrastructure stays in the background. What your
                team sees is faster replies, fewer missed leads, better conversion, and a calmer workflow across chat and DMs.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {features.map((feature) => (
                <article key={feature.title} className="rounded-[1.75rem] border border-emerald-100 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-semibold tracking-tight text-[#10211a]">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{feature.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="pb-20">
          <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-emerald-100 pb-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs uppercase tracking-[0.32em] text-emerald-700/45">Pricing</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                  Simple, transparent pricing.
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Start with the core subscription, add more automation as volume grows, and move into managed ops
                  when you want Booka to carry more of the sales, booking, and follow-up workload across WhatsApp and Instagram.
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Core starts at <span className="font-semibold">₦15k/mo</span>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {pricingPlans.map((plan) => (
                <article
                  key={plan.id}
                  className={`rounded-[1.5rem] border p-5 ${
                    plan.id === 'front-desk'
                      ? 'border-emerald-300 bg-emerald-50/80 shadow-sm'
                      : 'border-emerald-100 bg-white shadow-sm'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/55">{plan.name}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-[#10211a]">{plan.price}</p>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{plan.description}</p>
                  <div className="mt-5 space-y-2">
                    {plan.included.map((item) => (
                      <div key={item} className="text-sm text-slate-600">
                        • {item}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pb-20">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-700/45">ICP focus</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                One front desk. Three high-value use-case clusters.
              </h2>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {verticals.map((vertical) => (
              <article key={vertical.id} className="rounded-[1.75rem] border border-emerald-100 bg-white p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.3em] text-emerald-700/45">{vertical.subtitle}</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-[#10211a]">
                  {vertical.id === 'beauty'
                    ? 'Beauty & Wellness'
                    : vertical.id === 'hospitality'
                      ? 'Hospitality'
                      : 'Clinics & Practices'}
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{vertical.positioning}</p>
                <p className="mt-4 text-sm font-medium text-emerald-700">{vertical.managedPromise}</p>
                <div className="mt-5 grid gap-4">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700/70">
                      Sales use cases
                    </p>
                    <div className="mt-3 space-y-2">
                      {verticalUseCases[vertical.id]?.sales.map((useCase) => (
                        <p key={useCase} className="text-sm leading-6 text-slate-700">
                          {useCase}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700/70">
                      Booking use cases
                    </p>
                    <div className="mt-3 space-y-2">
                      {verticalUseCases[vertical.id]?.booking.map((useCase) => (
                        <p key={useCase} className="text-sm leading-6 text-slate-700">
                          {useCase}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {vertical.defaultFlows.map((flow) => (
                    <span key={flow} className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-800">
                      {flow}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-4 rounded-[1.75rem] border border-emerald-100 bg-[#10211a] p-6 text-[#f5f2e8] shadow-[0_20px_60px_rgba(16,33,26,0.12)]">
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-300/65">Channel strategy</p>
            <ul className="mt-4 grid gap-4 text-sm leading-7 text-[#d7ddd9] lg:grid-cols-3">
              <li>WhatsApp carries the bulk of qualification, booking, reminder, and recovery flows for teams that already operate in chat.</li>
              <li>Instagram fits best at the enquiry, lead-capture, and conversion stage, especially when customers discover the business through content first.</li>
              <li>Booka keeps both channels inside one operating layer so sales conversations and bookings do not break across fragmented inboxes.</li>
            </ul>
          </div>
        </section>

        <section className="pb-20">
          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm">
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-700/45">Outcome signals</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                What Booka measures for you.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                These are the numbers that matter when the product becomes an operating layer instead of just a
                calendar or inbox.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {SIAS_OUTCOME_ATRIBUTION.map((signal) => (
                <article key={signal.id} className="rounded-[1.5rem] border border-emerald-100 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-semibold tracking-tight text-[#10211a]">{signal.label}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{signal.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pb-20">
          <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-emerald-700/45">FAQ</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                  A few questions people ask before they start.
                </h2>
              </div>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {faqItems.map((item) => (
                <article key={item.question} className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/50 p-5">
                  <h3 className="text-lg font-semibold tracking-tight text-[#10211a]">{item.question}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pb-6">
          <div className="rounded-[2rem] border border-emerald-100 bg-emerald-600 px-6 py-8 text-white shadow-[0_20px_80px_rgba(5,150,105,0.18)]">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.34em] text-emerald-50/70">Start here</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Put Booka in front of your WhatsApp and Instagram enquiries without changing how your team already works.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-emerald-50/85">
                  Customers keep messaging the way they already do. Booka handles sales conversations, booking flow,
                  reminders, and follow-up, and your team steps in only where judgement matters.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 lg:justify-end">
                <Link
                  href="/booka/auth/onboarding"
                  className="rounded-full bg-white px-6 py-3 text-sm font-medium text-emerald-700 shadow-sm transition hover:-translate-y-0.5"
                >
                  Start managed onboarding
                </Link>
                <Link
                  href="#pricing"
                  className="rounded-full border border-white/25 bg-emerald-700 px-6 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-emerald-800"
                >
                  Review pricing
                </Link>
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-4 border-t border-emerald-100 pt-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Booka • by Techclave</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="transition hover:text-emerald-900">
              Techclave
            </Link>
            <Link href="/showcase" className="transition hover:text-emerald-900">
              Capabilities
            </Link>
            <Link href="/booka/auth/signin" className="transition hover:text-emerald-900">
              Sign in
            </Link>
            <Link href="/booka/auth/onboarding" className="transition hover:text-emerald-900">
              Start onboarding
            </Link>
          </div>
        </footer>
      </section>
    </main>
  );
}
