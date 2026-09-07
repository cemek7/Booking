import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { recordMovement } from '@/lib/inventory/recordMovement';
import type { ActionHandler } from './registry';

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function restockExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const quantity = toInteger(params.quantity ?? params.delta);
  const productId = getString(params.product_id);
  const variantId = getString(params.variant_id);
  if ((!productId && !variantId) || quantity === null || quantity <= 0) {
    return { success: false, error: 'restock requires product/variant and a positive quantity' };
  }

  const result = await recordMovement(admin, {
    tenantId,
    productId,
    variantId,
    movementType: 'purchase',
    quantityChange: quantity,
    unitCostCents: toInteger(params.unit_cost_cents),
    reason: getString(params.reason),
    referenceType: 'ai_action',
    referenceId: getString(params.reference_id),
    actorId: ctx.actorId ?? null,
  });

  const rpcError = (result as { error?: { message?: string } | null }).error;
  if (rpcError) return { success: false, error: rpcError.message ?? 'Failed to restock item' };

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.STOCK_RESTOCKED,
    entityType: variantId ? 'product_variant' : 'product',
    entityId: variantId ?? productId,
    source: 'whatsapp',
    metadata: { quantity, unit_cost_cents: toInteger(params.unit_cost_cents) },
  });

  return { success: true, reply: `Restocked ${quantity} units.`, data: { movement: result.data ?? null } };
}

async function recordDamageExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const quantity = toInteger(params.quantity ?? params.delta);
  const productId = getString(params.product_id);
  const variantId = getString(params.variant_id);
  const reason = getString(params.reason);
  if ((!productId && !variantId) || quantity === null || quantity <= 0 || !reason) {
    return { success: false, error: 'record_damage requires product/variant, positive quantity, and reason' };
  }

  const result = await recordMovement(admin, {
    tenantId,
    productId,
    variantId,
    movementType: 'damage',
    quantityChange: -quantity,
    reason,
    referenceType: 'ai_action',
    referenceId: getString(params.reference_id),
    actorId: ctx.actorId ?? null,
  });

  const rpcError = (result as { error?: { message?: string } | null }).error;
  if (rpcError) return { success: false, error: rpcError.message ?? 'Failed to record damage' };

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.STOCK_DAMAGED,
    entityType: variantId ? 'product_variant' : 'product',
    entityId: variantId ?? productId,
    source: 'whatsapp',
    reason,
    metadata: { quantity },
  });

  return { success: true, reply: `Recorded ${quantity} damaged units.`, data: { movement: result.data ?? null } };
}

async function recordStockCountExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const countedQuantity = toInteger(params.counted_quantity);
  const currentQuantity = toInteger(params.current_quantity) ?? 0;
  const productId = getString(params.product_id);
  const variantId = getString(params.variant_id);
  if ((!productId && !variantId) || countedQuantity === null) {
    return { success: false, error: 'record_stock_count requires product/variant and counted_quantity' };
  }

  const delta = countedQuantity - currentQuantity;
  const result = await recordMovement(admin, {
    tenantId,
    productId,
    variantId,
    movementType: 'adjustment',
    quantityChange: delta,
    reason: getString(params.reason) ?? 'stock count adjustment',
    referenceType: 'ai_action',
    referenceId: getString(params.reference_id),
    actorId: ctx.actorId ?? null,
  });

  const rpcError = (result as { error?: { message?: string } | null }).error;
  if (rpcError) return { success: false, error: rpcError.message ?? 'Failed to record stock count' };

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.STOCK_COUNT_RECORDED,
    entityType: variantId ? 'product_variant' : 'product',
    entityId: variantId ?? productId,
    source: 'whatsapp',
    metadata: { counted_quantity: countedQuantity, current_quantity: currentQuantity, delta },
  });

  return { success: true, reply: `Recorded stock count. Adjustment: ${delta > 0 ? '+' : ''}${delta}.`, data: { movement: result.data ?? null } };
}

async function transferStockExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const quantity = toInteger(params.quantity ?? params.delta);
  const productId = getString(params.product_id);
  const variantId = getString(params.variant_id);
  const destination = getString(params.destination);
  if ((!productId && !variantId) || quantity === null || quantity <= 0) {
    return { success: false, error: 'transfer_stock requires product/variant and a positive quantity' };
  }

  const referenceId = getString(params.reference_id);
  const common = {
    tenantId,
    productId,
    variantId,
    reason: getString(params.reason) ?? (destination ? `transfer to ${destination}` : 'stock transfer'),
    referenceType: 'ai_action',
    referenceId,
    actorId: ctx.actorId ?? null,
  };

  const outResult = await recordMovement(admin, {
    ...common,
    movementType: 'transfer_out',
    quantityChange: -quantity,
  });
  const outError = (outResult as { error?: { message?: string } | null }).error;
  if (outError) return { success: false, error: outError.message ?? 'Failed to transfer stock out' };

  const inResult = await recordMovement(admin, {
    ...common,
    movementType: 'transfer_in',
    quantityChange: quantity,
  });
  const inError = (inResult as { error?: { message?: string } | null }).error;
  if (inError) return { success: false, error: inError.message ?? 'Failed to transfer stock in' };

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.STOCK_TRANSFERRED,
    entityType: variantId ? 'product_variant' : 'product',
    entityId: variantId ?? productId,
    source: 'whatsapp',
    metadata: { quantity, destination },
  });

  return {
    success: true,
    reply: destination ? `Transferred ${quantity} units to ${destination}.` : `Transferred ${quantity} units.`,
    data: { outbound: outResult.data ?? null, inbound: inResult.data ?? null },
  };
}

async function inventoryVarianceQueryExecute(admin: SupabaseClient, tenantId: string) {
  const [{ data: products, error: productsError }, { data: movements, error: movementsError }] = await Promise.all([
    admin
      .from('products')
      .select('id, name, stock_quantity')
      .eq('tenant_id', tenantId)
      .eq('track_inventory', true),
    admin
      .from('inventory_movements')
      .select('product_id, quantity_change')
      .eq('tenant_id', tenantId),
  ]);

  if (productsError) return { success: false, error: productsError.message };
  if (movementsError) return { success: false, error: movementsError.message };

  const totals = new Map<string, number>();
  for (const movement of movements ?? []) {
    if (!movement.product_id) continue;
    totals.set(movement.product_id, (totals.get(movement.product_id) ?? 0) + Number(movement.quantity_change ?? 0));
  }

  const items = (products ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    current_stock: Number(product.stock_quantity ?? 0),
    net_recorded_change: totals.get(product.id) ?? 0,
    variance: Number(product.stock_quantity ?? 0) - (totals.get(product.id) ?? 0),
  }));

  const reply = items.length
    ? `Inventory variance snapshot:\n${items
        .slice(0, 8)
        .map((item) => `• ${item.name}: stock ${item.current_stock}, ledger ${item.net_recorded_change}, variance ${item.variance}`)
        .join('\n')}`
    : 'No inventory-tracked products found.';

  return { success: true, reply, data: { items } };
}

export const inventoryHandlers: Record<string, ActionHandler> = {
  restock: {
    action: 'restock',
    capability: 'adjust_stock',
    requiresConfirmation: false,
    async validate(_admin, _tenantId, params) {
      const quantity = toInteger(params.quantity ?? params.delta);
      if (quantity === null || quantity <= 0) {
        return { valid: false, error: 'restock requires a positive quantity' };
      }
      return { valid: true };
    },
    execute: restockExecute,
  },
  record_stock_count: {
    action: 'record_stock_count',
    capability: 'adjust_stock',
    requiresConfirmation: false,
    async validate(_admin, _tenantId, params) {
      if (toInteger(params.counted_quantity) === null) {
        return { valid: false, error: 'record_stock_count requires counted_quantity' };
      }
      return { valid: true };
    },
    execute: recordStockCountExecute,
  },
  record_damage: {
    action: 'record_damage',
    capability: 'adjust_stock',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      const quantity = toInteger(params.quantity ?? params.delta);
      const reason = getString(params.reason);
      if (quantity === null || quantity <= 0 || !reason) {
        return { valid: false, error: 'record_damage requires positive quantity and reason' };
      }
      return { valid: true };
    },
    execute: recordDamageExecute,
  },
  transfer_stock: {
    action: 'transfer_stock',
    capability: 'adjust_stock',
    requiresConfirmation: false,
    async validate(_admin, _tenantId, params) {
      const quantity = toInteger(params.quantity ?? params.delta);
      if (quantity === null || quantity <= 0) {
        return { valid: false, error: 'transfer_stock requires a positive quantity' };
      }
      return { valid: true };
    },
    execute: transferStockExecute,
  },
  inventory_variance_query: {
    action: 'inventory_variance_query',
    requiresConfirmation: false,
    async validate() {
      return { valid: true };
    },
    execute: inventoryVarianceQueryExecute,
  },
};
