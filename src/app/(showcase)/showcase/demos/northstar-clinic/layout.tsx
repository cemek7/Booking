import type { ReactNode } from 'react';
import { Disclaimer } from '@/components/capability/content/Disclaimer';
import { DemoFooter } from '@/components/capability/layout/DemoFooter';
import { DemoHeader } from '@/components/capability/layout/DemoHeader';
import { NORTHSTAR_THEME } from '@/showcase/design-system/themes';
import { themeVars } from '@/showcase/design-system/themeVars';

const links = [
  { label: 'Services', href: '/showcase/demos/northstar-clinic/services' },
  { label: 'Doctors', href: '/showcase/demos/northstar-clinic/doctors' },
  { label: 'Patient information', href: '/showcase/demos/northstar-clinic/patient-information' },
  { label: 'Contact', href: '/showcase/demos/northstar-clinic/contact' },
];

export default function NorthstarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sc-root sc-bg sc-body min-h-screen" data-theme="northstar" style={themeVars(NORTHSTAR_THEME)}>
      <DemoHeader name="Northstar Clinic" links={links} cta={{ label: 'Request an appointment', href: '/showcase/demos/northstar-clinic/contact' }} />
      {children}
      <div className="border-t border-current/10"><Disclaimer /></div>
      <DemoFooter name="Northstar Clinic" />
    </div>
  );
}
