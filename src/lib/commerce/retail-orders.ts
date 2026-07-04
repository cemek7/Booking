import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { updateChatJourneyByExternalId } from '@/lib/chats/journey-service';

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

async function resolveCustomerAndChat(tenantId: string, externalId: string) {
  const admin = createSupabaseAdminClient();
  const [{ data: customer }, { data: chat }] = await Promise.all([
    admin
      .from('customers')
      .select('id')
      .eq('tenant_id', tenantId)
      .or(`phone.eq.${externalId},phone_number.eq.${externalId}`)
      .maybeSingle(),
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
    customerId: typeof customer?.id === 'string' ? customer.id : null,
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
