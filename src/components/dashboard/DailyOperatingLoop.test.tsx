import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, jest } from '@jest/globals';
import { DailyOperatingLoop } from './DailyOperatingLoop';

const activeLoop = {
  state: 'active' as const,
  automationPaused: false,
  primaryObjective: {
    id: 'objective-1', kind: 'confirm_booking', title: 'Confirm Ada’s appointment',
    explanation: '₦45,000 in tomorrow’s appointments is still unconfirmed.',
    evidence: { customerName: 'Ada' }, affectedRecordIds: ['booking-1'], amountAtRisk: 45000,
    expiresAt: '2026-08-25T09:00:00.000Z', status: 'active' as const,
    score: { customerUrgency: 0, revenueRisk: 90, growthValue: 0, deadline: 100, total: 500 },
  },
  supportingSignals: ['11 bookings confirmed', 'All WhatsApp enquiries answered', '2 leads need follow-up', 'hidden fourth signal'],
};

describe('DailyOperatingLoop', () => {
  it('does not render for a tenant whose owner flag is off', () => {
    const { container } = render(<DailyOperatingLoop enabled={false} loop={activeLoop} onAction={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the owner focused on one objective and exposes safe actions', () => {
    const onAction = jest.fn();
    render(<DailyOperatingLoop enabled loop={activeLoop} onAction={onAction} />);

    expect(screen.getByText('Today’s Front Desk')).toBeInTheDocument();
    expect(screen.getByText('Confirm Ada’s appointment')).toBeInTheDocument();
    expect(screen.queryByText('hidden fourth signal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Let Booka handle it' }));
    expect(onAction).toHaveBeenCalledWith('execute', 'objective-1');
  });

  it('shows a clear state without removing the existing dashboard around it', () => {
    render(<DailyOperatingLoop enabled loop={{ ...activeLoop, state: 'clear', primaryObjective: null, supportingSignals: [] }} onAction={jest.fn()} />);
    expect(screen.getByText('Today’s front desk is clear.')).toBeInTheDocument();
  });
});
