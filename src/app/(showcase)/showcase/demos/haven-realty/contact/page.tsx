import Image from 'next/image';
import { LeadForm } from '@/components/capability/forms/LeadForm';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const fields = [
  { name: 'name', label: 'Your name', required: true, placeholder: 'Name' },
  { name: 'email', label: 'Email address', type: 'email' as const, required: true, placeholder: 'you@example.com' },
  { name: 'phone', label: 'Phone number', type: 'tel' as const, required: true, placeholder: '+234 …' },
  { name: 'interest', label: 'What are you looking for?', type: 'textarea' as const, required: true, placeholder: 'A property to buy, a viewing, or a valuation' },
];

export const metadata = { title: 'Contact — Haven Realty', description: 'A local-only buyer and seller enquiry form in the Haven Realty capability demonstrator.' };

export default function ContactPage() {
  return <main><Section><Container width="wide" className="grid gap-10 lg:grid-cols-[.82fr_1.18fr]"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-accent)' }}>Contact</p><Heading level={1} className="sc-display mt-3">Talk to an agent.</Heading><Text size="lg" tone="muted" className="mt-4">This form demonstrates a buyer or seller enquiry flow. It is local only: no message is sent and no information is stored.</Text><Card className="mt-8"><div className="relative mb-4 aspect-[4/3] overflow-hidden rounded-xl"><Image src="/images/haven-realty/property-4.jpg" alt="Stock photograph representing an agent workspace; not Haven Realty staff." fill sizes="(min-width: 1024px) 30vw, 100vw" className="object-cover" /></div><Heading level={2} className="sc-display text-xl">Your agent</Heading><Text tone="muted" className="mt-2">An illustrative Haven Realty agent, shown to demonstrate the profile pattern. Not a real person.</Text><Text tone="muted" className="mt-4 text-sm">Mon–Sat, 9:00–18:00<br />Illustrative office, Victoria Island, Lagos</Text></Card></div><Card className="p-6 sm:p-8"><Heading level={2} className="sc-display text-2xl">Send an enquiry</Heading><Text tone="muted" className="mt-2">The required fields and privacy note demonstrate the interaction pattern only.</Text><div className="mt-7"><LeadForm fields={fields} submitLabel="Send enquiry" /></div></Card></Container></Section></main>;
}
