import type { SupabaseClient } from '@supabase/supabase-js';

import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { recordMovement } from './recordMovement';
import { convert, type InventoryUom } from './uom';

type ReservationRow = {
  id: string;
  service_id?: string | null;
  staff_id?: string | null;
  tenant_staff_id?: string | null;
  location_id?: string | null;
};

type ReservationServiceLine = {
  service_id: string;
  quantity?: number | null;
};

type RecipeItemRow = {
  product_id: string;
  variant_id?: string | null;
  default_quantity: number;
  uom: InventoryUom;
  is_optional?: boolean | null;
};

type RecipeRow = {
  id: string;
  service_id: string;
  is_active: boolean;
  service_material_recipe_items?: RecipeItemRow[] | null;
};

type ProductRow = {
  id: string;
  base_uom: InventoryUom | null;
  pack_size?: number | null;
  cost_price_cents?: number | null;
};

type LocationRow = {
  id: string;
};

type MovementResult = {
  movement_id?: string | null;
};

function getMovementId(data: unknown): string | null {
  if (Array.isArray(data) && data.length > 0) {
    const row = data[0] as MovementResult;
    return typeof row?.movement_id === 'string' ? row.movement_id : null;
  }

  if (data && typeof data === 'object') {
    const row = data as MovementResult;
    return typeof row.movement_id === 'string' ? row.movement_id : null;
  }

  return null;
}

function normalizeServiceLines(lines: ReservationServiceLine[], fallbackServiceId?: string | null) {
  if (lines.length > 0) {
    return lines.map((line) => ({
      serviceId: line.service_id,
      quantity: Math.max(1, Number(line.quantity ?? 1)),
    }));
  }

  if (fallbackServiceId) {
    return [{ serviceId: fallbackServiceId, quantity: 1 }];
  }

  return [];
}

export async function consumeForReservation(
  admin: SupabaseClient,
  tenantId: string,
  reservationId: string,
  actorId: string | null,
): Promise<void> {
  const { data: reservation, error: reservationError } = await admin
    .from('reservations')
    .select('id, service_id, staff_id, tenant_staff_id, location_id')
    .eq('tenant_id', tenantId)
    .eq('id', reservationId)
    .maybeSingle<ReservationRow>();

  if (reservationError) throw reservationError;
  if (!reservation) throw new Error(`Reservation ${reservationId} not found`);

  const { data: lines, error: linesError } = await admin
    .from('reservation_services')
    .select('service_id, quantity')
    .eq('tenant_id', tenantId)
    .eq('reservation_id', reservationId);

  if (linesError) throw linesError;

  const normalizedLines = normalizeServiceLines((lines ?? []) as ReservationServiceLine[], reservation.service_id ?? null);
  if (normalizedLines.length === 0) return;

  const serviceIds = [...new Set(normalizedLines.map((line) => line.serviceId))];
  const { data: recipes, error: recipesError } = await admin
    .from('service_material_recipes')
    .select('id, service_id, is_active, service_material_recipe_items(product_id, variant_id, default_quantity, uom, is_optional)')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .in('service_id', serviceIds);

  if (recipesError) throw recipesError;

  const recipeMap = new Map(
    ((recipes ?? []) as RecipeRow[]).map((recipe) => [recipe.service_id, recipe]),
  );

  const recipeItems = (recipes ?? [])
    .flatMap((recipe) => (recipe as RecipeRow).service_material_recipe_items ?? []);
  if (recipeItems.length === 0) return;

  const productIds = [...new Set(recipeItems.map((item) => item.product_id))];
  const { data: products, error: productsError } = await admin
    .from('products')
    .select('id, base_uom, pack_size, cost_price_cents')
    .eq('tenant_id', tenantId)
    .in('id', productIds);

  if (productsError) throw productsError;

  const productMap = new Map(
    ((products ?? []) as ProductRow[]).map((product) => [product.id, product]),
  );

  let locationId = reservation.location_id ?? null;
  if (!locationId) {
    const { data: defaultLocation, error: locationError } = await admin
      .from('inventory_locations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .maybeSingle<LocationRow>();

    if (locationError) throw locationError;
    locationId = defaultLocation?.id ?? null;
  }

  const staffId = reservation.tenant_staff_id ?? reservation.staff_id ?? null;
  const consumptionRows: Array<Record<string, unknown>> = [];

  for (const line of normalizedLines) {
    const recipe = recipeMap.get(line.serviceId);
    if (!recipe?.service_material_recipe_items?.length) continue;

    for (const item of recipe.service_material_recipe_items) {
      const product = productMap.get(item.product_id);
      if (!product?.base_uom) {
        throw new Error(`Recipe product ${item.product_id} is missing base_uom`);
      }

      const plannedQuantity = Number(item.default_quantity) * line.quantity;
      const converted = convert(plannedQuantity, item.uom, product.base_uom, product.pack_size);
      if (!Number.isInteger(converted)) {
        throw new Error(
          `Recipe for product ${item.product_id} converts to fractional ${product.base_uom}; integer stock movements are required`,
        );
      }

      const movement = await recordMovement(admin, {
        tenantId,
        productId: item.product_id,
        variantId: item.variant_id ?? null,
        locationId,
        movementType: 'service_consumption',
        quantityChange: -Math.abs(converted),
        unitCostCents: product.cost_price_cents ?? null,
        reason: `Service consumption for reservation ${reservationId}`,
        referenceType: 'reservation',
        referenceId: reservationId,
        actorId,
      });

      if (movement.error) throw movement.error;

      consumptionRows.push({
        tenant_id: tenantId,
        reservation_id: reservationId,
        service_id: line.serviceId,
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        planned_quantity: plannedQuantity,
        actual_quantity: plannedQuantity,
        uom: item.uom,
        staff_id: staffId,
        movement_id: getMovementId(movement.data),
      });
    }
  }

  if (consumptionRows.length === 0) return;

  const { error: insertError } = await admin
    .from('service_consumption_records')
    .insert(consumptionRows);

  if (insertError) throw insertError;

  for (const row of consumptionRows) {
    const plannedQuantity = Number(row.planned_quantity ?? 0);
    const actualQuantity = Number(row.actual_quantity ?? plannedQuantity);

    await recordBusinessEvent(admin, {
      tenantId,
      actorType: actorId ? 'user' : 'system',
      actorId,
      action: BUSINESS_EVENT_ACTIONS.SERVICE_CONSUMPTION_RECORDED,
      entityType: 'reservation',
      entityId: reservationId,
      source: 'api',
      metadata: {
        reservation_id: reservationId,
        service_id: row.service_id ?? null,
        product_id: row.product_id ?? null,
        variant_id: row.variant_id ?? null,
        staff_id: row.staff_id ?? null,
        planned_quantity: plannedQuantity,
        actual_quantity: actualQuantity,
        variance_quantity: actualQuantity - plannedQuantity,
        uom: row.uom ?? null,
        movement_id: row.movement_id ?? null,
        unit_cost_cents: productMap.get(String(row.product_id))?.cost_price_cents ?? null,
      },
    });
  }
}
