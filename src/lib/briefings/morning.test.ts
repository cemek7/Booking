import { describe, expect, it, jest } from '@jest/globals';

const mockRunMetric = jest.fn();
const mockGetAnomalySummary = jest.fn();

jest.mock('@/lib/analytics/metrics/registry', () => ({
  runMetric: (...args: unknown[]) => mockRunMetric(...args),
}));

jest.mock('@/lib/anomalies/notify', () => ({
  getAnomalySummary: (...args: unknown[]) => mockGetAnomalySummary(...args),
}));

import { buildMorningBriefing } from './morning';

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
      if (table === 'reservations') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lt: jest.fn().mockResolvedValue({
            data: [
              { id: 'r1', status: 'confirmed', confirmed_at: '2026-07-21T08:00:00.000Z' },
              { id: 'r2', status: 'pending', confirmed_at: null },
            ],
            error: null,
          }),
        };
      }
      if (table === 'retail_orders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [
              { id: 'o1', status: 'pending_payment', fulfillment_status: 'preparing' },
            ],
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as never;
}

describe('buildMorningBriefing', () => {
  it('builds a morning summary when there is meaningful work to report', async () => {
    mockRunMetric.mockReset();
    mockGetAnomalySummary.mockReset();
    mockRunMetric
      .mockResolvedValueOnce({ result: { rows: [{ product_name: 'Relaxer' }] } })
      .mockResolvedValueOnce({ result: { summary: { total_outstanding: 4500 } } });
    mockGetAnomalySummary.mockResolvedValue({
      openCount: 2,
      totalAtRiskCents: 120000,
      highSeverityCount: 1,
      criticalSeverityCount: 0,
    });

    const payload = await buildMorningBriefing(makeAdmin(), 'tenant-1', new Date('2026-07-21T07:00:00.000Z'));

    expect(payload?.body).toContain('Morning Briefing');
    expect(payload?.body).toContain('Today’s appointments: 2');
    expect(payload?.body).toContain('Unconfirmed bookings: 1');
    expect(payload?.body).toContain('Pending orders: 1');
    expect(payload?.body).toContain('Low-stock products: 1');
    expect(payload?.body).toContain('Outstanding balances: ₦4,500');
    expect(payload?.meta).toEqual(expect.objectContaining({
      appointment_count: 2,
      unconfirmed_count: 1,
      pending_orders: 1,
    }));
  });
});
