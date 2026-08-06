import type { ReactNode } from 'react';
import { Disclaimer } from '@/components/capability/content/Disclaimer';
import { DemoFooter } from '@/components/capability/layout/DemoFooter';
import { DemoHeader } from '@/components/capability/layout/DemoHeader';
import { SUNGRID_THEME } from '@/showcase/design-system/themes';
import { themeVars } from '@/showcase/design-system/themeVars';

const links = [
  { label: 'Solutions', href: '/showcase/demos/sungrid-energy/solutions' },
  { label: 'Savings', href: '/showcase/demos/sungrid-energy/savings' },
  { label: 'Projects', href: '/showcase/demos/sungrid-energy/projects' },
  { label: 'Process', href: '/showcase/demos/sungrid-energy/process' },
];

export default function SunGridLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sc-root sc-bg sc-body min-h-screen" data-theme="sungrid" style={themeVars(SUNGRID_THEME)}>
      <DemoHeader name="SunGrid Energy" links={links} cta={{ label: 'Request assessment', href: '/showcase/demos/sungrid-energy/contact' }} />
      {children}
      <div className="border-t border-current/10"><Disclaimer /></div>
      <DemoFooter name="SunGrid Energy" />
    </div>
  );
}
