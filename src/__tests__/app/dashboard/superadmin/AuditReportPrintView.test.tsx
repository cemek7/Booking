import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import AuditReportPrintView from '@/app/dashboard/superadmin/booka-revenue-requests/AuditReportPrintView';

const summary = {
  enquiries_reviewed: 50,
  unanswered_or_delayed: 8,
  missing_next_step: 10,
  availability_dead_ends: 3,
  missing_follow_ups: 12,
  missed_recommendations: 7,
  opportunity_low_ngn: 100000,
  opportunity_high_ngn: 250000,
  assumptions: [
    'Average transaction value supplied by the applicant.',
    'Only visible outcomes in the consented sample were counted.',
  ],
};

describe('AuditReportPrintView', () => {
  it('renders a privacy-safe, printable missed revenue report', () => {
    window.print = jest.fn();
    render(
      <AuditReportPrintView
        businessName="Ada Beauty Studio"
        createdAt="2026-08-29T10:00:00.000Z"
        summary={summary}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Ada Beauty Studio' })).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('₦100,000–₦250,000')).toBeInTheDocument();
    for (const assumption of summary.assumptions) {
      expect(screen.getByText(assumption)).toBeInTheDocument();
    }
    expect(screen.getByText(/opportunity estimate, not a revenue guarantee/i)).toBeInTheDocument();
    expect(screen.queryByText(/customer message content/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /print or save as pdf/i }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
