import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeVariance, enterCount, startCountSession, approveSession } from './stockCountService';

const mockRecordMovement = jest.fn();
const mockRecordBusinessEvent = jest.fn();

jest.mock('./recordMovement', () => ({
  recordMovement: (...args: unknown[]) => mockRecordMovement(...args),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    STOCK_COUNT_APPROVED: 'stock_count.approved',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

function makeAdmin() {
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{ table: string; payload: unknown }> = [];

  const admin = {
    __inserts: inserts,
    __updates: updates,
    from(table: string) {
      if (table === 'inventory_locations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'loc-main' }, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === 'stock_count_sessions') {
        return {
          insert: (payload: unknown) => {
            inserts.push({ table, payload });
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'session-1', snapshot_at: '2026-07-20T12:00:00.000Z' },
                  error: null,
                }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'session-1',
                  tenant_id: 'tenant-1',
                  location_id: 'loc-main',
                  snapshot_at: '2026-07-20T12:00:00.000Z',
                  status: 'review',
                },
                error: null,
              }),
            }),
          }),
          update: (payload: unknown) => {
            updates.push({ table, payload });
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: 'session-1', ...payload }, error: null }),
                }),
              }),
            };
          },
        };
      }

      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [
                  { id: 'prod-base', cost_price_cents: 200, track_inventory: true },
                  { id: 'prod-var', cost_price_cents: null, track_inventory: true },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'product_variants') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [{ id: 'variant-1', product_id: 'prod-var', is_active: true }],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'inventory_movements') {
        return {
          select: () => ({
            eq: () => ({
              lte: async () => ({
                data: [
                  { product_id: 'prod-base', variant_id: null, quantity_change: 7, location_id: null },
                  { product_id: 'prod-var', variant_id: 'variant-1', quantity_change: 4, location_id: 'loc-main' },
                ],
                error: null,
              }),
              gte: () => ({
                lt: async () => ({
                  data: [{ id: 'mv-live', product_id: 'prod-var', variant_id: 'variant-1', location_id: 'loc-main', movement_type: 'sale' }],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'stock_count_items') {
        return {
          insert: async (payload: unknown) => {
            inserts.push({ table, payload });
            return { error: null };
          },
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'item-1',
                  expected_quantity: 3,
                  counted_quantity: null,
                  unit_cost_cents: 250,
                  flags: {},
                },
                error: null,
              }),
              then: undefined,
            }),
          }),
          update: (payload: unknown) => {
            updates.push({ table, payload });
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: 'item-1', ...payload }, error: null }),
                }),
              }),
            };
          },
          eq: () => ({
            then: undefined,
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };

  return admin as unknown as SupabaseClient & {
    __inserts: Array<{ table: string; payload: unknown }>;
    __updates: Array<{ table: string; payload: unknown }>;
  };
}

describe('stockCountService', () => {
  beforeEach(() => {
    mockRecordMovement.mockReset();
    mockRecordBusinessEvent.mockReset();
  });

  it('startCountSession snapshots expected quantities for base and variant stock and flags missing costs', async () => {
    const admin = makeAdmin();

    const session = await startCountSession(admin, 'tenant-1', null, 'user-1');

    expect(session).toEqual({ id: 'session-1', snapshot_at: '2026-07-20T12:00:00.000Z' });
    expect(admin.__inserts.find((entry) => entry.table === 'stock_count_items')?.payload).toEqual([
      expect.objectContaining({
        product_id: 'prod-base',
        variant_id: null,
        expected_quantity: 7,
        unit_cost_cents: 200,
        flags: {},
      }),
      expect.objectContaining({
        product_id: 'prod-var',
        variant_id: 'variant-1',
        expected_quantity: 4,
        unit_cost_cents: null,
        flags: { cost_unknown: true },
      }),
    ]);
  });

  it('computeVariance flags extreme variance and values loss from unit cost', () => {
    expect(
      computeVariance({
        expectedQuantity: 2,
        countedQuantity: 10,
        unitCostCents: 150,
        flags: {},
      })
    ).toEqual({
      variance: 8,
      varianceValueCents: 1200,
      flags: { extreme_variance: true },
    });
  });

  it('enterCount stores counted quantity, variance and value', async () => {
    const admin = makeAdmin();

    const updated = await enterCount(admin, 'item-1', 1);

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'item-1',
        counted_quantity: 1,
        variance: -2,
        variance_value_cents: -500,
      })
    );
    expect(admin.__updates[0]?.payload).toEqual(
      expect.objectContaining({
        counted_quantity: 1,
        variance: -2,
        variance_value_cents: -500,
      })
    );
  });

  it('approveSession skips moved items, posts clean count adjustments, and emits stock_count.approved', async () => {
    const admin = makeAdmin();
    const originalFrom = admin.from.bind(admin);
    admin.from = ((table: string) => {
      if (table === 'stock_count_items') {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  id: 'item-clean',
                  tenant_id: 'tenant-1',
                  session_id: 'session-1',
                  product_id: 'prod-base',
                  variant_id: null,
                  location_id: 'loc-main',
                  expected_quantity: 7,
                  counted_quantity: 5,
                  variance: -2,
                  unit_cost_cents: 200,
                  variance_value_cents: -400,
                  flags: {},
                },
                {
                  id: 'item-moved',
                  tenant_id: 'tenant-1',
                  session_id: 'session-1',
                  product_id: 'prod-var',
                  variant_id: 'variant-1',
                  location_id: 'loc-main',
                  expected_quantity: 4,
                  counted_quantity: 1,
                  variance: -3,
                  unit_cost_cents: null,
                  variance_value_cents: null,
                  flags: {},
                },
                {
                  id: 'item-uncounted',
                  tenant_id: 'tenant-1',
                  session_id: 'session-1',
                  product_id: 'prod-skip',
                  variant_id: null,
                  location_id: 'loc-main',
                  expected_quantity: 2,
                  counted_quantity: null,
                  variance: null,
                  unit_cost_cents: 150,
                  variance_value_cents: null,
                  flags: {},
                },
              ],
              error: null,
            }),
          }),
          update: (payload: unknown) => {
            admin.__updates.push({ table, payload });
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      return originalFrom(table);
    }) as typeof admin.from;

    const session = await approveSession(admin, 'session-1', 'approver-1');

    expect(mockRecordMovement).toHaveBeenCalledTimes(1);
    expect(mockRecordMovement).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tenantId: 'tenant-1',
        productId: 'prod-base',
        locationId: 'loc-main',
        movementType: 'count_adjustment',
        quantityChange: -2,
        referenceType: 'stock_count_item',
        referenceId: 'item-clean',
      })
    );
    expect(admin.__updates).toContainEqual({
      table: 'stock_count_items',
      payload: expect.objectContaining({
        flags: expect.objectContaining({ moved_during_count: true }),
      }),
    });
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: 'stock_count.approved',
        entityId: 'session-1',
      })
    );
    expect(session).toEqual(expect.objectContaining({ status: 'approved', shrinkage_value_cents: 400 }));
  });
});
