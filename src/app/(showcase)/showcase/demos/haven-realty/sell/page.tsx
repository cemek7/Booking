import { CTASection } from '@/components/capability/conversion/CTASection';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';
import { LeadForm } from '@/components/capability/forms/LeadForm';

const steps = [
  ['Request a valuation', 'Tell us about the property and how to reach you. This demonstrator captures the enquiry locally only.'],
  ['Agree an approach', 'In a real engagement, an agent would confirm pricing, presentation, and timing with you.'],
  ['Go to market', 'The property would then be listed, viewed, and negotiated — with you kept informed throughout.'],
];

const fields = [
  { name: 'name', label: 'Your name', required: true, placeholder: 'Name' },
  { name: 'phone', label: 'Phone number', type: 'tel' as const, required: true, placeholder: '+234 …' },
  { name: 'address', label: 'Property location', required: true, placeholder: 'e.g. Ikoyi, Lagos' },
  { name: 'details', label: 'Tell us about the property', type: 'textarea' as const, required: true, placeholder: 'Type, size, and anything notable' },
];

export const metadata = { title: 'Sell with us — Haven Realty', description: 'An illustrative seller valuation-request flow in the Haven Realty capability demonstrator.' };

export default function SellPage() {
  return <main>
    <Section><Container width="wide"><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-eyebrow)' }}>Sell with us</p><Heading level={1} className="sc-display mt-3">A straightforward path to selling.</Heading><Text size="lg" tone="muted" className="mt-4 max-w-2xl">This page shows how a seller would request a valuation. The form is local only — it sends nothing and holds nothing.</Text><div className="mt-8 grid gap-5 md:grid-cols-3">{steps.map(([title, copy], i) => <Card key={title}><span className="sc-display text-2xl font-semibold" style={{ color: 'var(--sc-accent)' }}>{String(i + 1).padStart(2, '0')}</span><Heading level={3} className="sc-display mt-2">{title}</Heading><Text tone="muted" className="mt-2">{copy}</Text></Card>)}</div></Container></Section>
    <Section tone="surface"><Container width="narrow"><Card className="p-6 sm:p-8"><Heading level={2} className="sc-display text-2xl">Request a valuation</Heading><Text tone="muted" className="mt-2">The required fields and privacy note demonstrate the interaction pattern only.</Text><div className="mt-7"><LeadForm fields={fields} submitLabel="Request a valuation" /></div></Card></Container></Section>
    <CTASection title="Prefer to talk it through first?" cta={{ label: 'Contact the team', href: '/showcase/demos/haven-realty/contact' }} />
  </main>;
}
