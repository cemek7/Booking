import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { recordMovement } from '@/lib/inventory/recordMovement';
import type { ActionHandler } from './registry';

type ActionContext = { actorId?: string | null };
type SaleItem = {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  metadata?: Record<string, unknown> | null;
};

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

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseSaleItems(params: Record<string, unknown>): SaleItem[] {
  if (Array.isArray(params.items)) {
    return params.items
      .map((item) => {
        const record = getObject(item);
        if (!record) return null;
        const productId = getString(record.product_id);
        const quantity = toInteger(record.quantity);
        const unitPrice = toInteger(record.unit_price_cents ?? record.price_cents ?? record.price);
        if (!productId || quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0) {
          return null;
        }

        return {
          product_id: productId,
          variant_id: getString(record.variant_id),
          quantity,
          unit_price_cents: unitPrice,
          total_price_cents: toInteger(record.total_price_cents) ?? unitPrice * quantity,
          metadata: getObject(record.metadata),
        } as SaleItem;
      })
      .filter((item): item is SaleItem => item !== null);
  }

  const productId = getString(params.product_id);
  const quantity = toInteger(params.quantity);
  const unitPrice = toInteger(params.unit_price_cents ?? params.price_cents ?? params.price);

  if (!productId || quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0) {
    return [];
  }

  return [{
    product_id: productId,
    variant_id: getString(params.variant_id),
    quantity,
    unit_price_cents: unitPrice,
    total_price_cents: toInteger(params.total_price_cents) ?? unitPrice * quantity,
    metadata: getObject(params.metadata),
  }];
}

async function addProductExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
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
  ctx: ActionContext
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
  ctx: ActionContext
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
  ctx: ActionContext
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

async function recordRetailSaleExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const items = parseSaleItems(params);
  if (!items.length) {
    return { success: false, error: 'record_retail_sale requires at least one valid item' };
  }
  if (!ctx.actorId) {
    return { success: false, error: 'record_retail_sale requires an actorId' };
  }

  const { data, error } = await admin.rpc('record_retail_sale_tx', {
    p_tenant_id: tenantId,
    p_actor_user_id: ctx.actorId,
    p_items: items,
    p_customer_id: getString(params.customer_id),
    p_external_customer_ref: getString(params.external_customer_ref),
    p_source_chat_id: getString(params.source_chat_id),
    p_currency: getString(params.currency) ?? 'NGN',
    p_notes: getString(params.notes),
    p_reference_key: getString(params.reference_key) ?? getString(params.reference_id),
    p_metadata: getObject(params.metadata) ?? {},
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const orderId = getString((row as Record<string, unknown> | null)?.order_id);
  const totalCents = toInteger((row as Record<string, unknown> | null)?.total_cents) ?? 0;
  const itemCount = toInteger((row as Record<string, unknown> | null)?.item_count) ?? items.reduce((sum, item) => sum + item.quantity, 0);

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId,
    action: BUSINESS_EVENT_ACTIONS.RETAIL_SALE_RECORDED,
    entityType: 'retail_order',
    entityId: orderId,
    source: 'whatsapp',
    metadata: {
      total_cents: totalCents,
      item_count: itemCount,
      items: items.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
      })),
    },
  });

  return {
    success: true,
    reply: `Retail sale recorded for ₦${Math.round(totalCents / 100).toLocaleString()} across ${itemCount} item${itemCount === 1 ? '' : 's'}.`,
    data: row ?? null,
  };
}

async function refundSaleExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const orderId = getString(params.order_id);
  if (!orderId) {
    return { success: false, error: 'refund_sale requires order_id' };
  }
  if (!ctx.actorId) {
    return { success: false, error: 'refund_sale requires an actorId' };
  }

  const { data, error } = await admin.rpc('refund_retail_sale_tx', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_actor_user_id: ctx.actorId,
    p_reason: getString(params.reason),
    p_reference_key: getString(params.reference_key) ?? getString(params.reference_id),
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const totalCents = toInteger((row as Record<string, unknown> | null)?.total_cents) ?? 0;

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId,
    action: BUSINESS_EVENT_ACTIONS.ORDER_REFUNDED,
    entityType: 'retail_order',
    entityId: orderId,
    source: 'whatsapp',
    reason: getString(params.reason),
    metadata: {
      total_cents: totalCents,
    },
  });

  return {
    success: true,
    reply: `Refund recorded for retail order ${orderId}.`,
    data: row ?? null,
  };
}

async function recordOutstandingBalanceExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const items = parseSaleItems(params);
  if (!items.length) {
    return { success: false, error: 'record_outstanding_balance requires at least one valid item' };
  }

  const totalCents = items.reduce((sum, item) => sum + item.total_price_cents, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const currency = getString(params.currency) ?? 'NGN';

  const { data: order, error: orderError } = await admin
    .from('retail_orders')
    .insert({
      tenant_id: tenantId,
      customer_id: getString(params.customer_id),
      source_chat_id: getString(params.source_chat_id),
      external_customer_ref: getString(params.external_customer_ref),
      status: 'pending_payment',
      payment_status: 'unpaid',
      fulfillment_status: 'unfulfilled',
      currency,
      subtotal_cents: totalCents,
      total_cents: totalCents,
      notes: getString(params.notes),
      metadata: {
        source: 'pos',
        outstanding_balance: true,
        ...(getObject(params.metadata) ?? {}),
      },
    })
    .select('id, total_cents')
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? 'Failed to create outstanding balance order' };
  }

  const { error: itemsError } = await admin
    .from('retail_order_items')
    .insert(items.map((item) => ({
      order_id: order.id,
      tenant_id: tenantId,
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      total_price_cents: item.total_price_cents,
      metadata: item.metadata ?? {},
    })));

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.OUTSTANDING_BALANCE_RECORDED,
    entityType: 'retail_order',
    entityId: String(order.id),
    source: 'whatsapp',
    metadata: {
      total_cents: totalCents,
      item_count: itemCount,
    },
  });

  return {
    success: true,
    reply: `Outstanding balance recorded for ₦${Math.round(totalCents / 100).toLocaleString()}.`,
    data: { order },
  };
}

async function createOrderExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const items = parseSaleItems(params);
  if (!items.length) {
    return { success: false, error: 'create_order requires at least one valid item' };
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.total_price_cents, 0);
  const deliveryFeeCents = Math.max(0, toInteger(params.delivery_fee_cents ?? params.delivery_fee) ?? 0);
  const discountCents = Math.max(0, toInteger(params.discount_cents ?? params.discount) ?? 0);
  const totalCents = Math.max(0, subtotalCents + deliveryFeeCents - discountCents);
  const currency = getString(params.currency) ?? 'NGN';

  const { data: order, error: orderError } = await admin
    .from('retail_orders')
    .insert({
      tenant_id: tenantId,
      customer_id: getString(params.customer_id),
      source_chat_id: getString(params.source_chat_id),
      external_customer_ref: getString(params.external_customer_ref),
      status: 'draft',
      payment_status: 'unpaid',
      fulfillment_status: 'unfulfilled',
      currency,
      subtotal_cents: subtotalCents,
      delivery_fee_cents: deliveryFeeCents,
      discount_cents: discountCents,
      total_cents: totalCents,
      amount_paid_cents: 0,
      notes: getString(params.notes),
      metadata: {
        source: 'pos',
        ...(getObject(params.metadata) ?? {}),
      },
    })
    .select('id, total_cents')
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? 'Failed to create order' };
  }

  const { error: itemsError } = await admin
    .from('retail_order_items')
    .insert(items.map((item) => ({
      order_id: order.id,
      tenant_id: tenantId,
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      total_price_cents: item.total_price_cents,
      metadata: item.metadata ?? {},
    })));

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.RETAIL_ORDER_CREATED,
    entityType: 'retail_order',
    entityId: String(order.id),
    source: 'whatsapp',
    metadata: {
      total_cents: totalCents,
      delivery_fee_cents: deliveryFeeCents,
      discount_cents: discountCents,
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    },
  });

  return {
    success: true,
    reply: `Order created for ₦${Math.round(totalCents / 100).toLocaleString()}.`,
    data: { order },
  };
}

async function setOrderFulfillmentExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const orderId = getString(params.order_id);
  const requested = (getString(params.fulfillment_status ?? params.status) ?? '').toLowerCase();
  if (!orderId || !requested) {
    return { success: false, error: 'set_order_fulfillment requires order_id and fulfillment_status' };
  }

  const normalized =
    requested === 'delivered' || requested === 'pickup' || requested === 'fulfilled'
      ? 'fulfilled'
      : requested === 'preparing'
        ? 'preparing'
        : requested === 'cancelled'
          ? 'cancelled'
          : null;

  if (!normalized) {
    return { success: false, error: 'Unsupported fulfillment status' };
  }

  const updates: Record<string, unknown> = {
    fulfillment_status: normalized,
    updated_at: new Date().toISOString(),
  };

  if (normalized === 'fulfilled') {
    updates.status = 'fulfilled';
    updates.metadata = {
      fulfilledAt: new Date().toISOString(),
      fulfilledBy: ctx.actorId ?? null,
    };
  } else if (normalized === 'cancelled') {
    updates.status = 'cancelled';
  }

  const { data, error } = await admin
    .from('retail_orders')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .select('id, fulfillment_status, status')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update order fulfillment' };
  }

  if (normalized === 'fulfilled') {
    await recordBusinessEvent(admin, {
      tenantId,
      actorType: 'user',
      actorId: ctx.actorId ?? null,
      action: BUSINESS_EVENT_ACTIONS.RETAIL_ORDER_DELIVERED,
      entityType: 'retail_order',
      entityId: orderId,
      source: 'whatsapp',
    });
  }

  return {
    success: true,
    reply: `Order ${orderId} marked ${normalized}.`,
    data,
  };
}

async function addDeliveryFeeExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>
) {
  const orderId = getString(params.order_id);
  const deliveryFeeCents = Math.max(0, toInteger(params.delivery_fee_cents ?? params.delivery_fee) ?? -1);
  if (!orderId || deliveryFeeCents < 0) {
    return { success: false, error: 'add_delivery_fee requires order_id and delivery_fee_cents' };
  }

  const { data: current, error: fetchError } = await admin
    .from('retail_orders')
    .select('id, subtotal_cents, discount_cents')
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle();

  if (fetchError || !current) {
    return { success: false, error: fetchError?.message ?? 'Retail order not found' };
  }

  const nextTotal = Math.max(
    0,
    Number(current.subtotal_cents ?? 0) + deliveryFeeCents - Number(current.discount_cents ?? 0)
  );

  const { data, error } = await admin
    .from('retail_orders')
    .update({
      delivery_fee_cents: deliveryFeeCents,
      total_cents: nextTotal,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .select('id, delivery_fee_cents, total_cents')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to add delivery fee' };
  }

  return {
    success: true,
    reply: `Delivery fee updated to ₦${Math.round(deliveryFeeCents / 100).toLocaleString()}.`,
    data,
  };
}

async function cancelOrderRestockExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext
) {
  const orderId = getString(params.order_id);
  if (!orderId) {
    return { success: false, error: 'cancel_order_restock requires order_id' };
  }

  const { data: order, error: orderError } = await admin
    .from('retail_orders')
    .select('id, payment_status, status')
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? 'Retail order not found' };
  }
  if (order.payment_status === 'paid') {
    return { success: false, error: 'Paid retail orders should be refunded instead of cancelled' };
  }
  if (order.status === 'cancelled') {
    return { success: true, reply: `Order ${orderId} is already cancelled.`, data: order };
  }

  const { data: items, error: itemsError } = await admin
    .from('retail_order_items')
    .select('product_id, variant_id, quantity, product:products(track_inventory)')
    .eq('order_id', orderId)
    .eq('tenant_id', tenantId);

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  for (const item of items ?? []) {
    const trackInventory = Boolean((item.product as { track_inventory?: boolean } | null)?.track_inventory);
    if (!trackInventory) continue;

    const result = await recordMovement(admin, {
      tenantId,
      productId: getString(item.product_id),
      variantId: getString(item.variant_id),
      movementType: 'return',
      quantityChange: Math.max(0, Number(item.quantity ?? 0)),
      reason: getString(params.reason) ?? `order cancellation ${orderId}`,
      referenceType: 'retail_order',
      referenceId: orderId,
      actorId: ctx.actorId ?? null,
    });

    const rpcError = (result as { error?: { message?: string } | null }).error;
    if (rpcError) {
      return { success: false, error: rpcError.message ?? 'Failed to restock cancelled order' };
    }
  }

  const { data, error } = await admin
    .from('retail_orders')
    .update({
      status: 'cancelled',
      fulfillment_status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .select('id, status, fulfillment_status')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to cancel order' };
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.ORDER_CANCELLED,
    entityType: 'retail_order',
    entityId: orderId,
    source: 'whatsapp',
    reason: getString(params.reason),
  });

  return {
    success: true,
    reply: `Order ${orderId} cancelled and stock restocked.`,
    data,
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
  record_retail_sale: {
    action: 'record_retail_sale',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return parseSaleItems(params).length
        ? { valid: true }
        : { valid: false, error: 'record_retail_sale requires at least one valid item' };
    },
    execute: recordRetailSaleExecute,
  },
  refund_sale: {
    action: 'refund_sale',
    capability: 'refund',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return getString(params.order_id)
        ? { valid: true }
        : { valid: false, error: 'refund_sale requires order_id' };
    },
    execute: refundSaleExecute,
  },
  record_outstanding_balance: {
    action: 'record_outstanding_balance',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return parseSaleItems(params).length
        ? { valid: true }
        : { valid: false, error: 'record_outstanding_balance requires at least one valid item' };
    },
    execute: recordOutstandingBalanceExecute,
  },
  create_order: {
    action: 'create_order',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return parseSaleItems(params).length
        ? { valid: true }
        : { valid: false, error: 'create_order requires at least one valid item' };
    },
    execute: createOrderExecute,
  },
  set_order_fulfillment: {
    action: 'set_order_fulfillment',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return getString(params.order_id) && getString(params.fulfillment_status ?? params.status)
        ? { valid: true }
        : { valid: false, error: 'set_order_fulfillment requires order_id and fulfillment_status' };
    },
    execute: setOrderFulfillmentExecute,
  },
  add_delivery_fee: {
    action: 'add_delivery_fee',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      const orderId = getString(params.order_id);
      const fee = toInteger(params.delivery_fee_cents ?? params.delivery_fee);
      return orderId && fee !== null && fee >= 0
        ? { valid: true }
        : { valid: false, error: 'add_delivery_fee requires order_id and delivery_fee_cents' };
    },
    execute: addDeliveryFeeExecute,
  },
  cancel_order_restock: {
    action: 'cancel_order_restock',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return getString(params.order_id)
        ? { valid: true }
        : { valid: false, error: 'cancel_order_restock requires order_id' };
    },
    execute: cancelOrderRestockExecute,
  },
};
