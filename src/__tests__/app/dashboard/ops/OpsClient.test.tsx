import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import OpsClient from '@/app/dashboard/ops/OpsClient';

const authFetchMock = jest.fn();

jest.mock('@/hooks/useAuthHeaders', () => ({
  useAuthHeaders: jest.fn(() => ({
    authorization: 'Bearer test-token',
    'x-tenant-id': 'tenant-123',
  })),
}));

jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
}));

const opsPayload = {
  campaigns: [
    {
      id: 'camp-1',
      campaign_type: 'reactivation',
      action: 'send_reactivation',
      target_phone: '+2348010000001',
      status: 'pending',
      attempts: 0,
      scheduled_for: '2026-05-20T08:00:00.000Z',
      next_retry_at: null,
      source_event: 'customer_dormant',
      metadata: { channel: 'whatsapp' },
      error: null,
      created_at: '2026-05-20T08:00:00.000Z',
    },
    {
      id: 'camp-2',
      campaign_type: 'reminder',
      action: 'send_reminder',
      target_phone: '+2348010000002',
      status: 'retry_scheduled',
      attempts: 1,
      scheduled_for: '2026-05-19T08:00:00.000Z',
      next_retry_at: '2026-05-20T12:00:00.000Z',
      source_event: 'booking_created',
      metadata: { channel: 'whatsapp' },
      error: 'temporary failure',
      created_at: '2026-05-19T08:00:00.000Z',
    },
  ],
  escalations: [
    {
      id: 'esc-1',
      customer_phone: '+2348010000101',
      session_id: 'session-1',
      reason: 'refund_request',
      status: 'pending',
      assigned_agent_id: null,
      created_at: '2026-05-20T07:00:00.000Z',
      resolved_at: null,
    },
    {
      id: 'esc-2',
      customer_phone: '+2348010000102',
      session_id: 'session-2',
      reason: 'angry_customer',
      status: 'claimed',
      assigned_agent_id: 'agent-7',
      created_at: '2026-05-20T06:30:00.000Z',
      resolved_at: null,
    },
  ],
  memory: [
    {
      id: 'mem-1',
      memory_key: 'preferred_reminder_time',
      memory_value: { hour: 9, format: 'morning' },
      source: 'campaign',
      confidence: 0.9,
      hit_count: 4,
      last_seen_at: '2026-05-20T06:00:00.000Z',
      updated_at: '2026-05-20T06:00:00.000Z',
    },
  ],
  outcomes: [
    { id: 'revenue_recovery', label: 'Revenue recovery', count: 2, value: 5000 },
    { id: 'repeat_booking_lift', label: 'Repeat booking lift', count: 1, value: 12 },
  ],
  revenue_recovered_by_day: [
    { day: '2026-05-19', revenue: 2000, count: 1 },
    { day: '2026-05-20', revenue: 3000, count: 1 },
  ],
  totals: {
    open_escalations: 2,
    retrying_campaigns: 1,
    pending_campaigns: 1,
  },
};

describe('OpsClient', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: unknown }) => {
      if (url === '/api/sias/ops') {
        return { data: opsPayload, error: null };
      }

      if (url === '/api/campaigns/run' && options?.method === 'POST') {
        return { data: { processed: 1, delivered: 1, failed: 0 }, error: null };
      }

      if (url.startsWith('/api/escalation/') && options?.method === 'PATCH') {
        return { data: { escalation: { id: url.split('/').pop(), status: 'claimed' } }, error: null };
      }

      return { data: null, error: null };
    });
  });

  it('renders the SIAS control room and exposes retry controls', async () => {
    render(<OpsClient />);

    await waitFor(() => expect(screen.getByText('Escalations, campaigns, and memory')).toBeInTheDocument());

    expect(screen.getByText('SIAS operations center')).toBeInTheDocument();
    expect(screen.getByText('Revenue recovered by day')).toBeInTheDocument();
    expect(screen.getByText('Campaign pipeline')).toBeInTheDocument();
    expect(screen.getByText('Escalation inbox')).toBeInTheDocument();
    expect(screen.getByText('Operational memory')).toBeInTheDocument();
    expect(screen.getByText('Outcome ledger')).toBeInTheDocument();
    expect(screen.getByText('preferred_reminder_time')).toBeInTheDocument();
    expect(screen.getByText('Revenue recovery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh snapshot/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Retry now/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Claim$/i })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: /Retry now/i })[0]);

    await waitFor(() =>
      expect(authFetchMock).toHaveBeenCalledWith(
        '/api/campaigns/run',
        expect.objectContaining({
          method: 'POST',
          body: { campaignId: 'camp-1' },
        })
      )
    );
  });
});
