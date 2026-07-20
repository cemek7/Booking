import type { SupabaseClient } from '@supabase/supabase-js';

export interface RecordMovementInput {
  tenantId: string;
  productId?: string | null;
  variantId?: string | null;
  movementType:
    | 'sale'
    | 'damage'
    | 'adjustment'
    | 'purchase'
    | 'return'
    | 'refund_restock'
    | 'transfer_in'
    | 'transfer_out'
    | 'count_adjustment'
    | 'service_consumption'
    | 'expiry'
    | 'manual_adjustment';
  quantityChange: number;
  unitCostCents?: number | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  actorId?: string | null;
}

export async function recordMovement(admin: SupabaseClient, input: RecordMovementInput) {
  return admin.rpc('update_inventory', {
    p_tenant_id: input.tenantId,
    p_product_id: input.productId ?? null,
    p_variant_id: input.variantId ?? null,
    p_quantity_change: input.quantityChange,
    p_movement_type: input.movementType,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_reason: input.reason ?? null,
    p_performed_by: input.actorId ?? null,
    p_unit_cost_cents: input.unitCostCents ?? null,
  });
}
