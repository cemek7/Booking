import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { updateChatJourneyByExternalId } from '@/lib/chats/journey-service';
import { PaymentsAdapter } from '@/lib/paymentsAdapter';
import { siasOperations } from '@/lib/sias-operations';
import { defaultLogger } from '@/lib/logger';
import { randomUUID } from 'crypto';

type ProductSnapshot = {
  id: string;
  tenant_id: string;
  name: string;
  price_cents: number | null;
  currency: string | null;
};

type RetailCart = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  source_chat_id: string | null;
  external_customer_ref: string | null;
  currency: string;
  subtotal_cents: number;
  total_cents: number;
};

type RetailOrder = {
  id: string;
  cart_id: string | null;
  total_cents: number;
};

type RetailOrderStatus = 'draft' | 'pending_payment' | 'paid' | 'cancelled' | 'fulfilled';
type RetailPaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded';
type RetailFulfillmentStatus = 'unfulfilled' | 'preparing' | 'fulfilled' | 'cancelled';

const RETAIL_ORDER_SELECT = `
  id,
  tenant_id,
  cart_id,
  customer_id,
  source_chat_id,
  external_customer_ref,
  status,
  payment_status,
  fulfillment_status,
  currency,
  subtotal_cents,
  total_cents,
  notes,
  metadata,
  created_at,
  updated_at,
  customer:customers(id, name, email, phone),
  items:retail_order_items(
    id,
    product_id,
    variant_id,
    quantity,
    unit_price_cents,
    total_price_cents,
    metadata,
    product:products(id, name, category, sku, track_inventory),
    variant:product_variants(id, name, sku)
  )
`;

async function resolveCustomerId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  externalId: string
): Promise<string | null> {
  // Two value-bound .eq() lookups instead of an interpolated .or() filter — an
  // external-provided identifier must never be spliced into a PostgREST filter
  // expression (injection risk). `phone` first, then the legacy `phone_number`.
  const byPhone = await admin
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', externalId)
    .maybeSingle();
  if (typeof byPhone.data?.id === 'string') return byPhone.data.id;

  const byPhoneNumber = await admin
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone_number', externalId)
    .maybeSingle();
  return typeof byPhoneNumber.data?.id === 'string' ? byPhoneNumber.data.id : null;
}

async function resolveCustomerAndChat(tenantId: string, externalId: string) {
  const admin = createSupabaseAdminClient();
  const [customerId, { data: chat }] = await Promise.all([
    resolveCustomerId(admin, tenantId, externalId),
    admin
      .from('chats')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_phone', externalId)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    customerId,
    chatId: typeof chat?.id === 'string' ? chat.id : null,
  };
}

async function ensureActiveCart(input: {
  tenantId: string;
  externalId: string;
}): Promise<RetailCart> {
  const admin = createSupabaseAdminClient();
  const { customerId, chatId } = await resolveCustomerAndChat(input.tenantId, input.externalId);

  const { data: existing } = await admin
    .from('retail_carts')
    .select('id, tenant_id, customer_id, source_chat_id, external_customer_ref, currency, subtotal_cents, total_cents')
    .eq('tenant_id', input.tenantId)
    .eq('external_customer_ref', input.externalId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return existing as RetailCart;
  }

  const { data: inserted, error } = await admin
    .from('retail_carts')
    .insert({
      tenant_id: input.tenantId,
      customer_id: customerId,
      source_chat_id: chatId,
      external_customer_ref: input.externalId,
      status: 'active',
      currency: 'NGN',
    })
    .select('id, tenant_id, customer_id, source_chat_id, external_customer_ref, currency, subtotal_cents, total_cents')
    .single();

  if (error || !inserted) {
    throw new Error(`Failed to create retail cart: ${error?.message ?? 'unknown error'}`);
  }

  return inserted as RetailCart;
}

async function loadProductSnapshot(tenantId: string, productId: string): Promise<ProductSnapshot | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('products')
    .select('id, tenant_id, name, price_cents, currency')
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .eq('is_active', true)
    .maybeSingle();

  return data as ProductSnapshot | null;
}

async function recalculateCartTotals(cartId: string): Promise<{ subtotal: number; total: number; itemCount: number }> {
  const admin = createSupabaseAdminClient();
  const { data: items } = await admin
    .from('retail_cart_items')
    .select('quantity,total_price_cents')
    .eq('cart_id', cartId);

  type CartItemRow = { quantity: number | null; total_price_cents: number | null };
  const typedItems = (items ?? []) as CartItemRow[];
  const subtotal = typedItems.reduce(
    (sum: number, item: CartItemRow) => sum + Number(item.total_price_cents ?? 0),
    0
  );
  const itemCount = typedItems.reduce(
    (sum: number, item: CartItemRow) => sum + Number(item.quantity ?? 0),
    0
  );

  await admin
    .from('retail_carts')
    .update({
      subtotal_cents: subtotal,
      total_cents: subtotal,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cartId);

  return { subtotal, total: subtotal, itemCount };
}

async function ensureDraftOrderFromCart(cart: RetailCart): Promise<RetailOrder> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from('retail_orders')
    .select('id, cart_id, total_cents')
    .eq('tenant_id', cart.tenant_id)
    .eq('cart_id', cart.id)
    .in('status', ['draft', 'pending_payment'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return existing as RetailOrder;
  }

  const { data: order, error } = await admin
    .from('retail_orders')
    .insert({
      tenant_id: cart.tenant_id,
      cart_id: cart.id,
      customer_id: cart.customer_id,
      source_chat_id: cart.source_chat_id,
      external_customer_ref: cart.external_customer_ref,
      currency: cart.currency,
      subtotal_cents: cart.subtotal_cents,
      total_cents: cart.total_cents,
      status: 'draft',
      payment_status: 'unpaid',
      fulfillment_status: 'unfulfilled',
      metadata: { source: 'chat_sales' },
    })
    .select('id, cart_id, total_cents')
    .single();

  if (error || !order) {
    throw new Error(`Failed to create draft retail order: ${error?.message ?? 'unknown error'}`);
  }

  return order as RetailOrder;
}

async function syncDraftOrderItems(orderId: string, cartId: string, tenantId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: items } = await admin
    .from('retail_cart_items')
    .select('product_id, variant_id, quantity, unit_price_cents, total_price_cents, metadata')
    .eq('cart_id', cartId);

  await admin.from('retail_order_items').delete().eq('order_id', orderId);

  if (!items?.length) return;

  await admin.from('retail_order_items').insert(
    items.map((item: {
      product_id: string;
      variant_id: string | null;
      quantity: number;
      unit_price_cents: number;
      total_price_cents: number;
      metadata?: Record<string, unknown> | null;
    }) => ({
      order_id: orderId,
      tenant_id: tenantId,
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      total_price_cents: item.total_price_cents,
      metadata: item.metadata ?? {},
    }))
  );
}

function getRetailOrderMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function loadRetailOrderForUpdate(tenantId: string, orderId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('retail_orders')
    .select(RETAIL_ORDER_SELECT)
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load retail order: ${error.message}`);
  }
  if (!data) {
    throw new Error('Retail order not found');
  }

  return data as Record<string, unknown>;
}

async function updateChatJourneyForOrder(order: Record<string, unknown>, patch: Record<string, unknown>) {
  const externalCustomerRef = typeof order.external_customer_ref === 'string' ? order.external_customer_ref : null;
  const tenantId = typeof order.tenant_id === 'string' ? order.tenant_id : null;
  if (!externalCustomerRef || !tenantId) return;

  await updateChatJourneyByExternalId({
    tenantId,
    externalId: externalCustomerRef,
    patch,
  });
}

async function applyInventoryMovement(
  tenantId: string,
  orderId: string,
  items: Array<Record<string, unknown>>,
  direction: 'decrement' | 'increment',
  performedBy: string | null = null
) {
  const admin = createSupabaseAdminClient();

  for (const item of items) {
    const product = item.product as { track_inventory?: boolean } | null | undefined;
    if (!product?.track_inventory) continue;

    const productId = typeof item.product_id === 'string' ? item.product_id : null;
    if (!productId) continue;
    const variantId = typeof item.variant_id === 'string' ? item.variant_id : null;
    const quantity = Math.max(0, Number(item.quantity ?? 0));
    if (!quantity) continue;

    // Canonical inventory path: the update_inventory() RPC (migration 117)
    // atomically adjusts products/product_variants.stock_quantity (floored at 0)
    // AND writes the inventory_movements row in one call. This replaces the
    // non-existent `product_inventory` table the earlier implementation queried
    // (which made mark_paid/mark_refunded throw for any tracked product).
    // The RPC floors at 0 rather than rejecting — correct here, since this runs
    // AFTER payment succeeds, so an out-of-stock item must not block finalization.
    const { error } = await admin.rpc('update_inventory', {
      p_tenant_id: tenantId,
      p_product_id: productId,
      p_variant_id: variantId,
      p_quantity_change: direction === 'decrement' ? -quantity : quantity,
      p_movement_type: direction === 'decrement' ? 'sale' : 'return',
      p_reference_type: 'retail_order',
      p_reference_id: orderId,
      p_reason: direction === 'decrement'
        ? `Retail order ${orderId} paid`
        : `Retail order ${orderId} refunded`,
      p_performed_by: performedBy,
    });

    if (error) {
      throw new Error(`Failed to update retail inventory: ${error.message}`);
    }
  }
}

export async function listRetailOrders(input: {
  tenantId: string;
  status?: string | null;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  chatId?: string | null;
  customerId?: string | null;
  limit?: number;
  offset?: number;
}) {
  const admin = createSupabaseAdminClient();
  const limit = Math.min(input.limit ?? 25, 100);
  const offset = Math.max(input.offset ?? 0, 0);

  let query = admin
    .from('retail_orders')
    .select(RETAIL_ORDER_SELECT, { count: 'exact' })
    .eq('tenant_id', input.tenantId)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (input.status) query = query.eq('status', input.status);
  if (input.paymentStatus) query = query.eq('payment_status', input.paymentStatus);
  if (input.fulfillmentStatus) query = query.eq('fulfillment_status', input.fulfillmentStatus);
  if (input.chatId) query = query.eq('source_chat_id', input.chatId);
  if (input.customerId) query = query.eq('customer_id', input.customerId);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to list retail orders: ${error.message}`);
  }

  return {
    data: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getRetailOrderById(tenantId: string, orderId: string) {
  return loadRetailOrderForUpdate(tenantId, orderId);
}

export async function createRetailOrderPaymentLink(input: {
  tenantId: string;
  orderId: string;
  actorUserId: string;
  channel?: 'whatsapp' | 'instagram' | null;
  callbackUrl?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const rawOrder = await loadRetailOrderForUpdate(input.tenantId, input.orderId);
  const order = rawOrder as {
    id: string;
    tenant_id: string;
    customer_id: string | null;
    external_customer_ref: string | null;
    source_chat_id: string | null;
    status: RetailOrderStatus;
    payment_status: RetailPaymentStatus;
    currency: string;
    total_cents: number;
    metadata: Record<string, unknown> | null;
    customer?: { email?: string | null; phone?: string | null; name?: string | null } | null;
  };

  if (order.payment_status === 'paid') {
    throw new Error('Retail order is already paid');
  }
  if (Number(order.total_cents ?? 0) <= 0) {
    throw new Error('Retail order total must be greater than zero');
  }

  const paymentMetadata = getRetailOrderMetadata(order.metadata).payment as Record<string, unknown> | undefined;
  const existingReference = typeof paymentMetadata?.reference === 'string' ? paymentMetadata.reference : null;
  const referenceKey = existingReference || `retail_${order.id.replace(/-/g, '').slice(0, 24)}_${randomUUID().slice(0, 8)}`;

  // Split settlement to the tenant's bank (Paystack subaccount), not the platform.
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('metadata')
    .eq('id', order.tenant_id)
    .maybeSingle();
  const subaccountCode = (tenantRow?.metadata as { paystack_subaccount_code?: string } | null)?.paystack_subaccount_code;

  const adapter = new PaymentsAdapter();
  const result = await adapter.createStandalonePaymentLink({
    tenant_id: order.tenant_id,
    reference_key: referenceKey,
    amount_minor_units: Number(order.total_cents ?? 0),
    currency: order.currency || 'NGN',
    customer_email: order.customer?.email ?? null,
    customer_phone: order.customer?.phone ?? order.external_customer_ref ?? null,
    description: `Retail order ${order.id}`,
    callback_url: input.callbackUrl ?? null,
    subaccountCode: subaccountCode ?? null,
    metadata: {
      tenant_id: order.tenant_id,
      retail_order_id: order.id,
      source_chat_id: order.source_chat_id,
      external_customer_ref: order.external_customer_ref,
      channel: input.channel ?? null,
    },
  });

  if (result.status !== 'created' || !result.id || !result.payment_url) {
    throw new Error(result.error || 'Failed to create retail order payment link');
  }

  const nextMetadata = {
    ...getRetailOrderMetadata(order.metadata),
    payment: {
      provider: result.provider || 'unknown',
      reference: result.id,
      url: result.payment_url,
      channel: input.channel ?? null,
      createdAt: new Date().toISOString(),
      createdBy: input.actorUserId,
    },
  };

  const { error: orderError } = await admin
    .from('retail_orders')
    .update({
      status: 'pending_payment',
      payment_status: 'pending',
      metadata: nextMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', order.tenant_id)
    .eq('id', order.id);

  if (orderError) {
    throw new Error(`Failed to store retail payment link: ${orderError.message}`);
  }

  const transactionPayload = {
    tenant_id: order.tenant_id,
    amount: Number(order.total_cents ?? 0) / 100,
    currency: order.currency || 'NGN',
    type: 'retail_order',
    status: 'initiated',
    provider_reference: result.id,
    raw: {
      provider: result.provider || 'unknown',
      payment_url: result.payment_url,
      retail_order_id: order.id,
      source_chat_id: order.source_chat_id,
      external_customer_ref: order.external_customer_ref,
      channel: input.channel ?? null,
    },
    updated_at: new Date().toISOString(),
  };

  const { error: txError } = await admin
    .from('transactions')
    .upsert(transactionPayload, { onConflict: 'provider_reference' });

  if (txError) {
    defaultLogger.warn('[retail-orders] failed to persist retail payment transaction', txError);
  }

  await updateChatJourneyForOrder(order, {
    type: 'retail',
    stage: 'pending_payment',
    orderId: order.id,
    orderTotalCents: Number(order.total_cents ?? 0),
  });

  return {
    provider: result.provider || 'unknown',
    reference: result.id,
    paymentUrl: result.payment_url,
    orderId: order.id,
    totalCents: Number(order.total_cents ?? 0),
  };
}

export async function createRetailOrderPaymentLinkForCustomer(input: {
  tenantId: string;
  externalId: string;
  actorUserId: string;
  channel?: 'whatsapp' | 'instagram' | null;
  orderId?: string | null;
  callbackUrl?: string | null;
}) {
  const admin = createSupabaseAdminClient();

  let orderId = typeof input.orderId === 'string' && input.orderId.trim()
    ? input.orderId.trim()
    : null;

  if (!orderId) {
    const { data: order } = await admin
      .from('retail_orders')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('external_customer_ref', input.externalId)
      .in('status', ['draft', 'pending_payment'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    orderId = typeof order?.id === 'string' ? order.id : null;
  }

  if (!orderId) {
    throw new Error('No draft retail order is available for this conversation');
  }

  return createRetailOrderPaymentLink({
    tenantId: input.tenantId,
    orderId,
    actorUserId: input.actorUserId,
    channel: input.channel ?? null,
    callbackUrl: input.callbackUrl ?? null,
  });
}

export async function transitionRetailOrder(input: {
  tenantId: string;
  orderId: string;
  actorUserId: string;
  action:
    | 'mark_paid'
    | 'mark_pending_payment'
    | 'mark_payment_failed'
    | 'mark_preparing'
    | 'mark_fulfilled'
    | 'mark_cancelled'
    | 'mark_refunded';
  notes?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const rawOrder = await loadRetailOrderForUpdate(input.tenantId, input.orderId);
  const order = rawOrder as {
    id: string;
    tenant_id: string;
    customer_id: string | null;
    external_customer_ref: string | null;
    status: RetailOrderStatus;
    payment_status: RetailPaymentStatus;
    fulfillment_status: RetailFulfillmentStatus;
    total_cents: number;
    metadata: Record<string, unknown> | null;
    items: Array<Record<string, unknown>>;
    cart_id: string | null;
  };

  const metadata = getRetailOrderMetadata(order.metadata);
  // Attribute the realized sale exactly once (idempotent across repeated mark_paid).
  const retailSaleAlreadyAttributed = typeof metadata.retailSaleAttributedAt === 'string';
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    updated_at: now,
  };
  if (input.notes && input.notes.trim()) {
    updates.notes = input.notes.trim();
  }

  switch (input.action) {
    case 'mark_pending_payment': {
      if (order.payment_status === 'paid') {
        throw new Error('Paid retail orders cannot return to pending payment');
      }
      updates.status = 'pending_payment';
      updates.payment_status = 'pending';
      updates.metadata = {
        ...metadata,
        paymentPendingAt: now,
        paymentPendingBy: input.actorUserId,
      };
      break;
    }
    case 'mark_payment_failed': {
      if (order.payment_status === 'paid') {
        throw new Error('Paid retail orders cannot be marked as failed');
      }
      updates.status = 'draft';
      updates.payment_status = 'failed';
      updates.metadata = {
        ...metadata,
        paymentFailedAt: now,
        paymentFailedBy: input.actorUserId,
      };
      break;
    }
    case 'mark_paid': {
      const inventoryAppliedAt = typeof metadata.inventoryAppliedAt === 'string' ? metadata.inventoryAppliedAt : null;
      if (!inventoryAppliedAt) {
        await applyInventoryMovement(order.tenant_id, order.id, order.items ?? [], 'decrement', input.actorUserId);
      }
      updates.status = 'paid';
      updates.payment_status = 'paid';
      updates.metadata = {
        ...metadata,
        inventoryAppliedAt: inventoryAppliedAt || now,
        inventoryAppliedBy: inventoryAppliedAt ? metadata.inventoryAppliedBy : input.actorUserId,
        paidAt: now,
        paidBy: input.actorUserId,
        retailSaleAttributedAt: metadata.retailSaleAttributedAt || now,
      };
      if (order.cart_id) {
        await admin
          .from('retail_carts')
          .update({ status: 'converted', updated_at: now })
          .eq('tenant_id', order.tenant_id)
          .eq('id', order.cart_id);
      }
      break;
    }
    case 'mark_preparing': {
      if (order.payment_status !== 'paid') {
        throw new Error('Retail order must be paid before fulfillment can begin');
      }
      updates.fulfillment_status = 'preparing';
      updates.metadata = {
        ...metadata,
        preparingAt: now,
        preparingBy: input.actorUserId,
      };
      break;
    }
    case 'mark_fulfilled': {
      if (order.payment_status !== 'paid') {
        throw new Error('Retail order must be paid before fulfillment');
      }
      updates.status = 'fulfilled';
      updates.fulfillment_status = 'fulfilled';
      updates.metadata = {
        ...metadata,
        fulfilledAt: now,
        fulfilledBy: input.actorUserId,
      };
      break;
    }
    case 'mark_cancelled': {
      if (order.payment_status === 'paid') {
        throw new Error('Paid retail orders should be refunded instead of cancelled');
      }
      updates.status = 'cancelled';
      updates.fulfillment_status = 'cancelled';
      updates.metadata = {
        ...metadata,
        cancelledAt: now,
        cancelledBy: input.actorUserId,
      };
      break;
    }
    case 'mark_refunded': {
      const inventoryAppliedAt = typeof metadata.inventoryAppliedAt === 'string' ? metadata.inventoryAppliedAt : null;
      const inventoryRevertedAt = typeof metadata.inventoryRevertedAt === 'string' ? metadata.inventoryRevertedAt : null;
      if (inventoryAppliedAt && !inventoryRevertedAt) {
        await applyInventoryMovement(order.tenant_id, order.id, order.items ?? [], 'increment', input.actorUserId);
      }
      updates.status = 'cancelled';
      updates.payment_status = 'refunded';
      updates.fulfillment_status = 'cancelled';
      updates.metadata = {
        ...metadata,
        refundedAt: now,
        refundedBy: input.actorUserId,
        inventoryRevertedAt: inventoryRevertedAt || (inventoryAppliedAt ? now : null),
      };
      break;
    }
  }

  const { error: orderError } = await admin
    .from('retail_orders')
    .update(updates)
    .eq('tenant_id', order.tenant_id)
    .eq('id', order.id);

  if (orderError) {
    throw new Error(`Failed to transition retail order: ${orderError.message}`);
  }

  // Realized-sale signal for owner BI / the data moat: attribute the paid retail
  // order once (the upsell *acceptance* is attributed elsewhere; this is the money).
  if (input.action === 'mark_paid' && !retailSaleAlreadyAttributed) {
    const productIds = Array.isArray(order.items)
      ? order.items
          .map((it) => (it as { product_id?: unknown }).product_id)
          .filter((id): id is string => typeof id === 'string')
      : [];
    await siasOperations
      .recordOutcomeAttribution({
        tenantId: order.tenant_id,
        customerId: order.customer_id,
        customerPhone: order.external_customer_ref,
        signal: 'retail_sale',
        sourceEvent: 'frontdesk.retail.paid',
        value: Number(order.total_cents ?? 0) > 0 ? Number(order.total_cents) / 100 : 1,
        metadata: {
          retail_order_id: order.id,
          cart_id: order.cart_id,
          item_count: productIds.length,
          product_ids: productIds,
        },
      })
      .catch(() => undefined);
  }

  const paymentReference =
    typeof (metadata.payment as Record<string, unknown> | undefined)?.reference === 'string'
      ? ((metadata.payment as Record<string, unknown>).reference as string)
      : null;

  if (paymentReference && ['mark_paid', 'mark_refunded'].includes(input.action)) {
    const nextTxStatus = input.action === 'mark_paid' ? 'success' : 'refunded';
    const { error: txError } = await admin
      .from('transactions')
      .update({
        status: nextTxStatus,
        raw: {
          ...(metadata.payment && typeof metadata.payment === 'object' ? { payment: metadata.payment } : {}),
          retail_order_id: order.id,
          transition: input.action,
        },
        updated_at: now,
      })
      .eq('tenant_id', order.tenant_id)
      .eq('provider_reference', paymentReference);

    if (txError) {
      defaultLogger.warn('[retail-orders] failed to update retail transaction status', txError);
    }
  }

  const journeyStageByAction: Record<typeof input.action, string> = {
    mark_pending_payment: 'pending_payment',
    mark_payment_failed: 'payment_failed',
    mark_paid: 'paid',
    mark_preparing: 'preparing',
    mark_fulfilled: 'fulfilled',
    mark_cancelled: 'cancelled',
    mark_refunded: 'refunded',
  };
  await updateChatJourneyForOrder(order, {
    type: 'retail',
    stage: journeyStageByAction[input.action],
    orderId: order.id,
    orderTotalCents: Number(order.total_cents ?? 0),
  });

  return getRetailOrderById(input.tenantId, input.orderId);
}

export async function addProductsToRetailCart(input: {
  tenantId: string;
  externalId: string;
  productIds: string[];
  source: 'upsell' | 'cross_sell' | 'catalog' | 'manual';
}): Promise<{ cartId: string; orderId: string; itemCount: number; totalCents: number }> {
  const admin = createSupabaseAdminClient();
  const cart = await ensureActiveCart({
    tenantId: input.tenantId,
    externalId: input.externalId,
  });

  for (const productId of input.productIds) {
    const product = await loadProductSnapshot(input.tenantId, productId);
    if (!product?.id) continue;

    const { data: existing } = await admin
      .from('retail_cart_items')
      .select('id, quantity')
      .eq('cart_id', cart.id)
      .eq('product_id', product.id)
      .is('variant_id', null)
      .maybeSingle();

    const nextQuantity = Number(existing?.quantity ?? 0) + 1;
    const unitPrice = Number(product.price_cents ?? 0);
    const totalPrice = unitPrice * nextQuantity;

    if (existing?.id) {
      await admin
        .from('retail_cart_items')
        .update({
          quantity: nextQuantity,
          unit_price_cents: unitPrice,
          total_price_cents: totalPrice,
          updated_at: new Date().toISOString(),
          metadata: { source: input.source },
        })
        .eq('id', existing.id);
    } else {
      await admin
        .from('retail_cart_items')
        .insert({
          cart_id: cart.id,
          tenant_id: input.tenantId,
          product_id: product.id,
          quantity: 1,
          unit_price_cents: unitPrice,
          total_price_cents: unitPrice,
          metadata: { source: input.source },
        });
    }
  }

  const totals = await recalculateCartTotals(cart.id);
  const refreshedCart: RetailCart = {
    ...cart,
    subtotal_cents: totals.subtotal,
    total_cents: totals.total,
  };
  const order = await ensureDraftOrderFromCart(refreshedCart);

  await admin
    .from('retail_orders')
    .update({
      subtotal_cents: totals.subtotal,
      total_cents: totals.total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  await syncDraftOrderItems(order.id, cart.id, input.tenantId);

  await updateChatJourneyByExternalId({
    tenantId: input.tenantId,
    externalId: input.externalId,
    patch: {
      type: 'retail',
      stage: 'draft_order',
      cartId: cart.id,
      orderId: order.id,
      cartItemCount: totals.itemCount,
      orderTotalCents: totals.total,
    },
  });

  return {
    cartId: cart.id,
    orderId: order.id,
    itemCount: totals.itemCount,
    totalCents: totals.total,
  };
}
