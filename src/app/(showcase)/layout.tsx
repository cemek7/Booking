import type { Metadata } from 'next';
export const metadata: Metadata = { title: { default: 'TechClave — Capability Showcase', template: '%s — TechClave Showcase' } };
export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  // Neutral base wrapper; each demonstrator sets its own data-theme below this.
  return <div className="showcase-root min-h-screen">{children}</div>;
}
