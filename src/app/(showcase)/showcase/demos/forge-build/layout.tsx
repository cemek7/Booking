import type { ReactNode } from 'react';
import { Disclaimer } from '@/components/capability/content/Disclaimer';
import { DemoFooter } from '@/components/capability/layout/DemoFooter';
import { DemoHeader } from '@/components/capability/layout/DemoHeader';
import { FORGE_THEME } from '@/showcase/design-system/themes';
import { themeVars } from '@/showcase/design-system/themeVars';
const links = [{ label: 'Services', href: '/showcase/demos/forge-build/services' }, { label: 'Projects', href: '/showcase/demos/forge-build/projects' }, { label: 'Process', href: '/showcase/demos/forge-build/process' }, { label: 'Contact', href: '/showcase/demos/forge-build/contact' }];
export default function ForgeLayout({ children }: { children: ReactNode }) { return <div className="sc-root sc-bg sc-body min-h-screen" data-theme="forge" style={themeVars(FORGE_THEME)}><DemoHeader name="Forge Build" links={links} cta={{ label: 'Request a quote', href: '/showcase/demos/forge-build/contact' }} />{children}<div className="border-t border-current/10"><Disclaimer /></div><DemoFooter name="Forge Build" /></div>; }
