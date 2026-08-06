import Image from 'next/image';
import Link from 'next/link';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { FAQ } from '@/components/capability/conversion/FAQ';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const services = [
  ['Family medicine', 'Routine consultations, health checks, and care planning for adults and families.'],
  ['Women’s health', 'A respectful starting point for routine women’s health conversations and referrals.'],
  ['Specialist clinics', 'Guidance on the specialist services available and how to request an appointment.'],
];

export const metadata = { title: 'Northstar Clinic — Routine care information', description: 'A fictional private healthcare capability demonstrator by TechClave.' };

export default function NorthstarHome() {
  return <main>
    <section className="overflow-hidden border-b border-current/10"><Container width="wide" className="grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_.95fr] lg:py-20"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-primary)' }}>Capability Demonstrator · Private healthcare</p><Heading level={1} className="mt-4 max-w-xl">Clear care information, with a gentler path to the next step.</Heading><Text size="lg" tone="muted" className="mt-5 max-w-xl">Northstar Clinic is a fictional clinic experience designed to make routine care options, clinicians, and appointment requests easier to understand.</Text><div className="mt-8 flex flex-wrap gap-4"><Link className="sc-primary rounded-xl px-6 py-3 text-sm font-medium" href="/showcase/demos/northstar-clinic/contact">Request an appointment</Link><Link className="rounded-xl border border-current/20 px-6 py-3 text-sm font-medium" href="/showcase/demos/northstar-clinic/services">Explore services</Link></div><p className="mt-7 max-w-lg text-sm font-medium" style={{ color: 'var(--sc-muted)' }}>For emergencies, contact your local emergency services. This site does not provide emergency care.</p></div><div className="relative min-h-80 overflow-hidden rounded-3xl border border-current/10 shadow-sm"><Image src="/images/northstar-clinic/clinic-hero.jpg" alt="Stock photograph of a calm healthcare setting; not Northstar Clinic." fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div></Container></section>
    <Section tone="surface"><Container width="wide"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs uppercase tracking-[.18em] opacity-60">Start with what you need</p><Heading level={2} className="mt-3">Services explained in plain language.</Heading></div><Link className="text-sm font-medium underline underline-offset-4" href="/showcase/demos/northstar-clinic/services">View all services →</Link></div><div className="mt-8 grid gap-5 md:grid-cols-3">{services.map(([title, description]) => <Card key={title}><Heading level={3}>{title}</Heading><Text tone="muted" className="mt-3">{description}</Text></Card>)}</div></Container></Section>
    <Section><Container width="wide" className="grid items-center gap-10 lg:grid-cols-2"><div className="relative min-h-72 overflow-hidden rounded-3xl"><Image src="/images/northstar-clinic/consultation.jpg" alt="Stock photograph of a healthcare consultation; not Northstar Clinic." fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" /></div><div><p className="text-xs uppercase tracking-[.18em] opacity-60">People before process</p><Heading level={2} className="mt-3">Find the right kind of appointment before you get in touch.</Heading><Text tone="muted" className="mt-4">Meet the illustrative Northstar clinical team, see the areas they support, and use the request form to describe the routine appointment you are looking for.</Text><Link className="mt-6 inline-block text-sm font-medium underline underline-offset-4" href="/showcase/demos/northstar-clinic/doctors">Meet the clinicians →</Link></div></Container></Section>
    <Section tone="surface"><FAQ title="Before your visit" items={[{ question: 'Can I use this to request urgent care?', answer: 'No. Northstar is a fictional capability demonstrator and is not an emergency service. For an emergency, contact your local emergency services.' }, { question: 'Does submitting a request book an appointment?', answer: 'No. The request form is a local demonstration only: it does not send, store, or schedule anything.' }, { question: 'Where can I find payment information?', answer: 'The Patient information page shows the kind of clear insurance and payment guidance this experience is designed to provide.' }]} /></Section>
    <CTASection title="A considered first contact." subtitle="See the local appointment-request experience and the information patients need around it." cta={{ label: 'Request an appointment', href: '/showcase/demos/northstar-clinic/contact' }} />
  </main>;
}
