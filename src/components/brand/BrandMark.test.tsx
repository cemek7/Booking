import { render, screen } from '@testing-library/react';
import BrandMark from './BrandMark';

describe('BrandMark', () => {
  it('renders the cropped Techclave logo asset with an accessible label', () => {
    render(<BrandMark variant="techclave" />);

    const logo = screen.getByRole('img', { name: 'Techclave logo' });
    expect(logo).toHaveAttribute('src', '/brand/techclave-logo.png');
  });

  it('renders the cropped Booka logo asset with an accessible label', () => {
    render(<BrandMark variant="booka" />);

    const logo = screen.getByRole('img', { name: 'Booka logo' });
    expect(logo).toHaveAttribute('src', '/brand/booka-logo.png');
  });
});
