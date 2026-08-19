// Jest globals are available without import
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { UsagePanel } from '@/components/UsagePanel.client';

// The panel now uses authFetch + the tenant-currency hook.
jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: jest.fn(),
}));
jest.mock('@/hooks/useTenantCurrency', () => ({
  useTenantCurrency: () => ({
    currency: 'NGN',
    locale: 'en-NG',
    format: (n: number) => `NGN ${Number(n || 0).toFixed(2)}`,
  }),
}));

const { authFetch } = require('@/lib/auth/auth-api-client');

describe('UsagePanel', () => {
  beforeEach(() => authFetch.mockReset());

  it('shows the 7-day summary once data loads', async () => {
    authFetch.mockResolvedValueOnce({
      status: 200,
      data: {
        window: [{ day: '2025-11-13', bookings: 2, deposits: 1, llm_tokens: 50 }],
        quota: { quota: 1000, remaining: 950, allowed: true },
      },
    });
    render(<UsagePanel tenantId="t1" />);

    // Quota surfaced as remaining-of-total (unique text), plus the summary labels.
    await waitFor(() => expect(screen.getByText(/950 of 1,000 left/)).toBeTruthy());
    expect(screen.getByText('Deposits taken')).toBeTruthy();
    expect(screen.getByText('AI activity')).toBeTruthy();
  });

  it('shows an error when the request fails', async () => {
    authFetch.mockResolvedValueOnce({ status: 500, error: { message: 'Boom', status: 500 } });
    render(<UsagePanel tenantId="t1" />);
    await waitFor(() => expect(screen.getByText(/Boom/)).toBeTruthy());
  });
});
