import { CTASection } from '@/components/capability/conversion/CTASection';
import { Card } from '@/components/capability/core/Card';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

export const metadata = { title: 'System planning studies', description: 'Illustrative solar system-planning studies for the SunGrid capability demonstrator.' };

const studies = [
  { code: 'R-01', title: 'Household continuity brief', tags: ['Critical circuits', 'Battery prioritisation'], copy: 'An illustrative planning study for a home that wants lighting, refrigeration, connectivity, and selected appliances available through outages.' },
  { code: 'C-02', title: 'Daytime operating-load brief', tags: ['Commercial hours', 'Phased system scope'], copy: 'An illustrative planning study for a business aligning solar generation with daytime equipment use and a measured expansion path.' },
  { code: 'H-03', title: 'Hybrid resilience brief', tags: ['Load segmentation', 'Monitoring-ready'], copy: 'An illustrative planning study showing how a mixed property could separate essential loads from flexible demand before design begins.' },
];

export default function ProjectsPage() { return <main><Section><Container width="wide"><p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--sc-accent)' }}>Planning studies</p><Heading level={1} className="mt-4 max-w-3xl">Show the reasoning before you show the hardware.</Heading><Text size="lg" tone="muted" className="mt-5 max-w-2xl">These are illustrative system-planning studies created for this demonstrator—not client projects, installations, or performance claims.</Text><div className="mt-12 grid gap-5 md:grid-cols-3">{studies.map((study) => <Card key={study.code} className="overflow-hidden p-0"><div className="relative h-44 border-b border-current/10 p-5" style={{ background: 'linear-gradient(135deg, var(--sc-surface), var(--sc-background))' }}><span className="sc-display text-5xl font-semibold opacity-20">{study.code}</span><div className="absolute inset-x-5 bottom-5 h-px" style={{ background: 'var(--sc-primary)' }} /></div><div className="p-6"><p className="text-xs uppercase tracking-wider opacity-60">Illustrative study</p><Heading level={3} className="mt-3">{study.title}</Heading><Text tone="muted" size="sm" className="mt-3">{study.copy}</Text><ul className="mt-5 flex flex-wrap gap-2">{study.tags.map((tag) => <li key={tag} className="rounded-full border border-current/15 px-2.5 py-1 text-xs">{tag}</li>)}</ul></div></Card>)}</div></Container></Section><CTASection title="Let the site conditions shape the conversation." subtitle="A proper assessment turns an illustrative brief into a technically grounded proposal." cta={{ label: 'Request assessment', href: '/showcase/demos/sungrid-energy/contact' }} /></main>; }
