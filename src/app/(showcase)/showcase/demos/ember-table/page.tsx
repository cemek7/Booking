import Image from 'next/image';
import Link from 'next/link';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { FAQ } from '@/components/capability/conversion/FAQ';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const pillars = [
  ['A room with intent', 'Warm light, low sound, and a menu that changes with the season — a setting designed for a considered evening.'],
  ['Food, described plainly', 'Each dish is presented with its components and dietary notes, so the choice is easy before you sit down.'],
  ['A table, easily requested', 'A reservation request stays within reach on every page, including a sticky prompt on mobile.'],
];

export const metadata = { title: 'Ember Table — Fireside fine dining', description: 'A fictional premium-restaurant capability demonstrator by TechClave.' };

export default function EmberHome() {
  return <main>
    <section className="overflow-hidden border-b border-current/10"><Container width="wide" className="grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_.95fr] lg:py-20"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-primary)' }}>Capability Demonstrator · Premium restaurant</p><Heading level={1} className="sc-display mt-4 max-w-xl">An evening worth reserving, from the first glance.</Heading><Text size="lg" tone="muted" className="mt-5 max-w-xl">Ember Table is a fictional fine-dining experience designed to present the room, the menu, and the story with warmth — and to make requesting a table feel considered rather than transactional.</Text><div className="mt-8 flex flex-wrap gap-4"><Link className="sc-primary rounded-xl px-6 py-3 text-sm font-medium" href="/showcase/demos/ember-table/contact">Reserve a table</Link><Link className="rounded-xl border border-current/20 px-6 py-3 text-sm font-medium" href="/showcase/demos/ember-table/menu">View the menu</Link></div></div><div className="relative min-h-80 overflow-hidden rounded-3xl border border-current/10 shadow-sm"><Image src="/images/ember-table/hero.jpg" alt="Stock photograph of a warmly lit fine-dining table setting; not Ember Table." fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div></Container></section>
    <Section tone="surface"><Container width="wide"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs uppercase tracking-[.18em] opacity-60">Why it reads the way it does</p><Heading level={2} className="sc-display mt-3">Designed around the decision to book.</Heading></div><Link className="text-sm font-medium underline underline-offset-4" href="/showcase/demos/ember-table/menu">Explore the menu →</Link></div><div className="mt-8 grid gap-5 md:grid-cols-3">{pillars.map(([title, description]) => <Card key={title}><Heading level={3} className="sc-display">{title}</Heading><Text tone="muted" className="mt-3">{description}</Text></Card>)}</div></Container></Section>
    <Section><Container width="wide" className="grid items-center gap-10 lg:grid-cols-2"><div className="relative min-h-72 overflow-hidden rounded-3xl"><Image src="/images/ember-table/interior.jpg" alt="Stock photograph of a dim, intimate restaurant interior; not Ember Table." fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div><div><p className="text-xs uppercase tracking-[.18em] opacity-60">The room</p><Heading level={2} className="sc-display mt-3">A setting built for the occasion.</Heading><Text tone="muted" className="mt-4">See the seasonal menu, the story behind the kitchen, and private-dining options — then request a table for the evening you have in mind.</Text><Link className="mt-6 inline-block text-sm font-medium underline underline-offset-4" href="/showcase/demos/ember-table/private-dining">Explore private dining →</Link></div></Container></Section>
    <Section tone="surface"><FAQ title="Before you reserve" items={[{ question: 'Does submitting a request confirm a table?', answer: 'No. Ember Table is a fictional capability demonstrator, and the reservation form is local only: it does not send, store, or hold a booking.' }, { question: 'Can you accommodate dietary requirements?', answer: 'The menu presents dietary notes alongside each section to show the disclosure pattern this experience is designed around. In a real venue these would reflect the kitchen’s actual offering.' }, { question: 'Do you host private events?', answer: 'The Private dining page shows how a considered private-event enquiry would be presented and requested.' }]} /></Section>
    <CTASection title="Request a table for the evening you have in mind." subtitle="See the local reservation-request experience and the information a diner needs around it." cta={{ label: 'Reserve a table', href: '/showcase/demos/ember-table/contact' }} />
  </main>;
}
