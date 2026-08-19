import { Container } from '../core/Container';
import { Heading } from '../core/Heading';
import { Text } from '../core/Text';
import { Section } from '../core/Section';

export type CTASectionProps = {
  title: string;
  subtitle?: string;
  cta: { href: string; label: string };
};

/** Mid/bottom-of-page conversion band: headline + single primary CTA. */
export function CTASection({ title, subtitle, cta }: CTASectionProps) {
  return (
    <Section tone="surface">
      <Container width="narrow" className="text-center">
        <Heading level={2}>{title}</Heading>
        {subtitle ? (
          <Text tone="muted" className="mt-3">
            {subtitle}
          </Text>
        ) : null}
        <a
          href={cta.href}
          className="sc-primary mt-8 inline-flex items-center justify-center rounded-md px-6 py-3 text-sm font-medium hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          {cta.label}
        </a>
      </Container>
    </Section>
  );
}
