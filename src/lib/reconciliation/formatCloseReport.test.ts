import { describe, expect, it } from '@jest/globals';
import { formatCloseReportText } from './formatCloseReport';

describe('formatCloseReportText', () => {
  it('renders naira values and the review summary', () => {
    const text = formatCloseReportText(
      {
        business_date: '2026-07-15',
        expected_revenue_cents: 42_000_000,
        recorded_payments_cents: 38_000_000,
        approved_outstanding_cents: 2_500_000,
        revenue_gap_cents: 1_500_000,
      },
      [
        { item_type: 'unpaid_completed_service' },
        { item_type: 'delivered_unpaid_order' },
      ],
      { openCount: 3, totalAtRiskCents: 9_500_00 }
    );

    expect(text).toContain('₦420,000');
    expect(text).toContain('₦15,000');
    expect(text).toContain('Open anomalies: 3, ₦9,500 at risk');
    expect(text).toMatch(/review/i);
  });
});
