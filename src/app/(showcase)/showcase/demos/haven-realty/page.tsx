import Image from 'next/image';
import Link from 'next/link';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';
import { NEIGHBORHOODS } from '@/showcase/content/haven-properties';

const neighbourhoodNotes: Record<string, string> = {
  Ikoyi: 'Quiet, established streets and low-density living close to the water.',
  Lekki: 'Newer developments, family homes, and serviced plots along the peninsula.',
  'Victoria Island': 'Central, commercial, and high-rise living with harbour views.',
  Ikeja: 'Mainland calm with mature streets and good connectivity.',
};

export const metadata = { title: 'Haven Realty — Homes, found calmly', description: 'A fictional real-estate capability demonstrator by TechClave.' };

export default function HavenHome() {
  return <main>
    <section className="overflow-hidden border-b border-current/10"><Container width="wide" className="grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_.95fr] lg:py-20"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-accent)' }}>Capability Demonstrator · Real estate</p><Heading level={1} className="sc-display mt-4 max-w-xl">Homes, found calmly.</Heading><Text size="lg" tone="muted" className="mt-5 max-w-xl">Haven Realty is a fictional agency experience designed to make browsing listings, understanding affordability, and starting an enquiry feel effortless.</Text><div className="mt-8 flex flex-wrap gap-4"><Link className="sc-primary rounded-xl px-6 py-3 text-sm font-medium" href="/showcase/demos/haven-realty/properties">Browse properties</Link><Link className="rounded-xl border border-current/20 px-6 py-3 text-sm font-medium" href="/showcase/demos/haven-realty/sell">Sell with us</Link></div></div><div className="relative min-h-80 overflow-hidden rounded-3xl border border-current/10 shadow-sm"><Image src="/images/haven-realty/property-2.jpg" alt="Stock photograph of a residential home exterior; not a real Haven Realty listing." fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div></Container></section>
    <Section tone="surface"><Container width="wide"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs uppercase tracking-[.18em] opacity-60">Where you might live</p><Heading level={2} className="sc-display mt-3">Neighbourhoods, in plain terms.</Heading></div><Link className="text-sm font-medium underline underline-offset-4" href="/showcase/demos/haven-realty/properties">See all properties →</Link></div><div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{NEIGHBORHOODS.map((n) => <Card key={n}><Heading level={3} className="sc-display">{n}</Heading><Text tone="muted" className="mt-3">{neighbourhoodNotes[n]}</Text></Card>)}</div></Container></Section>
    <Section><Container width="wide" className="grid items-center gap-10 lg:grid-cols-2"><div className="relative min-h-72 overflow-hidden rounded-3xl"><Image src="/images/haven-realty/property-3.jpg" alt="Stock photograph of a modern apartment interior; not a real Haven Realty listing." fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div><div><p className="text-xs uppercase tracking-[.18em] opacity-60">Buyers &amp; sellers</p><Heading level={2} className="sc-display mt-3">A calmer way to buy — and to sell.</Heading><Text tone="muted" className="mt-4">Filter listings by area, type, and budget; check an illustrative monthly repayment on any property; or request a valuation if you are ready to sell.</Text><Link className="mt-6 inline-block text-sm font-medium underline underline-offset-4" href="/showcase/demos/haven-realty/properties">Start browsing →</Link></div></Container></Section>
    <CTASection title="Ready to look, or ready to sell?" subtitle="Browse the illustrative listings or request a valuation." cta={{ label: 'Book a viewing', href: '/showcase/demos/haven-realty/contact' }} />
  </main>;
}
