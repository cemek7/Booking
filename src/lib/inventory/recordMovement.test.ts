import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordMovement } from './recordMovement';

describe('recordMovement', () => {
  it('calls update_inventory with signed quantity change and unit cost', async () => {
    const rpc = jest.fn(async () => ({ data: [], error: null }));
    const admin = { rpc } as unknown as SupabaseClient;

    await recordMovement(admin, {
      tenantId: 'tenant-1',
      productId: 'product-1',
      movementType: 'refund_restock',
      quantityChange: -3,
      unitCostCents: 950,
      reason: 'damaged return',
      referenceType: 'retail_order',
      referenceId: 'order-1',
      actorId: 'user-1',
    });

    expect(rpc).toHaveBeenCalledWith('update_inventory', {
      p_tenant_id: 'tenant-1',
      p_product_id: 'product-1',
      p_variant_id: null,
      p_quantity_change: -3,
      p_movement_type: 'refund_restock',
      p_reference_type: 'retail_order',
      p_reference_id: 'order-1',
      p_reason: 'damaged return',
      p_performed_by: 'user-1',
      p_unit_cost_cents: 950,
    });
  });
});
