import Link from 'next/link';
import BrandMark from '@/components/brand/BrandMark';

const productCards = [
  {
    name: 'Booka',
    stage: 'Live product',
    summary:
      'AI Revenue Front Desk for service businesses. It converts active WhatsApp and Instagram enquiries, recommends the right offer, books customers, helps collect payment and follows up.',
    href: '/booka',
    accent: 'emerald',
  },
  {
    name: 'Managed Ops',
    stage: 'Platform layer',
    summary: 'The operations layer behind every product: queues, retries, handoffs, and learning loops that keep the AI accountable.',
    href: '/dashboard/ops',
    accent: 'slate',
  },
  {
    name: 'More products',
    stage: 'Coming next',
    summary: 'Techclave is a product house. Booka is first. New products launch beside it, each focused on one hard workflow.',
    href: '#roadmap',
    accent: 'amber',
  },
];

const principles = [
  'Every product solves one hard workflow end to end — not a little bit of everything.',
  'The AI does the repetitive work. Your team steps in only where judgement matters.',
  'We build for how African businesses actually operate: on chat, in real time, in local context.',
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f5ef] text-[#10211a]">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(5,150,105,0.12),_transparent_30%),radial-gradient(circle_at_80%_20%,_rgba(245,158,11,0.10),_transparent_28%),linear-gradient(180deg,_#f8f7f2_0%,_#f2efe6_100%)]" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col px-5 py-6 sm:px-6 lg:px-8">
          <header className="flex items-center justify-between gap-4 border-b border-[#d8d3c4] pb-5">
            <Link href="/" className="flex items-center gap-3">
              <BrandMark variant="techclave" className="h-11 w-11" />
              <div>
                <p className="brand-kicker text-[#4d6a59]">Techclave</p>
                <p className="mt-1 text-sm text-[#5a625f]">AI operating systems for African businesses</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-2 md:flex">
              <Link
                href="/products"
                className="rounded-full border border-[#d8d3c4] bg-white/70 px-4 py-2 text-sm text-[#46514e] shadow-sm transition hover:border-[#bfc7b9] hover:text-[#10211a]"
              >
                Products
              </Link>
              <Link
                href="/showcase"
                className="rounded-full border border-[#d8d3c4] bg-white/70 px-4 py-2 text-sm text-[#46514e] shadow-sm transition hover:border-[#bfc7b9] hover:text-[#10211a]"
              >
                Capabilities
              </Link>
              <Link
                href="#principles"
                className="rounded-full border border-[#d8d3c4] bg-white/70 px-4 py-2 text-sm text-[#46514e] shadow-sm transition hover:border-[#bfc7b9] hover:text-[#10211a]"
              >
                Why this structure
              </Link>
              <Link
                href="/booka"
                className="rounded-full bg-[#10211a] px-4 py-2 text-sm font-medium text-[#f5f2e8] shadow-sm transition hover:bg-[#1c2a27]"
              >
                Explore Booka
              </Link>
            </nav>
          </header>

          <section className="grid gap-12 pb-20 pt-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8d3c4] bg-white/80 px-4 py-2 text-sm text-[#274235] shadow-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
                AI products for customer operations
              </div>
              <p className="mt-6 text-xs font-medium uppercase tracking-[0.34em] text-[#597061]">
                Techclave
              </p>
              <h1 className="techclave-display mt-4 max-w-5xl text-5xl text-[#10211a] sm:text-6xl lg:text-7xl">
                Techclave builds AI products that help businesses reply faster, sell better, book more, and recover missed revenue.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#4f5d59]">
                We build practical operating software for African businesses. Each product is focused on one hard
                workflow. Booka is the first: an AI Revenue Front Desk for service businesses that sell and book through WhatsApp and Instagram.
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/booka"
                  className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-medium text-white shadow-[0_14px_34px_rgba(5,150,105,0.18)] transition hover:-translate-y-0.5 hover:bg-emerald-700"
                >
                  View Booka
                </Link>
                <Link
                  href="/booka/auth/onboarding"
                  className="rounded-full border border-[#c8d4ca] bg-white px-6 py-3 text-sm font-medium text-[#1d3326] shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300"
                >
                  Start onboarding
                </Link>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[2rem] border border-[#d8d3c4] bg-[#10211a] p-6 text-[#f5f2e8] shadow-[0_22px_80px_rgba(16,23,23,0.16)]">
                <p className="brand-kicker text-[#d4b368]">Featured product</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">Booka</h2>
                <p className="mt-3 text-sm leading-7 text-[#d7ddd9]">
                  An AI Revenue Front Desk that turns active WhatsApp and Instagram enquiries into booked and paying
                  customers, then carries opted-in follow-up and repeat-business conversations on WhatsApp.
                </p>
                <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-5">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.26em] text-emerald-300/70">Best fit</div>
                    <div className="mt-2 text-sm text-[#f3efe2]">Salons, clinics, restaurants, studios</div>
                  </div>
                  <Link
                    href="/booka"
                    className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#10211a] transition hover:bg-[#ecf2ee]"
                  >
                    Open product
                  </Link>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { value: 'Booka', label: 'First live product' },
                  { value: 'WhatsApp + IG', label: 'Where it works' },
                  { value: 'Human + AI', label: 'How conversations run' },
                  { value: 'Product-first', label: 'How we ship' },
                ].map((item) => (
                  <div key={item.label} className="rounded-[1.5rem] border border-[#d8d3c4] bg-white/80 p-4 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-[#6c756f]">{item.label}</div>
                    <div className="mt-3 text-2xl font-semibold text-[#10211a]">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="products" className="pb-20">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-[#6c756f]">Products</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                  One company. Focused products.
                </h2>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {productCards.map((card) => (
                <article key={card.name} className="rounded-[1.9rem] border border-[#d8d3c4] bg-white/85 p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.28em] text-[#6c756f]">{card.stage}</p>
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] ${
                        card.accent === 'emerald'
                          ? 'bg-emerald-50 text-emerald-800'
                          : card.accent === 'amber'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {card.name}
                    </span>
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold tracking-tight text-[#10211a]">{card.name}</h3>
                  <p className="mt-3 text-sm leading-7 text-[#53605c]">{card.summary}</p>
                  <Link
                    href={card.href}
                    className="mt-6 inline-flex items-center rounded-full border border-[#cad4ce] px-4 py-2 text-sm font-medium text-[#1d3326] transition hover:border-emerald-300 hover:text-emerald-800"
                  >
                    {card.name === 'Booka' ? 'See product page' : 'Learn more'}
                  </Link>
                </article>
              ))}
            </div>
          </section>

          <section id="principles" className="pb-20">
            <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
              <div className="rounded-[2rem] border border-[#d8d3c4] bg-white/85 p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.32em] text-[#6c756f]">Why Techclave</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#10211a]">
                  Pick the product you need. We run everything behind it.
                </h2>
                <p className="mt-4 text-sm leading-7 text-[#53605c]">
                  Techclave builds and operates the products. Booka is the one to start with today—an AI Revenue
                  Front Desk you can pilot against real enquiries. As we ship more, each product stays just as specific.
                </p>
              </div>
              <div className="grid gap-4">
                {principles.map((item, index) => (
                  <article key={item} className="rounded-[1.5rem] border border-[#d8d3c4] bg-[#fdfcf8] p-5 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.28em] text-[#6c756f]">0{index + 1}</p>
                    <p className="mt-3 text-lg leading-8 text-[#10211a]">{item}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="roadmap" className="pb-6">
            <div className="rounded-[2rem] border border-[#d8d3c4] bg-[#1d3326] px-6 py-8 text-[#f5f2e8] shadow-[0_20px_80px_rgba(29,51,38,0.16)]">
              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                <div>
                  <p className="text-xs uppercase tracking-[0.34em] text-emerald-200/70">What&apos;s next</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                    Start with Booka today. Grow with Techclave over time.
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-[#d7ddd9]">
                    Booka is live now and ready for your front desk. As Techclave ships new products, they plug into
                    the same operating layer — so adding capability never means starting over.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 lg:justify-end">
                  <Link
                    href="/booka"
                    className="rounded-full bg-white px-6 py-3 text-sm font-medium text-[#1d3326] shadow-sm transition hover:-translate-y-0.5"
                  >
                    Open Booka
                  </Link>
                  <Link
                    href="/booka/auth/onboarding"
                    className="rounded-full border border-white/20 bg-[#274235] px-6 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-[#30513f]"
                  >
                    Start onboarding
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <footer className="flex flex-col gap-4 border-t border-[#d8d3c4] pt-8 text-sm text-[#5a625f] sm:flex-row sm:items-center sm:justify-between">
            <p>Techclave • AI operating systems for African businesses</p>
            <div className="flex flex-wrap gap-4">
              <Link href="/products" className="transition hover:text-[#10211a]">
                Products
              </Link>
              <Link href="/showcase" className="transition hover:text-[#10211a]">
                Capabilities
              </Link>
              <Link href="/booka" className="transition hover:text-[#10211a]">
                Booka
              </Link>
              <Link href="/booka/auth/onboarding" className="transition hover:text-[#10211a]">
                Start onboarding
              </Link>
              <Link href="/booka/auth/signin" className="transition hover:text-[#10211a]">
                Sign in
              </Link>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}
