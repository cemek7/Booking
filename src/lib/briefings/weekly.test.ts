import { describe, expect, it, jest } from '@jest/globals';

const mockRunMetric = jest.fn();

jest.mock('@/lib/analytics/metrics/registry', () => ({
  runMetric: (...args: unknown[]) => mockRunMetric(...args),
}));

import { buildWeeklyBriefing } from './weekly';

function makeAdmin() {
  return {
    from: jest.fn((table: string) => {
      if (table === 'tenants') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { name: 'Glow Salon', timezone: 'Africa/Lagos' },
            error: null,
          }),
        };
      }
      if (table === 'insights_daily') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lt: jest.fn().mockResolvedValue({
            data: [
              { total_bookings: 12, completed: 10, cancelled: 1, no_shows: 1, revenue: 2200 },
            ],
            error: null,
          }),
        };
      }
      if (table === 'tenant_revenue_ledger') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lt: jest.fn().mockResolvedValue({
            data: [{ amount: 2200 }],
            error: null,
          }),
        };
      }
      if (table === 'tenant_cost_ledger') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lt: jest.fn().mockResolvedValue({
            data: [{ amount: 1100 }],
            error: null,
          }),
        };
      }
      if (table === 'business_anomalies') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lt: jest.fn().mockResolvedValue({
            data: [{ rule_key: 'stock_shrinkage', difference_cents: 25000 }],
            error: null,
          }),
        };
      }
      if (table === 'business_recommendations') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              {
                id: 'rec-1',
                title: 'Reactivate Ada',
                recommended_action: 'Send a comeback offer to Ada now.',
                confidence: 0.92,
              },
            ],
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as never;
}

describe('buildWeeklyBriefing', () => {
  it('builds a weekly summary with recommendations and comparisons', async () => {
    mockRunMetric.mockReset();
    mockRunMetric
      .mockResolvedValueOnce({ result: { rows: [{ product_name: 'Relaxer', quantity: 5 }] } })
      .mockResolvedValueOnce({ result: { rows: [{ service_name: 'Braids', revenue: 2200 }] } })
      .mockResolvedValueOnce({ result: { rows: [{ customer_name: 'Ada', lifetime_value: 5000 }] } })
      .mockResolvedValueOnce({ result: { rows: [{ staff_name: 'Amaka', revenue: 1800 }] } })
      .mockResolvedValueOnce({ result: { rows: [{ product_name: 'Hair Oil' }] } })
      .mockResolvedValueOnce({ result: { summary: { total_outstanding: 3200 } } })
      .mockResolvedValueOnce({ result: { summary: { total_amount: 2200 } } })
      .mockResolvedValueOnce({ result: { summary: { total_amount: 1700 } } });

    const payload = await buildWeeklyBriefing(makeAdmin(), 'tenant-1', new Date('2026-07-21T10:00:00.000Z'));

    expect(payload?.body).toContain('Weekly Briefing');
    expect(payload?.body).toContain('Revenue: ₦2,200');
    expect(payload?.body).toContain('Gross margin: 50.0%');
    expect(payload?.body).toContain('Top product: Relaxer');
    expect(payload?.body).toContain('Top service: Braids');
    expect(payload?.body).toContain('Top customer: Ada');
    expect(payload?.body).toContain('Top staff: Amaka');
    expect(payload?.body).toContain('Recommended actions:');
    expect(payload?.body).toContain('Reactivate Ada');
    expect(payload?.meta).toEqual(expect.objectContaining({
      revenue: 2200,
      prior_revenue: 1700,
      dead_stock_count: 1,
      outstanding_amount: 3200,
    }));
  });
});
