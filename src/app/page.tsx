import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import CtaLink from "@/components/homepage/CtaLink";
import Panel from "@/components/homepage/Panel";
import SectionHeading from "@/components/homepage/SectionHeading";

const otherProducts = [
  {
    name: "Managed Ops",
    stage: "Platform layer",
    summary:
      "The layer behind every product: queues, retries, handoffs and learning loops that keep the AI accountable.",
    href: "/dashboard/ops",
  },
  {
    name: "More products",
    stage: "Coming next",
    summary:
      "Booka is first. New products launch beside it, each focused on one hard workflow.",
    href: "#roadmap",
  },
];

const principles = [
  "Every product solves one hard workflow end to end, not a little bit of everything.",
  "The AI does the repetitive work. Your team steps in only where judgement matters.",
  "We build for how African businesses actually operate: on chat, in real time, in local context.",
];

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
  { href: "/refunds", label: "Refunds" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/ugc-policy", label: "Content policy" },
  { href: "/dpa", label: "Data processing" },
  { href: "/sub-processors", label: "Sub-processors" },
  { href: "/data-retention", label: "Data retention" },
  { href: "/accessibility", label: "Accessibility" },
];

const footerLinks = [
  { href: "/products", label: "Products" },
  { href: "/showcase", label: "Capabilities" },
  { href: "/booka", label: "Booka" },
  { href: "/booka/auth/onboarding", label: "Start onboarding" },
  { href: "/contact", label: "Contact" },
  { href: "/booka/auth/signin", label: "Sign in" },
];

const navLink =
  "rounded-sm text-sm text-[#46514e] transition hover:text-[var(--brand-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--booka-green)]";

const sectionRule = "border-t border-[var(--brand-line)] py-16 sm:py-20";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--brand-paper)] text-[var(--brand-ink)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-5 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 pb-5">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark variant="techclave" className="h-11 w-11" />
            <div>
              <p className="brand-kicker text-[var(--brand-moss)]">Techclave</p>
              <p className="mt-1 text-sm text-[#5a625f]">
                AI operating systems for African businesses
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/products" className={navLink}>
              Products
            </Link>
            <Link href="/showcase" className={navLink}>
              Capabilities
            </Link>
            <Link href="#principles" className={navLink}>
              How we build
            </Link>
            <Link href="/contact" className={navLink}>
              Contact
            </Link>
            <CtaLink href="/booka" tone="ink" className="!px-5 !py-2.5">
              Explore Booka
            </CtaLink>
          </nav>
        </header>

        <section className="grid gap-12 pb-20 pt-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:pt-16">
          <div>
            <SectionHeading
              as="h1"
              kicker="Techclave product house"
              title="AI products that help African businesses sell and book on chat."
              lede="Each product does one hard workflow well. Booka is the first: an AI Revenue Front Desk for WhatsApp and Instagram."
            />
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <CtaLink href="/booka" tone="ink">
                View Booka
              </CtaLink>
              <CtaLink href="/booka/auth/onboarding" variant="text" tone="ink">
                Start onboarding
              </CtaLink>
            </div>
          </div>

          <Panel tone="dark" className="p-7">
            <p className="brand-kicker text-[var(--brand-gold)]">Featured product</p>
            <h2 className="techclave-display mt-4 text-4xl">Booka</h2>
            <p className="mt-3 leading-7 text-[#d7ddd9]">
              Turns active WhatsApp and Instagram enquiries into booked and
              paying customers, then carries opted-in follow-up on WhatsApp.
            </p>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-5">
              <div>
                <p className="text-xs text-[var(--brand-gold)]">Best fit</p>
                <p className="mt-1 text-sm text-[#f3efe2]">
                  Salons, clinics, restaurants, studios
                </p>
              </div>
              <CtaLink href="/booka" variant="text" tone="light">
                Open product
              </CtaLink>
            </div>
          </Panel>
        </section>

        <section id="products" className={sectionRule}>
          <SectionHeading kicker="Products" title="One company. Focused products." />

          <Panel className="mt-10 grid gap-6 p-6 sm:p-8 lg:grid-cols-[0.8fr_1.4fr_auto] lg:items-center">
            <div>
              <p className="text-sm font-semibold text-[var(--booka-green-strong)]">
                Live product
              </p>
              <h3 className="techclave-display mt-2 text-3xl">Booka</h3>
            </div>
            <p className="max-w-[60ch] leading-7 text-[#4f5d59]">
              AI Revenue Front Desk for service businesses. It converts active
              WhatsApp and Instagram enquiries, recommends the right offer,
              books customers, helps collect payment and follows up.
            </p>
            <CtaLink href="/booka" variant="text" tone="green">
              See product page
            </CtaLink>
          </Panel>

          <div className="mt-6 grid gap-x-12 md:grid-cols-2">
            {otherProducts.map((product) => (
              <div
                key={product.name}
                className="border-t border-[var(--brand-line)] py-6"
              >
                <p className="text-sm text-[var(--brand-moss)]">{product.stage}</p>
                <h3 className="mt-1 text-xl font-semibold tracking-tight">
                  {product.name}
                </h3>
                <p className="mt-2 max-w-[52ch] text-[#4f5d59]">{product.summary}</p>
                <CtaLink
                  href={product.href}
                  variant="text"
                  tone="ink"
                  className="mt-4"
                >
                  Learn more
                </CtaLink>
              </div>
            ))}
          </div>
        </section>

        <section
          id="principles"
          className={`${sectionRule} grid gap-10 lg:grid-cols-[0.9fr_1.1fr]`}
        >
          <SectionHeading
            kicker="Why Techclave"
            title="Pick the product you need. We run everything behind it."
            lede="Booka is the one to start with today. As we ship more, each product stays just as specific."
          />
          <ol className="divide-y divide-[var(--brand-line)]">
            {principles.map((item, index) => (
              <li key={item} className="flex gap-5 py-5 first:pt-0">
                <span className="techclave-display w-10 shrink-0 text-2xl tabular-nums text-[var(--brand-moss)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-lg leading-8">{item}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="roadmap"
          className={`${sectionRule} grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end`}
        >
          <SectionHeading
            kicker="What's next"
            title="Start with Booka today. Grow with Techclave over time."
            lede="New products plug into the same operating layer, so adding capability never means starting over."
          />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4 lg:justify-end">
            <CtaLink href="/booka" tone="ink">
              Open Booka
            </CtaLink>
            <CtaLink href="/booka/auth/onboarding" variant="text" tone="ink">
              Start onboarding
            </CtaLink>
            <CtaLink href="/contact" variant="text" tone="ink">
              Talk to us
            </CtaLink>
          </div>
        </section>

        <footer className="flex flex-col gap-6 border-t border-[var(--brand-line)] pt-8 text-sm text-[#5a625f]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p>Techclave · AI operating systems for African businesses</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {footerLinks.map((link) => (
                <Link key={link.href} href={link.href} className={navLink}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#6b736f]">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className={navLink}>
                {link.label}
              </Link>
            ))}
          </div>
        </footer>
      </div>
    </main>
  );
}
