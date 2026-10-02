import { render, screen } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';
import SectionHeading from '@/components/homepage/SectionHeading';
import CtaLink from '@/components/homepage/CtaLink';
import Panel from '@/components/homepage/Panel';

describe('SectionHeading', () => {
  it('renders the kicker and an h2 by default', () => {
    render(<SectionHeading kicker="Pricing" title="Honest pricing" />);

    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Honest pricing' })).toBeInTheDocument();
  });

  it('renders an h1 when asked and keeps dark-tone titles light', () => {
    render(<SectionHeading as="h1" tone="dark" kicker="Booka" title="Main" lede="One line." />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Main' });
    expect(heading.className).toContain('text-[var(--brand-paper)]');
    expect(screen.getByText('One line.')).toBeInTheDocument();
  });
});

describe('CtaLink', () => {
  it('renders a primary button link with a visible focus ring', () => {
    render(<CtaLink href="/booka">View Booka</CtaLink>);

    const link = screen.getByRole('link', { name: 'View Booka' });
    expect(link).toHaveAttribute('href', '/booka');
    expect(link.className).toContain('rounded-full');
    expect(link.className).toContain('focus-visible:');
  });

  it('renders a text link with an arrow', () => {
    render(
      <CtaLink href="/contact" variant="text">
        Talk to us
      </CtaLink>,
    );

    const link = screen.getByRole('link', { name: /talk to us/i });
    expect(link).toHaveTextContent('→');
    expect(link.className).not.toContain('rounded-full');
    expect(link.className).toContain('focus-visible:');
  });
});

describe('Panel', () => {
  it('marks itself as a boxed surface and applies the tone', () => {
    render(
      <Panel tone="dark" data-testid="panel">
        Inside
      </Panel>,
    );

    const panel = screen.getByTestId('panel');
    expect(panel).toHaveAttribute('data-surface', 'dark');
    expect(panel.className).toContain('bg-[var(--brand-ink)]');
  });
});
