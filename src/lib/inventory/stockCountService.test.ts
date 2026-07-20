import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeVariance, enterCount, startCountSession } from './stockCountService';

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
});
