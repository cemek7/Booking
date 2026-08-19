import Link from 'next/link';
import { Container } from '../core/Container';

export type DemoNavLink = {
  href: string;
  label: string;
};

export type DemoHeaderProps = {
  /** Demonstrator/brand name shown as the wordmark, e.g. 'SunGrid Energy'. */
  name: string;
  links?: DemoNavLink[];
  /** Optional call-to-action rendered at the end of the nav (e.g. "Request assessment"). */
  cta?: DemoNavLink;
};

/** Sticky top navigation shell for a capability demonstrator. Chrome-only — no analytics. */
export function DemoHeader({ name, links = [], cta }: DemoHeaderProps) {
  return (
    <header className="sc-surface sticky top-0 z-40 border-b border-current/10">
      <Container width="wide" className="flex h-16 items-center justify-between">
        <Link href="/" className="sc-display text-lg font-semibold">
          {name}
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="sc-body text-sm hover:opacity-80">
              {link.label}
            </Link>
          ))}
          {cta ? (
            <Link
              href={cta.href}
              className="sc-primary rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {cta.label}
            </Link>
          ) : null}
        </nav>
      </Container>
    </header>
  );
}
