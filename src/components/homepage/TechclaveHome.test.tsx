import { render, screen } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import Home from '@/app/page';

jest.mock('@/components/brand/BrandMark', () => ({
  __esModule: true,
  default: () => <div data-testid="brand-mark" />,
}));

describe('Techclave home', () => {
  it('leads with one short headline and a route to Booka', () => {
    render(<Home />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent?.trim().split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(screen.getAllByRole('link', { name: /booka/i })[0]).toHaveAttribute('href', '/booka');
  });

  it('drops filler tiles and keeps boxed surfaces to two', () => {
    render(<Home />);

    expect(screen.queryByText('Product-first')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI products for customer operations/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-surface]').length).toBeLessThanOrEqual(2);
  });

  it('keeps the legal footer links', () => {
    render(<Home />);

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Data processing' })).toHaveAttribute('href', '/dpa');
  });

  it('offers a phone menu', () => {
    render(<Home />);

    expect(screen.getByRole('button', { name: /menu/i })).toHaveAttribute('aria-expanded', 'false');
  });
});
