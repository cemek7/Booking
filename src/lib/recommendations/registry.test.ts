import { describe, expect, it, jest } from '@jest/globals';

const mockRunMetric = jest.fn();

jest.mock('@/lib/analytics/metrics/registry', () => ({
  runMetric: (...args: unknown[]) => mockRunMetric(...args),
}));

import { runGenerators } from './registry';
import { explainRecommendation } from './explain';

function makeAdmin() {
  const inserts: unknown[] = [];
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    admin: {
      from: jest.fn((table: string) => {
        if (table === 'products') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
              Promise.resolve(resolve({
                data: [
                  {
                    id: 'p1',
                    name: 'Relaxer',
                    stock_quantity: 10,
                    low_stock_threshold: 5,
                    price_cents: 2500,
                    cost_price_cents: 800,
                    frequently_bought_together: ['p2', 'p3'],
                    is_active: true,
                    upsell_priority: 1,
                  },
                  {
                    id: 'p2',
                    name: 'Premium Relaxer',
                    stock_quantity: 3,
                    low_stock_threshold: 1,
                    price_cents: 4500,
                    cost_price_cents: 1500,
                    frequently_bought_together: [],
                    is_active: true,
                    upsell_priority: 10,
                  },
                  {
                    id: 'p3',
                    name: 'Hair Oil',
                    stock_quantity: 5,
                    low_stock_threshold: 1,
                    price_cents: 1200,
                    cost_price_cents: 400,
                    frequently_bought_together: [],
                    is_active: true,
                    upsell_priority: 2,
                  },
                ],
                error: null,
              })),
          };
        }

        if (table === 'inventory_movements') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
              Promise.resolve(resolve({
                data: [
                  { product_id: 'p1', quantity_change: -4, created_at: '2026-07-18T10:00:00.000Z' },
                  { product_id: 'p1', quantity_change: -2, created_at: '2026-07-19T10:00:00.000Z' },
                ],
                error: null,
              })),
          };
        }

        if (table === 'customer_profile_summary') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                {
                  customer_id: 'c1',
                  customer_name: 'Ada',
                  days_since_visit: 50,
                  repeat_interval_days: 30,
                  lifetime_value_cents: 400000,
                  outstanding_balance_cents: 25000,
                  risk_score: 'critical',
                },
              ],
              error: null,
            }),
          };
        }

        if (table === 'service_performance_summary') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                { service_id: 's1', bookings: 4, revenue: 80, completion_rate: 0.9 },
              ],
              error: null,
            }),
          };
        }

        if (table === 'services') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                { id: 's1', name: 'Signature Braids', price_cents: 250000, price: null, duration: 120 },
              ],
              error: null,
            }),
          };
        }

        if (table === 'service_consumption_records') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                { service_id: 's1', reservation_id: 'r1', product_id: 'p1', planned_quantity: 1, actual_quantity: 1 },
                { service_id: 's1', reservation_id: 'r2', product_id: 'p2', planned_quantity: 1, actual_quantity: 1 },
                { service_id: 's1', reservation_id: 'r3', product_id: 'p2', planned_quantity: 1, actual_quantity: 1 },
                { service_id: 's1', reservation_id: 'r4', product_id: 'p2', planned_quantity: 1, actual_quantity: 1 },
              ],
              error: null,
            }),
          };
        }

        if (table === 'availability_snapshot') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lt: jest.fn().mockResolvedValue({
              data: [
                { staff_id: 'st1', service_id: 's1', date: tomorrow, available_slots: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'] },
                { staff_id: 'st2', service_id: 's1', date: tomorrow, available_slots: [] },
              ],
              error: null,
            }),
          };
        }

        if (table === 'staff_performance_summary') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                { staff_id: 'st2', bookings: 12, completion_rate: 0.92, estimated_revenue: 200 },
              ],
              error: null,
            }),
          };
        }

        if (table === 'tenant_users') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                { id: 'st1', name: 'Amina', full_name: 'Amina' },
                { id: 'st2', name: 'Tunde', full_name: 'Tunde' },
              ],
              error: null,
            }),
          };
        }

        if (table === 'business_recommendations') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn((payload: unknown) => {
              inserts.push(payload);
              return Promise.resolve({ data: null, error: null });
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    } as never,
    inserts,
  };
}

describe('runGenerators', () => {
  it('creates stockout and reorder recommendations from inventory movement velocity', async () => {
    mockRunMetric.mockReset();
    mockRunMetric.mockResolvedValueOnce({ result: { rows: [] } });

    const { admin } = makeAdmin();
    const drafts = await runGenerators(admin, 'tenant-1');

    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'likely_stockout',
          entityType: 'product',
          entityId: 'p1',
          basis: expect.objectContaining({
            avg_daily_usage: 3,
            current_stock: 10,
            days_left: 3.3,
          }),
        }),
        expect.objectContaining({
          type: 'reorder_qty',
          entityType: 'product',
          entityId: 'p1',
          basis: expect.objectContaining({
            suggested_reorder_quantity: 95,
          }),
        }),
      ]),
    );
  });

  it('omits estimated impact when it cannot be grounded and persists deduped drafts', async () => {
    mockRunMetric.mockReset();
    mockRunMetric.mockResolvedValueOnce({
      result: {
        rows: [{ product_id: 'p2', product_name: 'Hair Oil', stock_value: 0 }],
      },
    });

    const { admin, inserts } = makeAdmin();
    const drafts = await runGenerators(admin, 'tenant-1');

    const reactivation = drafts.find((draft) => draft.type === 'reactivation');
    expect(reactivation?.estimatedImpact).toBeUndefined();
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reactivation',
          entity_type: 'customer',
          entity_id: 'c1',
        }),
      ]),
    );
  });

  it('adds service, staff, sales, and churn recommendations from grounded summaries', async () => {
    mockRunMetric.mockReset();
    mockRunMetric.mockResolvedValueOnce({ result: { rows: [] } });

    const { admin } = makeAdmin();
    const drafts = await runGenerators(admin, 'tenant-1');

    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'churn_risk', entityType: 'customer', entityId: 'c1' }),
        expect.objectContaining({ type: 'poor_margin_service', entityType: 'service', entityId: 's1' }),
        expect.objectContaining({ type: 'underbooked_slot', entityType: 'service' }),
        expect.objectContaining({ type: 'overbooked_staff', entityType: 'staff', entityId: 'st2' }),
        expect.objectContaining({ type: 'bundle', entityType: 'product', entityId: 'p1' }),
        expect.objectContaining({ type: 'upsell', entityType: 'product', entityId: 'p1' }),
        expect.objectContaining({ type: 'cross_sell', entityType: 'product' }),
      ]),
    );

    const poorMargin = drafts.find((draft) => draft.type === 'poor_margin_service');
    expect(poorMargin?.reason).toContain('₦');

    const upsell = drafts.find((draft) => draft.type === 'upsell');
    expect(upsell?.title).toContain('Premium Relaxer');
  });
});

describe('explainRecommendation integration', () => {
  it('keeps generated recommendation prose grounded in numeric basis values', () => {
    const explanation = explainRecommendation('underbooked_slot', {
      service_name: 'Signature Braids',
      date: '2099-01-01',
      available_slots: 6,
      baseline_bookings: 4,
    });

    expect(explanation.reason).toContain('6');
    expect(explanation.reason).toContain('4');
    expect(explanation.title).toContain('Signature Braids');
  });
});
