import type { SupabaseClient } from '@supabase/supabase-js';

type InventoryLocationRow = {
  id: string;
};

type MovementRow = {
  product_id?: string | null;
  variant_id?: string | null;
  quantity_change?: number | null;
  location_id?: string | null;
  created_at?: string | null;
};

function toStockKey(productId: string, variantId: string | null): string {
  return `${productId}|${variantId ?? 'base'}`;
}

export async function expectedAt(
  admin: SupabaseClient,
  tenantId: string,
  snapshotAt: string,
  locationId: string | null
): Promise<Map<string, number>> {
  const { data: defaultLocation, error: defaultLocationError } = await admin
    .from('inventory_locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .maybeSingle<InventoryLocationRow>();

  if (defaultLocationError) throw defaultLocationError;

  const targetLocationId = locationId ?? defaultLocation?.id ?? null;

  const { data: movements, error: movementError } = await admin
    .from('inventory_movements')
    .select('product_id, variant_id, quantity_change, location_id')
    .eq('tenant_id', tenantId)
    .lte('created_at', snapshotAt);

  if (movementError) throw movementError;

  const totals = new Map<string, number>();
  for (const movement of (movements ?? []) as MovementRow[]) {
    const productId = typeof movement.product_id === 'string' ? movement.product_id : null;
    if (!productId) continue;
    if (movement.created_at && movement.created_at > snapshotAt) continue;

    const effectiveLocationId = movement.location_id ?? defaultLocation?.id ?? null;
    if (effectiveLocationId !== targetLocationId) continue;

    const key = toStockKey(productId, typeof movement.variant_id === 'string' ? movement.variant_id : null);
    totals.set(key, (totals.get(key) ?? 0) + Number(movement.quantity_change ?? 0));
  }

  return totals;
}
