import Link from 'next/link';
import BrandMark from '@/components/brand/BrandMark';

const products = [
  {
    name: 'Booka',
    stage: 'Live product',
    status: 'Shipping now',
    href: '/booka',
    summary:
      'AI front desk for service businesses on WhatsApp and Instagram. It handles enquiries, recommendations, sales conversion, booking intake, reminders, follow-ups, and revenue recovery.',
    audience: 'Beauty, hospitality, and clinic teams that sell and book in chat',
    outcome: 'More conversion, more confirmed bookings, fewer no-shows, stronger repeat revenue',
  },
  {
    name: 'Managed Ops',
    stage: 'Platform layer',
    status: 'Internal layer',
    href: '/dashboard/ops',
    summary:
      'The operational control layer behind the products: queues, handoffs, retries, monitoring, and accountability for live AI workflows.',
    audience: 'Internal operators and platform owners',
    outcome: 'Better reliability, clearer escalation, and tighter operator visibility',
  },
];

const portfolioPrinciples = [
  'One product should map to one operational pain point and one buyer.',
  'The company brand should signal product quality, not replace product clarity.',
  'Shared infrastructure stays behind the scenes until operators need control.',
];

export default function ProductsPage() {
  return (
    <main className="min-h-screen bg-[#f6f5ef] text-[#101717]">
      <section className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 border-b border-[#d8d3c4] pb-5">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark variant="techclave" className="h-11 w-11" />
            <div>
              <p className="brand-kicker text-[#4d6a59]">Techclave</p>
              <p className="mt-1 text-sm text-[#5a625f]">Products</p>
            </div>
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/booka"
              className="rounded-full border border-[#d8d3c4] bg-white/80 px-4 py-2 text-sm text-[#46514e] shadow-sm transition hover:text-[#101717]"
            >
              Booka
            </Link>
            <Link
              href="/booka/auth/onboarding"
              className="rounded-full bg-[#101717] px-4 py-2 text-sm font-medium text-[#f5f2e8] shadow-sm transition hover:bg-[#1c2a27]"
            >
              Start onboarding
            </Link>
          </div>
        </header>

        <section className="grid gap-10 pb-16 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-[#d8d3c4] bg-white/80 px-4 py-2 text-sm text-[#274235] shadow-sm">
              Product portfolio
            </div>
            <p className="brand-kicker mt-6 text-[#597061]">Techclave products</p>
            <h1 className="techclave-display mt-4 max-w-4xl text-5xl text-[#101717] sm:text-6xl">
              Focused AI products for customer operations.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#4f5d59]">
              Techclave is the company brand. Each product stays narrow enough to explain in one sentence and useful
              enough to run a real workflow. Booka leads with one clear promise: it sells and books through chat.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { value: '1', label: 'Product live' },
                  { value: '3', label: 'Core ICP clusters' },
                  { value: 'WhatsApp + IG', label: 'Core surfaces' },
                ].map((stat) => (
                <div key={stat.label} className="rounded-[1.5rem] border border-[#d8d3c4] bg-white/80 p-4 shadow-sm">
                  <div className="brand-kicker text-[#6c756f]">{stat.label}</div>
                  <div className="mt-3 text-2xl font-semibold text-[#101717]">{stat.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-[#d8d3c4] bg-[#101717] p-6 text-[#f5f2e8] shadow-[0_22px_80px_rgba(16,23,23,0.16)]">
            <p className="brand-kicker text-[#d4b368]">Featured now</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Booka</h2>
            <p className="mt-3 text-sm leading-7 text-[#d7ddd9]">
              The first Techclave product: an AI front desk built for service teams that lose sales and bookings in chat.
            </p>
          </div>
        </section>

        <section className="pb-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="brand-kicker text-[#6c756f]">Live portfolio</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#101717]">
                Products that stay specific enough to sell.
              </h2>
            </div>
          </div>
        </section>

        <section className="grid gap-4 pb-16 lg:grid-cols-2">
          {products.map((product) => (
            <article key={product.name} className="rounded-[1.9rem] border border-[#d8d3c4] bg-white/85 p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="brand-kicker text-[#6c756f]">{product.stage}</p>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] text-emerald-800">
                  {product.status}
                </span>
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#101717]">{product.name}</h2>
              <p className="mt-3 text-sm leading-7 text-[#53605c]">{product.summary}</p>
              <p className="mt-4 text-sm font-medium text-[#1d3326]">{product.audience}</p>
              <p className="mt-2 text-sm text-[#5b655f]">{product.outcome}</p>
              <Link
                href={product.href}
                className="mt-6 inline-flex items-center rounded-full border border-[#cad4ce] px-4 py-2 text-sm font-medium text-[#1d3326] transition hover:border-emerald-300 hover:text-emerald-800"
              >
                Open {product.name}
              </Link>
            </article>
          ))}
        </section>

        <section className="grid gap-6 pb-16 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[2rem] border border-[#d8d3c4] bg-white/85 p-6 shadow-sm">
            <p className="brand-kicker text-[#6c756f]">Portfolio logic</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#101717]">
              Techclave is building a product house, not a vague AI umbrella.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#53605c]">
              The company page should make the ambition clear. The individual product pages should stay close to
              one workflow, one operator pain point, and one commercial result.
            </p>
          </div>
          <div className="grid gap-4">
            {portfolioPrinciples.map((principle, index) => (
              <article key={principle} className="rounded-[1.5rem] border border-[#d8d3c4] bg-[#fdfcf8] p-5 shadow-sm">
                <p className="brand-kicker text-[#6c756f]">0{index + 1}</p>
                <p className="mt-3 text-lg leading-8 text-[#101717]">{principle}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pb-8">
          <div className="rounded-[2rem] border border-[#d8d3c4] bg-[#1d3326] px-6 py-8 text-[#f5f2e8] shadow-[0_20px_80px_rgba(29,51,38,0.16)]">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <p className="brand-kicker text-[#d4b368]">Next product step</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Start with Booka. Expand the portfolio only when the next workflow is equally clear.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[#d7ddd9]">
                  Right now the strongest move is depth, not breadth. Make Booka unmistakable, let Techclave hold
                  the category narrative, and only add another product when the operational problem is specific.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 lg:justify-end">
                <Link
                  href="/booka"
                  className="rounded-full bg-white px-6 py-3 text-sm font-medium text-[#1d3326] shadow-sm transition hover:-translate-y-0.5"
                >
                  Explore Booka
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
          <p>Techclave • Products for customer operations</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="transition hover:text-[#101717]">
              Home
            </Link>
            <Link href="/booka" className="transition hover:text-[#101717]">
              Booka
            </Link>
            <Link href="/booka/auth/onboarding" className="transition hover:text-[#101717]">
              Start onboarding
            </Link>
            <Link href="/booka/auth/signin" className="transition hover:text-[#101717]">
              Sign in
            </Link>
          </div>
        </footer>
      </section>
    </main>
  );
}
