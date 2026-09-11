import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const mockAuthFetch = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: (...a: unknown[]) => mockAuthFetch(...a),
}));

import PlatformAlertsBanner from '@/components/superadmin/PlatformAlertsBanner';

const ALERT = {
  id: 'meta_payment_method',
  severity: 'critical',
  title: 'Meta payment method: 5 days left',
  message: 'Meta stops delivering service messages from 2026-10-01.',
  action: 'Add a payment method in Meta Business Manager.',
};

beforeEach(() => { mockAuthFetch.mockReset(); });

describe('PlatformAlertsBanner', () => {
  it('renders nothing when there is nothing wrong', async () => {
    mockAuthFetch.mockResolvedValue({ data: { alerts: [] }, error: null });
    const { container } = render(<PlatformAlertsBanner />);
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows the alert, and the action, not just the problem', async () => {
    mockAuthFetch.mockResolvedValue({ data: { alerts: [ALERT] }, error: null });
    render(<PlatformAlertsBanner />);

    expect(await screen.findByText(/Meta payment method: 5 days left/)).toBeInTheDocument();
    // An alert that says what is wrong but not what to do gets ignored.
    expect(screen.getByText(/Add a payment method in Meta Business Manager/)).toBeInTheDocument();
  });

  it('marks a critical alert with role="alert" so screen readers interrupt', async () => {
    mockAuthFetch.mockResolvedValue({ data: { alerts: [ALERT] }, error: null });
    render(<PlatformAlertsBanner />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('uses the quieter role for a warning', async () => {
    mockAuthFetch.mockResolvedValue({
      data: { alerts: [{ ...ALERT, id: 'fx', severity: 'warning' }] }, error: null,
    });
    render(<PlatformAlertsBanner />);
    await screen.findByTestId('platform-alert-fx');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers no way to dismiss, because these are states and not events', async () => {
    mockAuthFetch.mockResolvedValue({ data: { alerts: [ALERT] }, error: null });
    render(<PlatformAlertsBanner />);
    await screen.findByTestId('platform-alert-meta_payment_method');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays out of the way when the request fails', async () => {
    // The rest of the dashboard must still render.
    mockAuthFetch.mockRejectedValue(new Error('network'));
    const { container } = render(<PlatformAlertsBanner />);
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });
});
