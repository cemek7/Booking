import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';
import { MortgageCalculator } from '@/components/capability/demo-shell/MortgageCalculator';
import { PROPERTIES, findProperty } from '@/showcase/content/haven-properties';

const naira = (n: number) => `₦${n.toLocaleString()}`;
const gallery = ['/images/haven-realty/property-1.jpg', '/images/haven-realty/property-3.jpg', '/images/haven-realty/property-4.jpg'];

export function generateStaticParams() {
  return PROPERTIES.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = findProperty(id);
  return { title: p ? `${p.title} — Haven Realty` : 'Property — Haven Realty', description: 'An illustrative property detail page in the Haven Realty capability demonstrator.' };
}

export default async function PropertyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = findProperty(id);
  if (!property) notFound();

  return <main>
    <Section><Container width="wide"><Link className="text-sm font-medium underline underline-offset-4" href="/showcase/demos/haven-realty/properties">← All properties</Link>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1.3fr_.7fr]">
        <div>
          <div className="relative aspect-[16/10] overflow-hidden rounded-3xl border border-current/10"><Image src={property.image} alt="Stock photograph of a property; not a real Haven Realty listing." fill priority sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover" /></div>
          <div className="mt-4 grid grid-cols-3 gap-4">{gallery.map((src, i) => <div key={src} className="relative aspect-[4/3] overflow-hidden rounded-xl"><Image src={src} alt={`Stock photograph, illustrative interior view ${i + 1}; not a real Haven Realty listing.`} fill sizes="20vw" className="object-cover" /></div>)}</div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[.16em]" style={{ color: 'var(--sc-accent)' }}>{property.neighborhood} · {property.type}</p>
          <Heading level={1} className="sc-display mt-2">{property.title}</Heading>
          <p className="sc-display mt-3 text-3xl font-semibold" style={{ color: 'var(--sc-primary)' }}>{naira(property.priceNaira)}</p>
          <Text tone="muted" className="mt-4">{property.summary}</Text>
          <dl className="mt-6 grid grid-cols-3 gap-4 text-sm">
            <div><dt className="opacity-60">Beds</dt><dd className="font-medium">{property.type === 'Land' ? '—' : property.beds}</dd></div>
            <div><dt className="opacity-60">Baths</dt><dd className="font-medium">{property.type === 'Land' ? '—' : property.baths}</dd></div>
            <div><dt className="opacity-60">Area</dt><dd className="font-medium">{property.areaSqm} sqm</dd></div>
          </dl>
          <Link className="sc-primary mt-8 inline-block rounded-xl px-6 py-3 text-sm font-medium" href="/showcase/demos/haven-realty/contact">Book a viewing</Link>
        </div>
      </div>
    </Container></Section>
    <Section tone="surface"><Container width="wide"><MortgageCalculator defaultPrincipal={property.priceNaira} /></Container></Section>
  </main>;
}
