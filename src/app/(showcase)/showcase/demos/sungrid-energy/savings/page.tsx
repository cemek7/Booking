import { SolarEstimator } from '@/components/capability/demo-shell/SolarEstimator';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

export const metadata = { title: 'Illustrative savings planner', description: 'An assumption-transparent illustrative solar savings planner.' };
export default function SavingsPage() { return <main><Section><Container width="wide" className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start"><div><p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--sc-accent)' }}>Illustrative savings</p><Heading level={1} className="mt-4">Use a number you already know. Treat the result as a question to investigate.</Heading><Text size="lg" tone="muted" className="mt-5">The tool models broad assumptions only. It cannot account for your roof, shade, appliance mix, maintenance, tariff changes, or grid reliability.</Text></div><SolarEstimator /></Container></Section></main>; }
