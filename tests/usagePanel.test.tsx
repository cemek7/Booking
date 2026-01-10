// Jest globals are available without import
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { UsagePanel } from '@/components/UsagePanel.client';

// Mock fetch
const mockFetch = jest.fn();
// @ts-ignore
global.fetch = mockFetch;

describe('UsagePanel', () => {
  it('shows loading then data', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ window: [{ day: '2025-11-13', bookings: 2, deposits: 1, llm_tokens: 50 }], quota: { quota: 1000, remaining: 950, allowed: true } }) });
    render(<UsagePanel tenantId="t1" />);
    expect(screen.getByText(/Loading usage/i)).toBeTruthy();
    await waitFor(() => screen.getByText('2025-11-13'));
    expect(screen.getByText('2')).toBeTruthy();
  });
  it('shows error on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    render(<UsagePanel tenantId="t1" />);
    await waitFor(() => screen.getByText(/Fetch failed/));
    expect(screen.getByText(/Fetch failed/)).toBeTruthy();
  });
});
