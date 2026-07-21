import { describe, expect, it, jest } from '@jest/globals';

const mockRunMetric = jest.fn();

jest.mock('@/lib/analytics/metrics/registry', () => ({
  runMetric: (...args: unknown[]) => mockRunMetric(...args),
}));

import { runGenerators } from './registry';

function makeAdmin() {
  const inserts: unknown[] = [];
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
                },
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
});
