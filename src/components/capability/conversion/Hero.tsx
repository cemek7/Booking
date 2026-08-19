import type { ReactNode } from 'react';
import { Container } from '../core/Container';
import { Heading } from '../core/Heading';
import { Text } from '../core/Text';

export type HeroProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Primary/secondary CTAs rendered as anchors (kept framework-agnostic — no Next Link dependency here). */
  primaryCta?: { href: string; label: string };
  secondaryCta?: { href: string; label: string };
  children?: ReactNode;
};

/** Above-the-fold hero section: eyebrow, headline, subtitle, and up to two CTAs. */
export function Hero({ eyebrow, title, subtitle, primaryCta, secondaryCta, children }: HeroProps) {
  return (
    <Container width="wide" className="py-20 sm:py-28">
      {eyebrow ? <Text size="sm" tone="muted" className="mb-3 uppercase tracking-wide">{eyebrow}</Text> : null}
      <Heading level={1}>{title}</Heading>
      {subtitle ? (
        <Text size="lg" tone="muted" className="mt-4 max-w-2xl">
          {subtitle}
        </Text>
      ) : null}
      {(primaryCta || secondaryCta) && (
        <div className="mt-8 flex flex-wrap gap-4">
          {primaryCta ? (
            <a
              href={primaryCta.href}
              className="sc-primary rounded-md px-6 py-3 text-sm font-medium hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {primaryCta.label}
            </a>
          ) : null}
          {secondaryCta ? (
            <a
              href={secondaryCta.href}
              className="rounded-md border border-current/20 px-6 py-3 text-sm font-medium hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {secondaryCta.label}
            </a>
          ) : null}
        </div>
      )}
      {children}
    </Container>
  );
}
