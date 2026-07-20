import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inventoryRules } from './inventory';

function makeAdmin() {
  const responseMap = new Map<string, { data: unknown; error: { message: string } | null }>();

  return {
    __responses: responseMap,
    from: jest.fn((table: string) => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(),
        then: undefined as unknown,
      } as {
        select: jest.Mock;
        eq: jest.Mock;
        gte: jest.Mock;
        lt: jest.Mock;
        maybeSingle: jest.Mock;
        then?: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown;
      };

      state.maybeSingle.mockImplementation(async () => responseMap.get(table) ?? { data: null, error: null });
      state.then = (onfulfilled) =>
        Promise.resolve(onfulfilled(responseMap.get(table) ?? { data: null, error: null }));

      return state;
    }),
  } as unknown as SupabaseClient & { __responses: Map<string, { data: unknown; error: { message: string } | null }> };
}

describe('inventoryRules', () => {
  it('excludes count_adjustment movements from stock_leaving_without_record', async () => {
    const admin = makeAdmin();
    admin.__responses.set('inventory_movements', {
      data: [
        {
          id: 'movement-1',
          product_id: 'product-1',
          movement_type: 'count_adjustment',
          quantity_change: -3,
          previous_quantity: 10,
          new_quantity: 7,
        },
      ],
      error: null,
    });

    const rule = inventoryRules.find((entry) => entry.key === 'stock_leaving_without_record');
    if (!rule) throw new Error('stock_leaving_without_record rule missing');

    const candidates = await rule.detect(admin, 'tenant-1', {
      startUtc: '2026-07-20T00:00:00.000Z',
      endUtc: '2026-07-21T00:00:00.000Z',
    }, { window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' } });

    expect(candidates).toHaveLength(0);
  });

  it('raises stock_shrinkage from stock_count.approved metadata above tenant thresholds', async () => {
    const admin = makeAdmin();
    admin.__responses.set('tenants', {
      data: {
        settings: {
          stock_shrinkage_threshold_units: 1,
          stock_shrinkage_threshold_cents: 500,
        },
      },
      error: null,
    });

    const rule = inventoryRules.find((entry) => entry.key === 'stock_shrinkage');
    if (!rule) throw new Error('stock_shrinkage rule missing');

    const candidates = await rule.detect(
      admin,
      'tenant-1',
      {
        startUtc: '2026-07-20T00:00:00.000Z',
        endUtc: '2026-07-21T00:00:00.000Z',
      },
      {
        window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' },
        eventAction: 'stock_count.approved',
        eventMetadata: {
          session_id: 'session-1',
          items: [
            {
              item_id: 'item-1',
              product_id: 'product-1',
              variance: -3,
              variance_value_cents: -1500,
              unit_cost_cents: 500,
              expected_quantity: 8,
              counted_quantity: 5,
            },
            {
              item_id: 'item-2',
              product_id: 'product-2',
              variance: -1,
              variance_value_cents: -200,
              expected_quantity: 6,
              counted_quantity: 5,
            },
          ],
        },
      }
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        ruleKey: 'stock_shrinkage',
        entityId: 'product-1',
        actualValueCents: 1500,
        differenceCents: 1500,
      })
    );
  });

  it('raises unusual_consumption from service.consumption_recorded above tenant thresholds', async () => {
    const admin = makeAdmin();
    admin.__responses.set('tenants', {
      data: {
        settings: {
          service_consumption_variance_threshold_units: 1,
          service_consumption_variance_threshold_percent: 10,
        },
      },
      error: null,
    });

    const rule = inventoryRules.find((entry) => entry.key === 'unusual_consumption');
    if (!rule) throw new Error('unusual_consumption rule missing');

    const candidates = await rule.detect(
      admin,
      'tenant-1',
      {
        startUtc: '2026-07-20T00:00:00.000Z',
        endUtc: '2026-07-21T00:00:00.000Z',
      },
      {
        window: { startUtc: '2026-07-20T00:00:00.000Z', endUtc: '2026-07-21T00:00:00.000Z' },
        eventAction: 'service.consumption_recorded',
        eventMetadata: {
          reservation_id: 'res-1',
          service_id: 'svc-1',
          product_id: 'product-1',
          planned_quantity: 4,
          actual_quantity: 7,
          variance_quantity: 3,
          uom: 'piece',
          movement_id: 'movement-1',
          unit_cost_cents: 250,
        },
      }
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        ruleKey: 'unusual_consumption',
        entityId: 'product-1',
        actualValueCents: 750,
        differenceCents: 750,
      }),
    );
  });
});
