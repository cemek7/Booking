import Image from 'next/image';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { FAQ } from '@/components/capability/conversion/FAQ';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const spaces = [
  ['The Cellar', 'An intimate room for smaller gatherings and tasting-led dinners.'],
  ['The Long Table', 'A shared setting designed for celebrations and milestone evenings.'],
  ['Full buyout', 'The whole room for a private occasion, arranged around your evening.'],
];

export const metadata = { title: 'Private dining — Ember Table', description: 'Illustrative private-dining spaces and enquiry pattern in the Ember Table capability demonstrator.' };

export default function PrivateDiningPage() {
  return <main>
    <Section><Container width="wide" className="grid items-center gap-10 lg:grid-cols-2"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-eyebrow)' }}>Private dining</p><Heading level={1} className="sc-display mt-3">Gather the room around the occasion.</Heading><Text size="lg" tone="muted" className="mt-4">These illustrative spaces show how a restaurant can present private-dining options and invite an enquiry — without a real booking system behind it.</Text></div><div className="relative min-h-72 overflow-hidden rounded-3xl"><Image src="/images/ember-table/dish-2.jpg" alt="Stock photograph of a shared dining spread; not Ember Table." fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div></Container></Section>
    <Section tone="surface"><Container width="wide"><Heading level={2} className="sc-display">Spaces</Heading><div className="mt-8 grid gap-5 md:grid-cols-3">{spaces.map(([title, description]) => <Card key={title}><Heading level={3} className="sc-display">{title}</Heading><Text tone="muted" className="mt-3">{description}</Text></Card>)}</div></Container></Section>
    <Section><FAQ title="Planning a private event" items={[{ question: 'How do I enquire about a private event?', answer: 'The reservation form on the Reservations page includes a notes field — this demonstrator uses it to show how a private-event enquiry would be captured. It is local only and sends nothing.' }, { question: 'Can the menu be tailored?', answer: 'In a real venue, yes. Here, the menu page shows the dietary-note pattern a tailored private menu would build on.' }]} /></Section>
    <CTASection title="Have an occasion in mind?" subtitle="Use the reservation request and describe your event in the notes." cta={{ label: 'Request a table', href: '/showcase/demos/ember-table/contact' }} />
  </main>;
}
