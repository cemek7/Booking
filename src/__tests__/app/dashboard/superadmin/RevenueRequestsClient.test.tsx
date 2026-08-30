import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPatch = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();

jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...args: unknown[]) => authGet(...(args as [string])),
  authPatch: (...args: unknown[]) => authPatch(...(args as [string, unknown])),
}));

import RevenueRequestsClient from '@/app/dashboard/superadmin/booka-revenue-requests/RevenueRequestsClient';

const auditSummary = {
  enquiries_reviewed: 50,
  unanswered_or_delayed: 8,
  missing_next_step: 10,
  availability_dead_ends: 3,
  missing_follow_ups: 12,
  missed_recommendations: 7,
  opportunity_low_ngn: 100000,
  opportunity_high_ngn: 250000,
  assumptions: ['Average transaction value supplied by the applicant.'],
};

const pilotRequest = {
  id: 'req_1',
  request_type: 'revenue_pilot',
  business_name: 'Ada Beauty Studio',
  contact_name: 'Ada Okafor',
  email: 'ada@example.com',
  phone: '+2348000000000',
  vertical: 'beauty',
  weekly_enquiry_band: '50_99',
  channels: ['whatsapp', 'instagram'],
  average_transaction_value_ngn: 25000,
  consent_to_contact: true,
  sample_review_consent: false,
  status: 'new',
  qualification_note: '',
  audit_summary: {},
  created_at: '2026-08-29T10:00:00.000Z',
};

describe('RevenueRequestsClient', () => {
  beforeEach(() => {
    authGet.mockReset();
    authPatch.mockReset();
    authGet.mockResolvedValue({ status: 200, data: { data: [pilotRequest], total: 1 } });
    authPatch.mockResolvedValue({ status: 200, data: { data: pilotRequest } });
  });

  it('applies request type and status filters', async () => {
    render(<RevenueRequestsClient />);
    expect(await screen.findByRole('heading', { name: 'Ada Beauty Studio', level: 2 })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Request type filter'), {
      target: { value: 'missed_revenue_report' },
    });
    fireEvent.change(screen.getByLabelText('Status filter'), {
      target: { value: 'qualified' },
    });

    await waitFor(() => expect(authGet).toHaveBeenLastCalledWith(
      '/api/superadmin/booka-revenue-requests?request_type=missed_revenue_report&status=qualified',
    ));
  });

  it('saves qualification notes and a status transition', async () => {
    render(<RevenueRequestsClient />);
    expect(await screen.findByRole('heading', { name: 'Ada Beauty Studio', level: 2 })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status for Ada Beauty Studio'), {
      target: { value: 'qualified' },
    });
    fireEvent.change(screen.getByLabelText('Qualification note for Ada Beauty Studio'), {
      target: { value: 'Strong weekly volume and a clear escalation contact.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Ada Beauty Studio request' }));

    await waitFor(() => expect(authPatch).toHaveBeenCalledWith(
      '/api/superadmin/booka-revenue-requests/req_1',
      {
        status: 'qualified',
        qualification_note: 'Strong weekly volume and a clear escalation contact.',
      },
    ));
  });

  it('saves an audit summary for a missed revenue request', async () => {
    const reportRequest = {
      ...pilotRequest,
      id: 'req_2',
      request_type: 'missed_revenue_report',
      status: 'audit_in_progress',
      sample_review_consent: true,
      audit_summary: auditSummary,
    };
    authGet.mockResolvedValue({ status: 200, data: { data: [reportRequest], total: 1 } });
    render(<RevenueRequestsClient />);
    expect(await screen.findByRole('heading', { name: 'Ada Beauty Studio', level: 2 })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Opportunity low for Ada Beauty Studio'), {
      target: { value: '120000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Ada Beauty Studio audit report' }));

    await waitFor(() => expect(authPatch).toHaveBeenCalledWith(
      '/api/superadmin/booka-revenue-requests/req_2',
      {
        audit_summary: expect.objectContaining({
          opportunity_low_ngn: 120000,
          opportunity_high_ngn: 250000,
          assumptions: auditSummary.assumptions,
        }),
      },
    ));
  });

  it('renders an empty state', async () => {
    authGet.mockResolvedValue({ status: 200, data: { data: [], total: 0 } });
    render(<RevenueRequestsClient />);

    expect(await screen.findByText(/no revenue requests match these filters/i)).toBeInTheDocument();
  });
});
