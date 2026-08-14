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
  { name: 'request', label: 'What kind of routine appointment are you looking for?', type: 'textarea' as const, required: true, placeholder: 'For example: a family medicine consultation' },
];

export const metadata = { title: 'Request an appointment — Northstar Clinic', description: 'A local-only appointment-request form in the Northstar Clinic capability demonstrator.' };

export default function ContactPage() {
  return <main><Section><Container width="wide" className="grid gap-10 lg:grid-cols-[.82fr_1.18fr]"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-eyebrow)' }}>Contact</p><Heading level={1} className="mt-3">Request a routine appointment.</Heading><Text size="lg" tone="muted" className="mt-4">This form demonstrates a considered appointment-request flow. It is local only: no message is sent and no information is stored.</Text><Card className="mt-8"><Heading level={2} className="text-xl">Hours & location</Heading><Text tone="muted" className="mt-3">Mon–Fri, 8:00–17:00<br />Saturday, 9:00–13:00<br /><br />Illustrative clinic address<br />Victoria Island, Lagos</Text></Card><p className="mt-6 text-sm font-medium" style={{ color: 'var(--sc-muted)' }}>For emergencies, contact your local emergency services. Do not use this form for urgent care.</p></div><Card className="p-6 sm:p-8"><Heading level={2} className="text-2xl">Tell us what you need</Heading><Text tone="muted" className="mt-2">The required fields and privacy note demonstrate the interaction pattern only.</Text><div className="mt-7"><LeadForm fields={fields} submitLabel="Send appointment request" /></div></Card></Container></Section></main>;
}
