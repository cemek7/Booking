import Image from 'next/image';
import Link from 'next/link';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const clinicians = [
  ['Dr. Amara Bello', 'Family medicine', 'Illustrative profile for routine adult and family care conversations.'],
  ['Dr. Tobi Adeyemi', 'Women’s health', 'Illustrative profile for routine women’s health appointment requests.'],
  ['Dr. Ife Okafor', 'General practice', 'Illustrative profile for preventive-care and wellbeing-check information.'],
];

export const metadata = { title: 'Doctors — Northstar Clinic', description: 'Illustrative clinician profiles for the Northstar Clinic capability demonstrator.' };

export default function DoctorsPage() {
  return <main><Section><Container width="wide"><div className="grid gap-10 lg:grid-cols-[1fr_.8fr]"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-primary)' }}>Clinicians</p><Heading level={1} className="mt-3">A team page that answers practical questions first.</Heading><Text size="lg" tone="muted" className="mt-4 max-w-xl">Profiles can give patients enough context to choose a routine service or request a conversation—without making claims about outcomes or replacing clinical advice.</Text></div><div className="relative min-h-64 overflow-hidden rounded-3xl"><Image src="/images/northstar-clinic/clinical-detail.jpg" alt="Stock photograph of clinical equipment in a healthcare setting; not Northstar Clinic." fill sizes="(min-width: 1024px) 35vw, 100vw" className="object-cover" /></div></div><div className="mt-10 grid gap-5 md:grid-cols-3">{clinicians.map(([name, focus, copy]) => <Card key={name}><div className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--sc-primary) 12%, transparent)', color: 'var(--sc-primary)' }}>{name.split(' ').slice(1).map((part) => part[0]).join('')}</div><Heading level={2} className="mt-5 text-xl">{name}</Heading><p className="mt-1 text-sm font-medium" style={{ color: 'var(--sc-primary)' }}>{focus}</p><Text tone="muted" className="mt-3">{copy}</Text><Link className="mt-5 inline-block text-sm font-medium underline underline-offset-4" href="/showcase/demos/northstar-clinic/contact">Request an appointment →</Link></Card>)}</div></Container></Section></main>;
}
