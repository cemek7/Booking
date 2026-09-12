import Link from "next/link";
import type { Metadata } from "next";
import BrandMark from "@/components/brand/BrandMark";
import { ContactForm } from "@/components/contact/ContactForm";

export const metadata: Metadata = {
  title: "Contact — Techclave",
  description:
    "Talk to Techclave about Booka, a custom build, or a partnership. We reply to every message.",
};

const answers = [
  {
    title: "You want Booka for your business",
    body: "Tell us how enquiries reach you today. We will show you the shortest path from a WhatsApp message to a paid booking.",
  },
  {
    title: "You want something built",
    body: "We take on work where one hard workflow is costing real money. Bring the workflow, not a feature list.",
  },
  {
    title: "You are already a customer",
    body: "Message your Booka number, or sign in and use the support channel in your dashboard. That reaches us faster.",
  },
];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[#f6f5ef] text-[#10211a]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(5,150,105,0.12),_transparent_30%),radial-gradient(circle_at_80%_20%,_rgba(245,158,11,0.10),_transparent_28%),linear-gradient(180deg,_#f8f7f2_0%,_#f2efe6_100%)]" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col px-5 py-6 sm:px-6 lg:px-8">
          <header className="flex items-center justify-between gap-4 border-b border-[#d8d3c4] pb-5">
            <Link href="/" className="flex items-center gap-3">
              <BrandMark variant="techclave" className="h-11 w-11" />
              <div>
                <p className="brand-kicker text-[#4d6a59]">Techclave</p>
                <p className="mt-1 text-sm text-[#5a625f]">
                  AI operating systems for African businesses
                </p>
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
                href="/booka"
                className="rounded-full bg-[#10211a] px-4 py-2 text-sm font-medium text-[#f5f2e8] shadow-sm transition hover:bg-[#1c2a27]"
              >
                Explore Booka
              </Link>
            </nav>
          </header>

          <section className="grid gap-12 pb-20 pt-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <div className="max-w-xl">
              <p className="text-xs font-medium uppercase tracking-[0.34em] text-[#597061]">
                Contact
              </p>
              <h1 className="techclave-display mt-4 text-5xl text-[#10211a] sm:text-6xl">
                Start with the problem.
              </h1>
              <p className="mt-6 text-lg leading-8 text-[#4f5d59]">
                Tell us what is going wrong in your front desk and we will tell
                you honestly whether we can fix it. A real person reads this.
              </p>

              <div className="mt-10 grid gap-4">
                {answers.map((item) => (
                  <article
                    key={item.title}
                    className="rounded-[1.5rem] border border-[#d8d3c4] bg-white/80 p-5 shadow-sm"
                  >
                    <h2 className="text-base font-semibold text-[#10211a]">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-[#53605c]">
                      {item.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-[#d8d3c4] bg-white/85 p-6 shadow-[0_22px_80px_rgba(16,23,23,0.08)] sm:p-8">
              <ContactForm />
            </div>
          </section>

          <footer className="flex flex-col gap-6 border-t border-[#d8d3c4] pt-8 pb-10 text-sm text-[#5a625f]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p>Techclave • AI operating systems for African businesses</p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/products"
                  className="transition hover:text-[#10211a]"
                >
                  Products
                </Link>
                <Link
                  href="/showcase"
                  className="transition hover:text-[#10211a]"
                >
                  Capabilities
                </Link>
                <Link href="/booka" className="transition hover:text-[#10211a]">
                  Booka
                </Link>
                <Link
                  href="/booka/auth/signin"
                  className="transition hover:text-[#10211a]"
                >
                  Sign in
                </Link>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#79817d]">
              <Link href="/privacy" className="transition hover:text-[#10211a]">
                Privacy
              </Link>
              <Link href="/terms" className="transition hover:text-[#10211a]">
                Terms
              </Link>
              <Link href="/cookies" className="transition hover:text-[#10211a]">
                Cookies
              </Link>
              <Link href="/refunds" className="transition hover:text-[#10211a]">
                Refunds
              </Link>
              <Link
                href="/acceptable-use"
                className="transition hover:text-[#10211a]"
              >
                Acceptable use
              </Link>
              <Link
                href="/ugc-policy"
                className="transition hover:text-[#10211a]"
              >
                Content policy
              </Link>
              <Link href="/dpa" className="transition hover:text-[#10211a]">
                Data processing
              </Link>
              <Link
                href="/sub-processors"
                className="transition hover:text-[#10211a]"
              >
                Sub-processors
              </Link>
              <Link
                href="/data-retention"
                className="transition hover:text-[#10211a]"
              >
                Data retention
              </Link>
              <Link
                href="/accessibility"
                className="transition hover:text-[#10211a]"
              >
                Accessibility
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}
