import type { ReactNode } from 'react';
import { Disclaimer } from '@/components/capability/content/Disclaimer';
import { DemoFooter } from '@/components/capability/layout/DemoFooter';
import { DemoHeader } from '@/components/capability/layout/DemoHeader';
import { MERIDIAN_THEME } from '@/showcase/design-system/themes';
import { themeVars } from '@/showcase/design-system/themeVars';
const links = [{ label: 'Practice areas', href: '/showcase/demos/meridian-legal/practice-areas' }, { label: 'Team', href: '/showcase/demos/meridian-legal/team' }, { label: 'Insights', href: '/showcase/demos/meridian-legal/insights' }, { label: 'Contact', href: '/showcase/demos/meridian-legal/contact' }];
export default function MeridianLayout({ children }: { children: ReactNode }) { return <div className="sc-root sc-bg sc-body min-h-screen" data-theme="meridian" style={themeVars(MERIDIAN_THEME)}><DemoHeader name="Meridian Legal" links={links} cta={{ label: 'Request a consultation', href: '/showcase/demos/meridian-legal/contact' }} />{children}<div className="border-t border-current/10"><Disclaimer /></div><DemoFooter name="Meridian Legal" /></div>; }
