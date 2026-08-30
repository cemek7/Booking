import Link from 'next/link';
import BrandMark from '@/components/brand/BrandMark';
import DemoConversation from '@/components/homepage/DemoConversation';
import {
  BOOKA_POSITIONING,
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

const revenueProblems = [
  {
    title: 'Capture',
    promise: 'Never lose an enquiry because nobody replied.',
    copy: 'Booka responds while the customer is still interested, answers the first question and moves the conversation towards a useful next step.',
  },
  {
    title: 'Convert',
    promise: 'Turn more conversations into booked and paying customers.',
    copy: 'It qualifies demand, recommends the right service or product, handles common objections and follows up until the opportunity has a clear outcome.',
  },
  {
    title: 'Recover',
    promise: 'Save the sale when the first choice is unavailable.',
    copy: 'Booka offers alternative times, people, services or products instead of ending the conversation at “not available”.',
  },
  {
    title: 'Grow',
    promise: 'Create repeat business from the customer base you already have.',
    copy: 'WhatsApp reminders, approved re-engagement and repeat-booking conversations help owners act on empty slots and unfinished demand.',
  },
];

const revenueSequence = ['Answer', 'Recommend', 'Sell', 'Book', 'Pay', 'Follow up', 'Retain', 'Report'];

const faqItems = [
  {
    question: 'Is Booka just booking software?',
    answer:
      'No. Booka is an AI Revenue Front Desk that handles customer conversations from enquiry to recommendation, sale, booking, follow-up and repeat business.',
  },
  {
    question: 'How does pricing work?',
    answer:
      'Plans start at ₦15k per month and include an automation and messaging allowance. Booka warns you before any overage, and extra usage is opt-in rather than a surprise bill.',
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
  'No new customer app',
  'No customer migration',
  'WhatsApp + Instagram enquiries',
  'Human takeover built in',
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
      'Handle non-clinical guidance and route appointment enquiries to the right team',
      'Explain available visit types while preserving human escalation for sensitive questions',
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
              {BOOKA_POSITIONING.category}
            </p>
            <h1 className="mt-4 text-5xl font-semibold leading-[0.94] tracking-tight text-[#10211a] sm:text-6xl lg:text-7xl">
              {BOOKA_POSITIONING.headline}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
              Booka answers customer questions, recommends the right service or product, checks availability,
              follows up, books customers and helps collect payment—while your team steps in when human judgement
              is needed.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/booka/revenue-pilot"
                className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-medium text-white shadow-[0_12px_30px_rgba(5,150,105,0.18)] transition hover:-translate-y-0.5 hover:bg-emerald-700"
              >
                Apply for the 14-Day Revenue Pilot
              </Link>
              <Link
                href="/booka/missed-revenue-report"
                className="rounded-full border border-emerald-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:text-emerald-900"
              >
                Get a Missed Revenue Report
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
                { title: 'Automated enquiry handling', copy: 'Answers questions and keeps demand moving.' },
                { title: 'Booking and selling together', copy: 'Recommends, offers alternatives and closes the next step.' },
                { title: 'Human takeover when needed', copy: 'Routes judgement calls and sensitive cases to staff.' },
              ].map((capability) => (
                <div key={capability.title} className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold leading-5 text-[#10211a]">{capability.title}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-600">{capability.copy}</div>
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

        <section aria-label="Booka revenue workflow" className="pb-20">
          <div className="rounded-[2rem] border border-emerald-100 bg-[#10211a] p-5 text-[#f5f2e8] shadow-[0_20px_60px_rgba(16,33,26,0.12)] sm:p-6">
            <p className="text-xs uppercase tracking-[0.32em] text-emerald-300/65">
              {BOOKA_POSITIONING.campaignLine}
            </p>
            <ol className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {revenueSequence.map((step, index) => (
                <li key={step} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-emerald-300/55">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <p className="mt-2 text-sm font-medium">{step}</p>
                </li>
              ))}
            </ol>
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
              <p className="text-xs uppercase tracking-[0.32em] text-emerald-700/45">Four money problems</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                Capture, convert, recover and grow.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                Booka is designed around the points where a real customer conversation can create—or quietly
                lose—revenue. The system handles the repeatable work and gives staff a clear place to step in.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {revenueProblems.map((problem) => (
                <article key={problem.title} className="rounded-[1.75rem] border border-emerald-100 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700/55">{problem.title}</p>
                  <h3 className="mt-3 text-lg font-semibold tracking-tight text-[#10211a]">{problem.promise}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{problem.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="revenue-pilot" className="scroll-mt-6 pb-20">
          <div className="overflow-hidden rounded-[2rem] border border-emerald-200 bg-emerald-50/70 shadow-sm">
            <div className="grid gap-8 p-6 lg:grid-cols-[1.05fr_0.95fr] lg:p-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-700/55">
                  Booka 14-Day Revenue Pilot
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#10211a] sm:text-4xl">
                  Put Booka on real enquiries before you decide to continue.
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-700">
                  We connect and configure Booka for 14 active days. It answers questions, recommends services or
                  products, qualifies customers, follows up, books appointments and helps close sales across eligible
                  WhatsApp and Instagram enquiry flows.
                </p>
                <div className="mt-6 rounded-3xl border border-emerald-200 bg-white p-5">
                  <p className="text-sm font-semibold text-[#10211a]">The continuation rule</p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    If the pilot does not produce at least one verified booking, sale, deposit or recovered opportunity
                    attributable to a Booka conversation, there is no obligation to continue. We do not promise a
                    specific Naira return or conversion lift.
                  </p>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-3xl border border-emerald-100 bg-white p-5">
                  <h3 className="text-lg font-semibold text-[#10211a]">Included</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                    <li>• Channel connection and live-flow test</li>
                    <li>• Catalogue, pricing, availability, FAQ and policy setup</li>
                    <li>• Booking, sales, deposit and payment-link configuration</li>
                    <li>• Follow-up, escalation, calibration and end-of-pilot report</li>
                  </ul>
                </div>
                <div className="rounded-3xl border border-emerald-100 bg-white p-5">
                  <h3 className="text-lg font-semibold text-[#10211a]">A good pilot candidate</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    Has regular weekly enquiries, accurate offers and availability, a connectable business account,
                    a staff escalation contact, and can confirm completed bookings or offline sales.
                  </p>
                  <Link
                    href="/booka/revenue-pilot"
                    className="mt-5 inline-flex rounded-full bg-emerald-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                  >
                    Apply for the pilot
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="missed-revenue-report" className="scroll-mt-6 pb-20">
          <div className="grid gap-6 rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm lg:grid-cols-[0.9fr_1.1fr] lg:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-700/55">
                Missed Revenue Report
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#10211a]">
                How much business is sitting unanswered in your inbox?
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                We review a consented, minimized sample of your WhatsApp and Instagram enquiry process and show where
                unanswered messages, missing follow-ups, availability dead ends and abandoned buying conversations
                may be costing you opportunities.
              </p>
              <Link
                href="/booka/missed-revenue-report"
                className="mt-6 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-900 transition hover:border-emerald-300"
              >
                Get a Missed Revenue Report
              </Link>
            </div>
            <div className="rounded-[1.75rem] border border-emerald-100 bg-emerald-50/60 p-5">
              <h3 className="text-lg font-semibold text-[#10211a]">What the review looks for</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  'Unanswered or materially delayed enquiries',
                  'Conversations with no clear next step',
                  'Unavailable choices offered without alternatives',
                  'Prospects who disappeared without follow-up',
                  'Missed recommendation or add-on opportunities',
                  'An estimated recoverable opportunity range',
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-emerald-100 bg-white p-4 text-sm leading-6 text-slate-600">
                    {item}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-6 text-slate-500">
                Any estimate is a range based on the supplied sample, your average transaction value and visible
                outcomes. It is an opportunity estimate, not a revenue guarantee.
              </p>
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
                  data-testid="pricing-plan"
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
                  <p data-testid="usage-policy" className="mt-5 border-t border-emerald-100 pt-4 text-xs leading-5 text-slate-500">
                    {plan.usagePolicy}
                  </p>
                </article>
              ))}
            </div>
            <p className="mt-5 text-xs leading-6 text-slate-500">
              Plans are all-inclusive within fair-use allowances. Usage alerts appear before any transparent,
              opt-in overage, and large business-initiated sends require approval.
            </p>
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
              <li>Instagram captures and converts active enquiries while the customer is inside the available messaging window.</li>
              <li>WhatsApp carries reminders, recovery and repeat-business conversations when the customer has opted in and the business uses approved messaging.</li>
              <li>Booka records both channels in one operating view while respecting each channel&apos;s consent, timing and messaging rules.</li>
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
                  href="/booka/revenue-pilot"
                  className="rounded-full bg-white px-6 py-3 text-sm font-medium text-emerald-700 shadow-sm transition hover:-translate-y-0.5"
                >
                  Apply for the revenue pilot
                </Link>
                <Link
                  href="/booka/missed-revenue-report"
                  className="rounded-full border border-white/25 bg-emerald-700 px-6 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-emerald-800"
                >
                  Request the missed revenue report
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
