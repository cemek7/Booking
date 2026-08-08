import type { ReactNode } from 'react';
import Link from 'next/link';
import { Disclaimer } from '@/components/capability/content/Disclaimer';
import { DemoFooter } from '@/components/capability/layout/DemoFooter';
import { DemoHeader } from '@/components/capability/layout/DemoHeader';
import { EMBER_THEME } from '@/showcase/design-system/themes';
import { themeVars } from '@/showcase/design-system/themeVars';

const links = [
  { label: 'Menu', href: '/showcase/demos/ember-table/menu' },
  { label: 'Private dining', href: '/showcase/demos/ember-table/private-dining' },
  { label: 'About', href: '/showcase/demos/ember-table/about' },
  { label: 'Reservations', href: '/showcase/demos/ember-table/contact' },
];

export default function EmberLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sc-root sc-bg sc-body min-h-screen" data-theme="ember" style={themeVars(EMBER_THEME)}>
      <DemoHeader name="Ember Table" links={links} cta={{ label: 'Reserve a table', href: '/showcase/demos/ember-table/contact' }} />
      {children}
      {/* Mobile sticky reservation CTA */}
      <Link
        href="/showcase/demos/ember-table/contact"
        className="sc-primary fixed inset-x-4 bottom-4 z-40 rounded-xl px-6 py-3 text-center text-sm font-medium shadow-lg md:hidden"
      >
        Reserve a table
      </Link>
      <div className="border-t border-current/10"><Disclaimer /></div>
      <DemoFooter name="Ember Table" />
    </div>
  );
}
