import Image from 'next/image';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

export const metadata = { title: 'About — Ember Table', description: 'The illustrative story and kitchen philosophy in the Ember Table capability demonstrator.' };

export default function AboutPage() {
  return <main>
    <Section><Container width="wide" className="grid items-center gap-10 lg:grid-cols-[.9fr_1.1fr]"><div className="relative min-h-80 overflow-hidden rounded-3xl"><Image src="/images/ember-table/chef.jpg" alt="Stock photograph of a chef working at a pass; not Ember Table staff." fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-primary)' }}>Our story</p><Heading level={1} className="sc-display mt-3">Cooking over fire, written for the reader.</Heading><Text size="lg" tone="muted" className="mt-4">Ember Table is a fictional restaurant created to demonstrate an editorial dining site. The story below is illustrative — it shows how a kitchen’s philosophy can be told without overstated claims.</Text><Text tone="muted" className="mt-4">The imagined Ember kitchen is built around an open flame and a short, seasonal menu. The intent of this page is to convey character and craft, and to lead the reader gently toward requesting a table — not to assert reviews, ratings, or awards.</Text></div></Container></Section>
    <Section tone="surface"><Container width="narrow"><Heading level={2} className="sc-display">Hours &amp; location</Heading><Text tone="muted" className="mt-3">Tuesday–Sunday, dinner from 18:00<br />Closed Mondays<br /><br />Illustrative address<br />Ikoyi, Lagos</Text><Text tone="muted" className="mt-4 text-sm">This is a capability demonstrator. The venue, hours, and address are fictional and provided to show the information a diner expects to find.</Text></Container></Section>
    <CTASection title="Join us for an evening." cta={{ label: 'Reserve a table', href: '/showcase/demos/ember-table/contact' }} />
  </main>;
}
