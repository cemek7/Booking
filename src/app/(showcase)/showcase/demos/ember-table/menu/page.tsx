import Image from 'next/image';
import { CTASection } from '@/components/capability/conversion/CTASection';
import { Container } from '@/components/capability/core/Container';
import { Heading } from '@/components/capability/core/Heading';
import { Section } from '@/components/capability/core/Section';
import { Text } from '@/components/capability/core/Text';

const sections: Array<{ name: string; note: string; items: Array<[string, string, string]> }> = [
  {
    name: 'To begin',
    note: 'Vegetarian (v) and gluten-free (gf) options noted per dish.',
    items: [
      ['Charred heirloom carrots (v, gf)', 'Smoked yoghurt, dukkah, herb oil', '₦9,500'],
      ['Ember flatbread', 'Whipped butter, confit garlic, sea salt', '₦7,000'],
      ['Cured sea bream (gf)', 'Citrus, radish, cold-pressed oil', '₦12,000'],
    ],
  },
  {
    name: 'From the fire',
    note: 'Cooked over open flame; ask your server about the evening’s cuts.',
    items: [
      ['Wood-grilled ribeye (gf)', 'Bone-marrow butter, charred onion', '₦28,000'],
      ['Whole roasted plantain (v)', 'Chili honey, toasted seeds', '₦11,500'],
      ['Fire-roasted market fish (gf)', 'Seasonal greens, herb salsa', '₦24,000'],
    ],
  },
  {
    name: 'To finish',
    note: 'A short list that changes with the season.',
    items: [
      ['Burnt-honey custard', 'Caramel, toasted oat crumb', '₦8,000'],
      ['Dark chocolate & smoked salt (gf)', 'Olive oil, crème fraîche', '₦8,500'],
    ],
  },
];

export const metadata = { title: 'Menu — Ember Table', description: 'A seasonal illustrative menu with dietary notes in the Ember Table capability demonstrator.' };

export default function MenuPage() {
  return <main>
    <Section><Container width="wide" className="grid items-center gap-10 lg:grid-cols-[1.1fr_.9fr]"><div><p className="text-xs font-semibold uppercase tracking-[.18em]" style={{ color: 'var(--sc-eyebrow)' }}>Menu</p><Heading level={1} className="sc-display mt-3">A seasonal menu, described plainly.</Heading><Text size="lg" tone="muted" className="mt-4 max-w-xl">This is an illustrative menu for the demonstrator. Dishes and prices are examples that show how a fine-dining menu can be presented with clear dietary notes.</Text></div><div className="relative min-h-64 overflow-hidden rounded-3xl"><Image src="/images/ember-table/dish-1.jpg" alt="Stock photograph of a plated fine-dining dish; not an Ember Table dish." fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" /></div></Container></Section>
    <Section tone="surface"><Container width="wide" className="grid gap-10 lg:grid-cols-2">{sections.map((section) => <div key={section.name}><Heading level={2} className="sc-display">{section.name}</Heading><Text tone="muted" className="mt-1 text-sm">{section.note}</Text><ul className="mt-5 space-y-5">{section.items.map(([title, description, price]) => <li key={title} className="border-b border-current/10 pb-4"><div className="flex items-baseline justify-between gap-4"><span className="font-medium">{title}</span><span className="text-sm" style={{ color: 'var(--sc-primary)' }}>{price}</span></div><Text tone="muted" className="mt-1 text-sm">{description}</Text></li>)}</ul></div>)}</Container></Section>
    <CTASection title="Found your table for the evening?" cta={{ label: 'Reserve a table', href: '/showcase/demos/ember-table/contact' }} />
  </main>;
}
