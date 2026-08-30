import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import BookaLanding from '@/components/homepage/BookaLanding';

jest.mock('@/components/brand/BrandMark', () => ({
  __esModule: true,
  default: () => <div data-testid="brand-mark" />,
}));

beforeAll(() => {
  HTMLElement.prototype.scrollTo = jest.fn();
});

describe('BookaLanding', () => {
  it('offers working pilot and missed-revenue conversion paths', () => {
    render(<BookaLanding />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /revenue pilot/i })[0]).toHaveAttribute(
      'href',
      '/booka/revenue-pilot',
    );
    expect(screen.getAllByRole('link', { name: /missed revenue report/i })[0]).toHaveAttribute(
      'href',
      '/booka/missed-revenue-report',
    );
    expect(document.querySelector('#revenue-pilot')).toBeInTheDocument();
    expect(document.querySelector('#missed-revenue-report')).toBeInTheDocument();
  });

  it('renders four priced plans with a visible usage policy', () => {
    render(<BookaLanding />);

    expect(screen.getAllByTestId('pricing-plan')).toHaveLength(4);
    expect(screen.getAllByTestId('usage-policy')).toHaveLength(4);
  });

  it('defaults the cross-vertical demonstration to beauty', () => {
    render(<BookaLanding />);

    expect(screen.getByTestId('vertical-demo')).toHaveAttribute(
      'data-default-vertical',
      'beauty',
    );
  });
});
