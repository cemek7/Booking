import Link from 'next/link';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const services = [
  ['Family medicine', 'Routine consultations, preventive care conversations, and referrals where appropriate.'],
  ['Women’s health', 'Routine women’s health consultations with clear next-step guidance.'],
  ['Children and families', 'Age-appropriate routine appointment information for families and caregivers.'],
  ['Specialist clinics', 'An overview of specialist clinic areas and a simple route to request a routine visit.'],
  ['Wellbeing checks', 'Structured health-check appointment information without promising a particular outcome.'],
  ['Travel and workplace care', 'Information for routine travel and workplace health requests.'],
];

export const metadata = { title: 'Services — Northstar Clinic', description: 'Illustrative routine clinic service information for the Northstar capability demonstrator.' };

export default function ServicesPage() {
  return <main><Section><Container width="wide"><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-eyebrow)' }}>Services</p><Heading level={1} className="mt-3">Care starts with a clearer question.</Heading><Text size="lg" tone="muted" className="mt-4 max-w-2xl">This illustrative directory shows how a clinic can help patients identify a relevant routine service without turning the website into medical advice.</Text><div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{services.map(([title, copy]) => <Card key={title}><Heading level={2} className="text-xl">{title}</Heading><Text tone="muted" className="mt-3">{copy}</Text><Link className="mt-5 inline-block text-sm font-medium underline underline-offset-4" href="/showcase/demos/northstar-clinic/contact">Request a routine appointment →</Link></Card>)}</div></Container></Section><CTASection title="Not sure where to start?" subtitle="A short local request form can capture the practical context a clinic team needs to follow up." cta={{ label: 'Request an appointment', href: '/showcase/demos/northstar-clinic/contact' }} /></main>;
}
