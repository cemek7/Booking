import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';
import MobileNav from '@/components/homepage/MobileNav';

const links = [
  { href: '#pricing', label: 'Pricing' },
  { href: '/booka/auth/signin', label: 'Sign in' },
];

describe('MobileNav', () => {
  it('starts closed and opens on tap', () => {
    render(<MobileNav links={links} cta={{ href: '/booka/auth/onboarding', label: 'Start onboarding' }} />);

    const button = screen.getByRole('button', { name: /menu/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing');
    expect(screen.getByRole('link', { name: 'Start onboarding' })).toHaveAttribute(
      'href',
      '/booka/auth/onboarding',
    );
  });

  it('closes after a link is chosen or Escape is pressed', () => {
    render(<MobileNav links={links} cta={{ href: '/booka/auth/onboarding', label: 'Start onboarding' }} />);
    const button = screen.getByRole('button', { name: /menu/i });

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('link', { name: 'Pricing' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('is hidden from medium screens up', () => {
    const { container } = render(<MobileNav links={links} />);

    expect(container.firstElementChild?.className).toContain('md:hidden');
  });
});
