import type { ReactNode } from 'react';
import { Disclaimer } from '@/components/capability/content/Disclaimer';
import { DemoFooter } from '@/components/capability/layout/DemoFooter';
import { DemoHeader } from '@/components/capability/layout/DemoHeader';
import { HAVEN_THEME } from '@/showcase/design-system/themes';
import { themeVars } from '@/showcase/design-system/themeVars';

const links = [
  { label: 'Properties', href: '/showcase/demos/haven-realty/properties' },
  { label: 'Sell with us', href: '/showcase/demos/haven-realty/sell' },
  { label: 'Contact', href: '/showcase/demos/haven-realty/contact' },
];

export default function HavenLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sc-root sc-bg sc-body min-h-screen" data-theme="haven" style={themeVars(HAVEN_THEME)}>
      <DemoHeader name="Haven Realty" links={links} cta={{ label: 'Book a viewing', href: '/showcase/demos/haven-realty/contact' }} />
      {children}
      <div className="border-t border-current/10"><Disclaimer /></div>
      <DemoFooter name="Haven Realty" />
    </div>
  );
}
