import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';
import { PropertyBrowser } from '@/components/capability/demo-shell/PropertyBrowser';

export const metadata = { title: 'Properties — Haven Realty', description: 'Filter illustrative property listings by area, type, and budget in the Haven Realty capability demonstrator.' };

export default function PropertiesPage() {
  return <main><Section><Container width="wide"><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-eyebrow)' }}>Properties</p><Heading level={1} className="sc-display mt-3">Find a home that fits.</Heading><Text size="lg" tone="muted" className="mt-4 max-w-2xl">These are illustrative listings for the demonstrator. Filtering happens instantly in your browser — no page reloads and no real data.</Text><div className="mt-10"><PropertyBrowser /></div></Container></Section></main>;
}
