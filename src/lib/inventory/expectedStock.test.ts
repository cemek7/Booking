import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expectedAt } from './expectedStock';

function makeAdmin() {
  return {
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

      if (table === 'inventory_movements') {
        return {
          select: () => ({
            eq: () => ({
              lte: async () => ({
                data: [
                  { product_id: 'prod-1', variant_id: null, quantity_change: 10, location_id: null },
                  { product_id: 'prod-1', variant_id: null, quantity_change: -3, location_id: 'loc-main' },
                  { product_id: 'prod-1', variant_id: null, quantity_change: 5, location_id: 'loc-other' },
                  { product_id: 'prod-1', variant_id: null, quantity_change: 20, location_id: 'loc-main', created_at: '2026-07-20T14:00:00.000Z' },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe('expectedAt', () => {
  it('derives expected stock at snapshot and treats null-location movements as default-location stock', async () => {
    const totals = await expectedAt(
      makeAdmin(),
      'tenant-1',
      '2026-07-20T12:00:00.000Z',
      'loc-main'
    );

    expect(totals.get('prod-1|base')).toBe(7);
    expect(totals.has('prod-1|base')).toBe(true);
  });
});
