import { LeadForm } from '@/components/capability/forms/LeadForm';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const fields = [
  { name: 'name', label: 'Your name', required: true, placeholder: 'Name' },
  { name: 'phone', label: 'Phone number', type: 'tel' as const, required: true, placeholder: '+234 …' },
  { name: 'date', label: 'Preferred date & time', required: true, placeholder: 'e.g. Friday, 8:00 PM' },
  { name: 'partySize', label: 'Party size', required: true, placeholder: 'e.g. 2' },
  { name: 'notes', label: 'Anything we should know? (occasion, dietary needs, private-event enquiry)', type: 'textarea' as const, placeholder: 'Optional' },
];

export const metadata = { title: 'Reserve a table — Ember Table', description: 'A local-only reservation-request form in the Ember Table capability demonstrator.' };

export default function ContactPage() {
  return <main><Section><Container width="wide" className="grid gap-10 lg:grid-cols-[.82fr_1.18fr]"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-eyebrow)' }}>Reservations</p><Heading level={1} className="sc-display mt-3">Request a table.</Heading><Text size="lg" tone="muted" className="mt-4">This form demonstrates a considered reservation-request flow. It is local only: no message is sent, and no table is held or stored.</Text><Card className="mt-8"><Heading level={2} className="sc-display text-xl">Hours &amp; location</Heading><Text tone="muted" className="mt-3">Tuesday–Sunday, dinner from 18:00<br />Closed Mondays<br /><br />Illustrative address<br />Ikoyi, Lagos</Text></Card><p className="mt-6 text-sm font-medium" style={{ color: 'var(--sc-muted)' }}>Dietary requirements can be noted in the message field. In a real venue these would reach the kitchen; here nothing is transmitted.</p></div><Card className="p-6 sm:p-8"><Heading level={2} className="sc-display text-2xl">Tell us about your evening</Heading><Text tone="muted" className="mt-2">The required fields and privacy note demonstrate the interaction pattern only.</Text><div className="mt-7"><LeadForm fields={fields} submitLabel="Send reservation request" /></div></Card></Container></Section></main>;
}
