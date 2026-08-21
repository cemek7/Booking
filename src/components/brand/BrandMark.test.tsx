import { render, screen } from '@testing-library/react';
import BrandMark from './BrandMark';

describe('BrandMark', () => {
  it('keeps the Techclave logo inside the established rounded square badge', () => {
    render(<BrandMark variant="techclave" className="h-11 w-11" />);

    const mark = screen.getByTestId('brand-mark');
    const logo = screen.getByRole('img', { name: 'Techclave logo' });
    expect(mark).toHaveClass('h-11', 'w-11', 'rounded-[1.35rem]');
    expect(logo).toHaveAttribute('src', '/brand/techclave-mark.png');
  });

  it('keeps the Booka logo inside the established rounded square badge', () => {
    render(<BrandMark variant="booka" className="h-10 w-10" />);

    const logo = screen.getByRole('img', { name: 'Booka logo' });
    expect(screen.getByTestId('brand-mark')).toHaveClass('h-10', 'w-10', 'rounded-[1.35rem]');
    expect(logo).toHaveAttribute('src', '/brand/booka-mark.png');
  });
});
