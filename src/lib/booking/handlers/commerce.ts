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

async function addProductExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const name = getString(params.name);
  const priceCents = toInteger(params.price_cents ?? params.price);

  if (!name || priceCents === null) {
    return { success: false, error: 'add_product requires name and price_cents' };
  }

  const { data, error } = await admin
    .from('products')
    .insert({
      tenant_id: tenantId,
      name,
      price_cents: priceCents,
      is_active: true,
      track_inventory: Boolean(params.track_inventory),
      stock_quantity: toInteger(params.stock_quantity) ?? 0,
      low_stock_threshold: toInteger(params.low_stock_threshold) ?? 0,
      currency: getString(params.currency) ?? 'NGN',
      category: getString(params.category),
    })
    .select('id, name, price_cents, stock_quantity')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create product' };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.PRODUCT_ADDED,
    entityType: 'product',
    entityId: String(data.id),
    source: 'whatsapp',
    after: data,
    metadata: { price_cents: data.price_cents, stock_quantity: data.stock_quantity },
  });

  return {
    success: true,
    reply: `Added ${data.name} at ₦${Math.round(Number(data.price_cents ?? 0) / 100).toLocaleString()}.`,
    data: { product: data },
  };
}

async function adjustStockExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const productId = getString(params.product_id);
  const variantId = getString(params.variant_id);
  const delta = toInteger(params.delta);

  if ((!productId && !variantId) || delta === null || delta === 0) {
    return { success: false, error: 'adjust_stock requires product or variant and a non-zero delta' };
  }

  const result = await recordMovement(admin, {
    tenantId,
    productId,
    variantId,
    movementType: 'adjustment',
    quantityChange: delta,
    unitCostCents: toInteger(params.unit_cost_cents),
    reason: getString(params.reason),
    referenceType: 'ai_action',
    referenceId: getString(params.reference_id),
    actorId: ctx.actorId ?? null,
  });

  const rpcError = (result as { error?: { message?: string } | null }).error;
  if (rpcError) {
    return { success: false, error: rpcError.message ?? 'Failed to adjust stock' };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.PRODUCT_STOCK_ADJUSTED,
    entityType: variantId ? 'product_variant' : 'product',
    entityId: variantId ?? productId ?? null,
    source: 'whatsapp',
    metadata: { delta, reason: getString(params.reason) },
  });

  return {
    success: true,
    reply: `Stock adjusted by ${delta > 0 ? '+' : ''}${delta}.`,
    data: { movement: result.data ?? null },
  };
}

async function setPriceExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const productId = getString(params.product_id);
  const priceCents = toInteger(params.price_cents ?? params.price);

  if (!productId || priceCents === null) {
    return { success: false, error: 'set_price requires product_id and price_cents' };
  }

  const { data: before } = await admin
    .from('products')
    .select('id, name, price_cents')
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .maybeSingle();

  const { data: updated, error } = await admin
    .from('products')
    .update({ price_cents: priceCents, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .select('id, name, price_cents')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message ?? 'Failed to set price' };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.PRODUCT_PRICE_CHANGED,
    entityType: 'product',
    entityId: productId,
    source: 'whatsapp',
    before: before ?? null,
    after: updated,
    metadata: {
      previous_price_cents: before?.price_cents ?? null,
      next_price_cents: updated.price_cents,
    },
  });

  return {
    success: true,
    reply: `Updated ${updated.name} to ₦${Math.round(Number(updated.price_cents ?? 0) / 100).toLocaleString()}.`,
    data: { product: updated },
  };
}

async function setAvailabilityExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: { actorId?: string | null }
) {
  const productId = getString(params.product_id);
  const isActive = typeof params.is_active === 'boolean' ? params.is_active : Boolean(params.available);

  if (!productId) {
    return { success: false, error: 'set_availability requires product_id' };
  }

  const { data: updated, error } = await admin
    .from('products')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .select('id, name, is_active')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message ?? 'Failed to update availability' };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.PRODUCT_AVAILABILITY_CHANGED,
    entityType: 'product',
    entityId: productId,
    source: 'whatsapp',
    after: updated,
    metadata: { is_active: updated.is_active },
  });

  return {
    success: true,
    reply: `${updated.name} is now ${updated.is_active ? 'available' : 'hidden'}.`,
    data: { product: updated },
  };
}

async function lowStockQueryExecute(
  admin: SupabaseClient,
  tenantId: string
) {
  const { data, error } = await admin
    .from('products')
    .select('id, name, stock_quantity, low_stock_threshold')
    .eq('tenant_id', tenantId)
    .eq('track_inventory', true);

  if (error) {
    return { success: false, error: error.message };
  }

  const rows = (data ?? [])
    .filter((row) => Number(row.stock_quantity ?? 0) <= Number(row.low_stock_threshold ?? 0))
    .map((row) => ({
      id: row.id,
      name: row.name,
      stock_quantity: row.stock_quantity,
      low_stock_threshold: row.low_stock_threshold,
    }));

  const reply = rows.length
    ? `Low stock items:\n${rows
        .map((row) => `• ${row.name}: ${row.stock_quantity}/${row.low_stock_threshold}`)
        .join('\n')}`
    : 'No low stock items right now.';

  return {
    success: true,
    reply,
    data: { items: rows },
  };
}

export const commerceHandlers: Record<string, ActionHandler> = {
  add_product: {
    action: 'add_product',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      const name = getString(params.name);
      const priceCents = toInteger(params.price_cents ?? params.price);
      if (!name || priceCents === null) {
        return { valid: false, error: 'add_product requires name and price_cents' };
      }
      return { valid: true };
    },
    execute: addProductExecute,
  },
  adjust_stock: {
    action: 'adjust_stock',
    capability: 'adjust_stock',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      const delta = toInteger(params.delta);
      const productId = getString(params.product_id);
      const variantId = getString(params.variant_id);
      if ((!productId && !variantId) || delta === null || delta === 0) {
        return { valid: false, error: 'adjust_stock requires product or variant and a non-zero delta' };
      }
      return { valid: true };
    },
    execute: adjustStockExecute,
  },
  set_price: {
    action: 'set_price',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      const productId = getString(params.product_id);
      const priceCents = toInteger(params.price_cents ?? params.price);
      if (!productId || priceCents === null) {
        return { valid: false, error: 'set_price requires product_id and price_cents' };
      }
      return { valid: true };
    },
    execute: setPriceExecute,
  },
  set_availability: {
    action: 'set_availability',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      const productId = getString(params.product_id);
      if (!productId) return { valid: false, error: 'set_availability requires product_id' };
      return { valid: true };
    },
    execute: setAvailabilityExecute,
  },
  low_stock_query: {
    action: 'low_stock_query',
    requiresConfirmation: false,
    async validate() {
      return { valid: true };
    },
    execute: lowStockQueryExecute,
  },
};
