import Link from 'next/link';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { Hero } from '@/components/capability/conversion/Hero';
import { ProcessSteps } from '@/components/capability/conversion/ProcessSteps';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

export const metadata = { title: 'Solar systems planned around the way you use energy', description: 'A TechClave capability demonstrator for a solar installer lead-generation experience.' };

const steps = [{ title: 'Assess', description: 'Understand your load profile, site constraints, and priorities.' }, { title: 'Design', description: 'Translate the assessment into a right-sized solar and storage plan.' }, { title: 'Commission', description: 'Install, test, and hand over a documented system.' }];

export default function SunGridHome() {
  return <main>
    <Hero eyebrow="Capability Demonstrator · Solar energy" title="Make your energy plan feel knowable." subtitle="A considered solar assessment experience for homes and businesses that need clearer next steps—not louder promises." primaryCta={{ label: 'Request a site assessment', href: '/showcase/demos/sungrid-energy/contact' }} secondaryCta={{ label: 'Explore the illustrative savings tool', href: '/showcase/demos/sungrid-energy/savings' }}>
      <div className="mt-14 grid gap-3 sm:grid-cols-3" aria-label="SunGrid capability highlights"><Signal value="01" label="Load-aware planning" /><Signal value="02" label="Assessment before proposal" /><Signal value="03" label="Commissioning support" /></div>
    </Hero>
    <Section tone="surface"><Container width="wide"><div className="grid gap-6 lg:grid-cols-2"><Card><p className="text-xs uppercase tracking-[0.18em] opacity-60">For homes</p><Heading level={2} className="mt-4">A calmer route from generator dependence to a measured plan.</Heading><Text tone="muted" className="mt-4">Start with daytime demand, roof conditions, and the appliances you want protected. The goal is a system that matches your real routines.</Text><Link className="mt-6 inline-block font-medium underline underline-offset-4" href="/showcase/demos/sungrid-energy/solutions#residential">Residential solutions →</Link></Card><Card><p className="text-xs uppercase tracking-[0.18em] opacity-60">For businesses</p><Heading level={2} className="mt-4">Energy resilience designed around operating hours and critical loads.</Heading><Text tone="muted" className="mt-4">Map the equipment that matters, the interruptions you can’t absorb, and the operating pattern your system should support.</Text><Link className="mt-6 inline-block font-medium underline underline-offset-4" href="/showcase/demos/sungrid-energy/solutions#commercial">Commercial solutions →</Link></Card></div></Container></Section>
    <Section><ProcessSteps title="A transparent path to a solar decision" steps={steps} /></Section>
    <CTASection title="Begin with the site, not a sales script." subtitle="Share a few details locally in this capability demonstrator to see the assessment flow." cta={{ label: 'Request assessment', href: '/showcase/demos/sungrid-energy/contact' }} />
  </main>;
}

function Signal({ value, label }: { value: string; label: string }) { return <div className="border-l-2 pl-4" style={{ borderColor: 'var(--sc-primary)' }}><span className="sc-display text-2xl font-semibold">{value}</span><p className="mt-1 text-sm opacity-70">{label}</p></div>; }
