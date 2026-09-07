import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ApiResponse } from '@/lib/auth/auth-api-client';
import type { RevenueFrontDeskReport as RevenueFrontDeskReportData } from '@/lib/analytics/revenue-front-desk-report';

type ReportFetch = (url: string) => Promise<ApiResponse<RevenueFrontDeskReportData>>;
const mockAuthFetch = jest.fn<ReportFetch>();
jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: (url: string) => mockAuthFetch(url),
}));

import RevenueFrontDeskReport from '@/components/reports/RevenueFrontDeskReport';

const report: RevenueFrontDeskReportData = {
  period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-15T00:00:00.000Z' },
  currency: 'NGN',
  funnel: {
    enquiries: 63,
    qualified: 47,
    bookings: 31,
    sales: 7,
    deposits_or_payments: 28,
    followups_sent: 19,
    recovered_opportunities: 6,
    escalations: 4,
  },
  revenue: {
    processed_cents: 68400000,
    influenced_cents: 21200000,
    recovered_cents: 9400000,
  },
  handling: { automated: 51, human: 8, unresolved: 4 },
  completeness: {
    unverified_attributions: 3,
    missing_amount_events: 2,
    offline_confirmation_required: true,
  },
};

describe('RevenueFrontDeskReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetch.mockResolvedValue({ data: report, status: 200 });
  });

  it('renders processed, influenced, and recovered money separately', async () => {
    render(<RevenueFrontDeskReport />);

    expect(await screen.findByText('Processed revenue')).toBeInTheDocument();
    expect(screen.getByText('Influenced revenue')).toBeInTheDocument();
    expect(screen.getByText('Recovered revenue')).toBeInTheDocument();
    expect(screen.getByText('₦684,000.00')).toBeInTheDocument();
    expect(screen.getByText('₦212,000.00')).toBeInTheDocument();
    expect(screen.getByText('₦94,000.00')).toBeInTheDocument();
    expect(screen.queryByText(/generated\s+revenue/i)).not.toBeInTheDocument();
  });

  it('shows the funnel and verification warning', async () => {
    render(<RevenueFrontDeskReport />);

    expect(await screen.findByText('Enquiry')).toBeInTheDocument();
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(screen.getByText('Booking / sale')).toBeInTheDocument();
    expect(screen.getByText('Payment')).toBeInTheDocument();
    expect(screen.getByText(/3 attribution records still need verification/i)).toBeInTheDocument();
    expect(screen.getByText(/2 outcome records are missing an explicit amount or currency/i)).toBeInTheDocument();
  });

  it('renders a loading state', () => {
    mockAuthFetch.mockReturnValue(new Promise(() => undefined));
    render(<RevenueFrontDeskReport />);

    expect(screen.getByText(/building the revenue report/i)).toBeInTheDocument();
  });

  it('renders an error state', async () => {
    mockAuthFetch.mockResolvedValue({
      status: 500,
      error: { message: 'The report could not be loaded', status: 500, statusText: 'Error' },
    });
    render(<RevenueFrontDeskReport />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The report could not be loaded');
  });

  it('renders an honest empty state', async () => {
    mockAuthFetch.mockResolvedValue({
      status: 200,
      data: {
        ...report,
        funnel: {
          enquiries: 0,
          qualified: 0,
          bookings: 0,
          sales: 0,
          deposits_or_payments: 0,
          followups_sent: 0,
          recovered_opportunities: 0,
          escalations: 0,
        },
        revenue: { processed_cents: 0, influenced_cents: 0, recovered_cents: 0 },
        handling: { automated: 0, human: 0, unresolved: 0 },
        completeness: {
          unverified_attributions: 0,
          missing_amount_events: 0,
          offline_confirmation_required: false,
        },
      },
    });
    render(<RevenueFrontDeskReport />);

    expect(await screen.findByText(/no Booka outcomes were recorded for this period/i)).toBeInTheDocument();
  });
});
