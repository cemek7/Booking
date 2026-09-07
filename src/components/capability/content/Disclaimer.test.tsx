import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Disclaimer } from './Disclaimer';
import { DISCLOSURE } from '@/showcase/content/disclosure';

describe('Disclaimer', () => {
  it('renders the exact DISCLOSURE string', () => {
    render(<Disclaimer />);
    expect(screen.getByText(DISCLOSURE)).toBeTruthy();
  });
});
