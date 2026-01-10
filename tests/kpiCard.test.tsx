// Jest globals are available without import
import React from 'react';
import { render, screen } from '@testing-library/react';
import { KpiCard } from '@/components/KpiCard';

describe('KpiCard', () => {
  it('renders value and title', () => {
    render(<KpiCard title="MRR" value={1234} />);
    expect(screen.getByText('MRR')).toBeTruthy();
    expect(screen.getByText('1234')).toBeTruthy();
  });
  it('shows delta and up trend', () => {
    render(<KpiCard title="Bookings" value={45} delta={12.3} trend="up" />);
    expect(screen.getByLabelText('trend-up')).toBeTruthy();
    expect(screen.getByLabelText('delta').textContent).toMatch(/12.3%/);
  });
  it('shows down trend symbol', () => {
    render(<KpiCard title="No Shows" value={5} trend="down" />);
    expect(screen.getByLabelText('trend-down')).toBeTruthy();
  });
  it('accessible aria-label override', () => {
    render(<KpiCard title="Hidden" ariaLabel="Visible KPI" value={10} />);
    expect(screen.getByLabelText('Visible KPI')).toBeTruthy();
  });
});
