import Link from 'next/link';
import BrandMark from '@/components/brand/BrandMark';
import CtaLink from '@/components/homepage/CtaLink';
import DemoConversation from '@/components/homepage/DemoConversation';
import MobileNav from '@/components/homepage/MobileNav';
import Panel from '@/components/homepage/Panel';
import SectionHeading from '@/components/homepage/SectionHeading';
import { BOOKA_POSITIONING, SIAS_BILLING_PLANS, SIAS_VERTICAL_PACKAGES } from '@/lib/sias';

const revenueProblems = [
  {
    title: 'Capture',
    promise: 'Never lose an enquiry because nobody replied.',
    copy: 'Booka replies while the customer is still interested and moves them to a useful next step.',
  },
  {
    title: 'Convert',
    promise: 'Turn more conversations into booked and paying customers.',
    copy: 'It qualifies demand, recommends the right service and follows up until there is a clear outcome.',
  },
  {
    title: 'Recover',
    promise: 'Save the sale when the first choice is unavailable.',
    copy: 'Booka offers other times, people, services or products instead of stopping at “not available”.',
  },
  {
    title: 'Grow',
    promise: 'Create repeat business from the customers you already have.',
    copy: 'Opted-in WhatsApp reminders, approved re-engagement and repeat-booking conversations help fill empty slots.',
  },
];

const revenueSequence = ['Answer', 'Recommend', 'Sell', 'Book', 'Pay', 'Follow up', 'Retain', 'Report'];

const channelRules = [
  {
    channel: 'Instagram',
    rule: 'Captures and converts active enquiries inside the available messaging window.',
  },
  {
    channel: 'WhatsApp',
    rule: 'Carries reminders, recovery and repeat business when the customer has opted in and approved messaging is used.',
  },
  {
    channel: 'One view',
    rule: 'Both channels are recorded together while respecting each channel’s consent, timing and messaging rules.',
  },
];

const verticalNames: Record<string, string> = {
  beauty: 'Beauty & wellness',
  hospitality: 'Hospitality',
  medicine: 'Clinics & practices',
};

const verticalLines: Record<string, string> = {
  beauty: 'Recommends the right service, stylist or add-on, takes the deposit and books the slot.',
  hospitality: 'Turns dining and stay enquiries into confirmed reservations, with deposits and add-ons before arrival.',
  medicine: 'Routes appointment enquiries to the right practitioner and keeps sensitive questions with your staff.',
};

const pilotIncluded = [
  'Channel connection and live-flow test',
  'Catalogue, pricing, availability, FAQ and policy setup',
  'Booking, sales, deposit and payment-link configuration',
  'Follow-up, escalation, calibration and end-of-pilot report',
];

const reportChecks = [
  'Unanswered or materially delayed enquiries',
  'Conversations with no clear next step',
  'Unavailable choices offered without alternatives',
  'Prospects who disappeared without follow-up',
  'Missed recommendation or add-on opportunities',
  'An estimated recoverable opportunity range',
];

const faqItems = [
  {
    question: 'Is Booka just booking software?',
    answer:
      'No. Booka is an AI Revenue Front Desk. It handles the conversation from enquiry to recommendation, sale, booking, follow-up and repeat business.',
  },
  {
    question: 'How does pricing work?',
    answer:
      'Plans start at ₦15k per month and include an automation and messaging allowance. Booka warns you before any overage, and extra usage is opt-in.',
  },
  {
    question: 'Can humans still step in?',
    answer: 'Yes. Booka routes a conversation to a person when it is sensitive, risky or outside the normal flow.',
  },
  {
    question: 'Who is this for?',
    answer:
      'Businesses that get high-intent enquiries in chat: salons and spas, clinics and practices, restaurants and hospitality teams.',
  },
];

const launchNotes = [
  'No new customer app',
  'No customer migration',
  'WhatsApp + Instagram enquiries',
  'Human takeover built in',
];

const navLink =
  'inline-flex min-h-11 items-center rounded-sm text-sm text-[#46514e] transition md:min-h-0 hover:text-[var(--brand-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--booka-green)]';

const sectionRule = 'border-t border-[var(--brand-line)] py-16 sm:py-20';

export default function BookaLanding() {
  const verticals = [SIAS_VERTICAL_PACKAGES[0], SIAS_VERTICAL_PACKAGES[2], SIAS_VERTICAL_PACKAGES[1]];
  const pricingPlans = SIAS_BILLING_PLANS.slice(0, 4);

  return (
    <main className="min-h-screen bg-[var(--brand-paper)] text-[var(--brand-ink)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 pb-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark variant="booka" className="h-11 w-11" />
            <div>
              <p className="brand-kicker text-[var(--brand-moss)]">Booka</p>
              <p className="mt-1 text-sm text-[#5a625f]">by Techclave</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/" className={navLink}>
              Techclave
            </Link>
            <Link href="#how-it-works" className={navLink}>
              How it works
            </Link>
            <Link href="#pricing" className={navLink}>
              Pricing
            </Link>
            <Link href="/booka/auth/signin" className={navLink}>
              Sign in
            </Link>
            <CtaLink href="/booka/auth/onboarding" className="!px-5 !py-2.5">
              Start onboarding
            </CtaLink>
          </nav>
          <MobileNav
            links={[
              { href: '/', label: 'Techclave' },
              { href: '#how-it-works', label: 'How it works' },
              { href: '#pricing', label: 'Pricing' },
              { href: '/booka/auth/signin', label: 'Sign in' },
            ]}
            cta={{ href: '/booka/auth/onboarding', label: 'Start onboarding' }}
          />
        </header>

        <section className="grid gap-12 pb-20 pt-10 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pt-16">
          <div>
            <SectionHeading
              as="h1"
              kicker={BOOKA_POSITIONING.category}
              title={BOOKA_POSITIONING.headline}
              lede="Booka answers customer questions, recommends the right service or product, checks availability, follows up, books customers and helps collect payment—while your team steps in when human judgement is needed."
            />
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <CtaLink href="/booka/revenue-pilot">Apply for the 14-Day Revenue Pilot</CtaLink>
              <CtaLink href="/booka/missed-revenue-report" variant="text">
                Get a Missed Revenue Report
              </CtaLink>
            </div>
            <p className="mt-8 text-sm text-[#5a625f]">{launchNotes.join(' · ')}</p>
          </div>

          <DemoConversation />
        </section>

        <Panel tone="dark" as="section" id="how-it-works" className="scroll-mt-6 p-6 sm:p-8">
          <p className="brand-kicker text-[var(--brand-gold)]">{BOOKA_POSITIONING.campaignLine}</p>
          <ol className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-8">
            {revenueSequence.map((step, index) => (
              <li key={step} className="border-l border-white/15 pl-3">
                <span className="text-xs tabular-nums text-[var(--brand-gold)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="mt-1 text-sm font-semibold">{step}</p>
              </li>
            ))}
          </ol>
          <dl className="mt-8 grid gap-5 border-t border-white/10 pt-6 text-sm leading-6 md:grid-cols-[repeat(3,minmax(0,1fr))]">
            {channelRules.map((item) => (
              <div key={item.channel}>
                <dt className="font-semibold text-[var(--brand-paper)]">{item.channel}</dt>
                <dd className="mt-1 text-[#c9d2cd]">{item.rule}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <section className="py-16 sm:py-20">
          <SectionHeading kicker="Four money problems" title="Capture, convert, recover, grow." />
          <div className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {revenueProblems.map((problem) => (
              <div key={problem.title} className="border-t border-[var(--brand-line)] pt-5">
                <p className="brand-kicker text-[var(--booka-green-strong)]">{problem.title}</p>
                <h3 className="mt-3 text-xl font-semibold tracking-tight">{problem.promise}</h3>
                <p className="mt-2 max-w-[52ch] text-[#4f5d59]">{problem.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={sectionRule}>
          <SectionHeading kicker="Who it's for" title="One front desk, shaped to your business." />
          <div className="mt-10 divide-y divide-[var(--brand-line)]">
            {verticals.map((vertical) => (
              <div key={vertical.id} className="grid gap-3 py-6 lg:grid-cols-[0.8fr_1.4fr_1.2fr] lg:items-baseline lg:gap-8">
                <div>
                  <h3 className="text-xl font-semibold tracking-tight">{verticalNames[vertical.id] ?? vertical.name}</h3>
                  <p className="mt-1 text-sm text-[#5a625f]">{vertical.subtitle}</p>
                </div>
                <p className="text-[#4f5d59]">{verticalLines[vertical.id] ?? vertical.managedPromise}</p>
                <ul className="flex flex-wrap gap-2">
                  {vertical.defaultFlows.map((flow) => (
                    <li
                      key={flow}
                      className="rounded-md bg-[var(--brand-paper-strong)] px-2.5 py-1 text-xs text-[var(--brand-ink-soft)]"
                    >
                      {flow}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <Panel as="section" id="revenue-pilot" className="scroll-mt-6 p-6 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <SectionHeading
                kicker="Booka 14-Day Revenue Pilot"
                title="Put Booka on real enquiries before you decide to continue."
                lede="We connect Booka to your eligible WhatsApp and Instagram enquiries. For 14 active days it answers questions, recommends services and products, qualifies customers, follows up, books appointments and helps close sales."
              />
              <div className="mt-8 border-l-2 border-[var(--booka-green)] pl-5">
                <p className="font-semibold">The continuation rule</p>
                <p className="mt-2 text-sm leading-7 text-[#4f5d59]">
                  If the pilot does not produce at least one verified booking, sale, deposit or recovered opportunity
                  attributable to a Booka conversation, there is no obligation to continue. We do not promise a
                  specific Naira return or conversion lift.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="text-lg font-semibold">Included</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#4f5d59]">
                  {pilotIncluded.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true" className="text-[var(--booka-green)]">
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold">A good pilot candidate</h3>
                <p className="mt-3 text-sm leading-7 text-[#4f5d59]">
                  Gets regular weekly enquiries, has accurate offers and availability, a connectable business account,
                  a staff escalation contact, and can confirm completed bookings or offline sales.
                </p>
              </div>
              <CtaLink href="/booka/revenue-pilot" className="self-start">
                Apply for the pilot
              </CtaLink>
            </div>
          </div>
        </Panel>

        <section id="missed-revenue-report" className="scroll-mt-6 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <SectionHeading
                kicker="Missed Revenue Report"
                title="How much business is sitting unanswered in your inbox?"
                lede="We review a consented, minimized sample of your WhatsApp and Instagram enquiry process and identify unanswered messages, missing follow-ups, availability dead ends, abandoned buying conversations and missed recommendation opportunities."
              />
              <CtaLink href="/booka/missed-revenue-report" variant="text" className="mt-6">
                Get a Missed Revenue Report
              </CtaLink>
            </div>
            <div>
              <h3 className="font-semibold">What the review looks for</h3>
              <ul className="mt-4 grid gap-x-8 gap-y-3 text-sm leading-6 text-[#4f5d59] sm:grid-cols-2">
                {reportChecks.map((item) => (
                  <li key={item} className="border-t border-[var(--brand-line)] pt-3">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs leading-6 text-[#5a625f]">
                Any estimate is a range based on the supplied sample, your average transaction value and visible
                outcomes. It is an opportunity estimate, not a revenue guarantee.
              </p>
            </div>
          </div>
        </section>

        <section id="pricing" className={`scroll-mt-6 ${sectionRule}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              kicker="Pricing"
              title="Simple, transparent pricing."
              lede="Start with the core plan. Add automation and managed help as your volume grows."
            />
            <p className="text-sm text-[#4f5d59]">
              Core starts at <span className="font-semibold text-[var(--brand-ink)]">₦15k/mo</span>
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {pricingPlans.map((plan) => {
              const recommended = plan.id === 'front-desk';
              return (
                <article
                  key={plan.id}
                  data-testid="pricing-plan"
                  className={`flex flex-col rounded-[1.25rem] p-6 ${
                    recommended
                      ? 'bg-[var(--brand-ink)] text-[var(--brand-paper)] shadow-[0_24px_60px_rgba(16,33,26,0.18)]'
                      : 'border border-[var(--brand-line)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm font-semibold ${recommended ? 'text-[var(--brand-gold)]' : 'text-[var(--brand-moss)]'}`}>
                      {plan.name}
                    </p>
                    {recommended ? (
                      <span className="rounded-md bg-[var(--brand-gold)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-ink)]">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{plan.price}</p>
                  <p className={`mt-3 text-sm leading-6 ${recommended ? 'text-[#d7ddd9]' : 'text-[#4f5d59]'}`}>
                    {plan.description}
                  </p>
                  <ul className={`mt-5 space-y-2 text-sm ${recommended ? 'text-[#e6ebe8]' : 'text-[#4f5d59]'}`}>
                    {plan.included.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-5">
                    <p
                      data-testid="usage-policy"
                      className={`border-t pt-4 text-xs leading-5 ${
                        recommended ? 'border-white/15 text-[#c9d2cd]' : 'border-[var(--brand-line)] text-[#5a625f]'
                      }`}
                    >
                      {plan.usagePolicy}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-5 text-xs leading-6 text-[#5a625f]">
            Plans are all-inclusive within fair-use allowances. Usage alerts appear before any transparent, opt-in
            overage, and large business-initiated sends require approval.
          </p>
        </section>

        <section className={sectionRule}>
          <SectionHeading kicker="FAQ" title="Questions people ask before they start." />
          <dl className="mt-10 grid gap-x-12 gap-y-8 lg:grid-cols-2">
            {faqItems.map((item) => (
              <div key={item.question}>
                <dt className="text-lg font-semibold tracking-tight">{item.question}</dt>
                <dd className="mt-2 max-w-[60ch] leading-7 text-[#4f5d59]">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={`${sectionRule} grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end`}>
          <SectionHeading
            kicker="Start here"
            title="Put Booka in front of your enquiries without changing how your team works."
          />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4 lg:justify-end">
            <CtaLink href="/booka/revenue-pilot">Apply for the revenue pilot</CtaLink>
            <CtaLink href="/booka/missed-revenue-report" variant="text">
              Request the missed revenue report
            </CtaLink>
          </div>
        </section>

        <footer className="flex flex-col gap-4 border-t border-[var(--brand-line)] pt-8 text-sm text-[#5a625f] sm:flex-row sm:items-center sm:justify-between">
          <p>Booka · by Techclave</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/" className={navLink}>
              Techclave
            </Link>
            <Link href="/showcase" className={navLink}>
              Capabilities
            </Link>
            <Link href="/booka/auth/signin" className={navLink}>
              Sign in
            </Link>
            <Link href="/booka/auth/onboarding" className={navLink}>
              Start onboarding
            </Link>
            <Link href="/privacy" className={navLink}>
              Privacy
            </Link>
            <Link href="/terms" className={navLink}>
              Terms
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
