/**
 * Public Storefront service — no authentication required.
 *
 * The sales counterpart to publicBookingService: a public catalogue + order
 * intake for tenants who sell products. Writes into the existing retail engine
 * (retail_carts / retail_orders / retail_order_items) — there is no separate
 * "store" table; retail_orders is to sales what reservations is to bookings.
 *
 * Kept deliberately separate from publicBookingService so the two public
 * surfaces (/book/[slug] and /store/[slug]) never entangle.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import {
  addProductsToRetailCart,
  createRetailOrderPaymentLinkForCustomer,
} from '@/lib/commerce/retail-orders';
import { defaultLogger } from '@/lib/logger';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_cents: number;
  currency: string;
  image: string | null;
  in_stock: boolean;
  stock_quantity: number | null;
}

/**
 * GET /api/public/[slug]/products
 * Active catalogue for a tenant, shaped for the storefront.
 */
export async function getTenantProducts(tenantId: string): Promise<PublicProduct[]> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, short_description, category, price_cents, currency, images, stock_quantity, track_inventory, is_featured')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('is_featured', { ascending: false });

  if (error) {
    throw ApiErrorFactory.databaseError(new Error(error.message));
  }

  return (data ?? []).map((p: Record<string, unknown>) => {
    const priceCents = typeof p.price_cents === 'number' ? p.price_cents : Number(p.price_cents ?? 0);
    const trackInventory = p.track_inventory === true;
    const stock = typeof p.stock_quantity === 'number' ? p.stock_quantity : Number(p.stock_quantity ?? 0);
    const images = Array.isArray(p.images) ? (p.images as unknown[]) : [];
    const firstImage = typeof images[0] === 'string' ? (images[0] as string) : null;
    return {
      id: String(p.id),
      name: String(p.name ?? 'Product'),
      description: (p.description as string | null) ?? (p.short_description as string | null) ?? null,
      category: (p.category as string | null) ?? null,
      price_cents: Number.isFinite(priceCents) ? priceCents : 0,
      currency: typeof p.currency === 'string' && p.currency ? p.currency : 'NGN',
      image: firstImage,
      // Not tracking inventory ⇒ always sellable. Tracking ⇒ needs stock > 0.
      in_stock: !trackInventory || stock > 0,
      stock_quantity: trackInventory ? (Number.isFinite(stock) ? stock : 0) : null,
    };
  });
}

/** Look up a customer by phone (then email); create one if none exists. */
async function getOrCreateCustomer(
  tenantId: string,
  input: { name: string; phone: string; email?: string | null }
): Promise<string> {
  const supabase = createSupabaseAdminClient();

  // Value-bound lookups only — never splice a customer-supplied value into a filter.
  const byPhone = await supabase
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', input.phone)
    .maybeSingle();
  if (typeof byPhone.data?.id === 'string') return byPhone.data.id;

  if (input.email) {
    const byEmail = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('email', input.email)
      .maybeSingle();
    if (typeof byEmail.data?.id === 'string') return byEmail.data.id;
  }

  const { data: created, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      source: 'public_storefront',
    })
    .select('id')
    .single();

  if (error || !created) {
    throw ApiErrorFactory.databaseError(new Error(error?.message || 'Failed to create customer'));
  }
  return created.id as string;
}

export interface CreatePublicOrderPayload {
  items: Array<{ product_id: string; quantity: number }>;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  notes?: string;
}

export interface PublicOrderResult {
  orderId: string;
  totalCents: number;
  itemCount: number;
  paymentUrl: string | null;
}

/**
 * POST /api/public/[slug]/order
 * Validate the cart against the live catalogue, capture the customer, build a
 * retail order, and (best-effort) mint a payment link. If payments aren't
 * configured the order is still created (draft) and surfaces in the owner's
 * Orders dashboard for manual follow-up.
 */
export async function createPublicOrder(
  tenantId: string,
  payload: CreatePublicOrderPayload
): Promise<PublicOrderResult> {
  const supabase = createSupabaseAdminClient();

  const items = (payload.items ?? []).filter((i) => i && i.product_id && Number(i.quantity) > 0);
  if (items.length === 0) {
    throw ApiErrorFactory.badRequest('Your cart is empty');
  }

  // Validate every line against the live catalogue (tenant-scoped, active, in stock).
  const expandedProductIds: string[] = [];
  for (const item of items) {
    const qty = Math.min(Math.max(Math.floor(Number(item.quantity)), 1), 99);
    const { data: product } = await supabase
      .from('products')
      .select('id, name, is_active, track_inventory, stock_quantity')
      .eq('tenant_id', tenantId)
      .eq('id', item.product_id)
      .maybeSingle();

    if (!product || product.is_active !== true) {
      throw ApiErrorFactory.badRequest('One of the products is no longer available');
    }
    if (product.track_inventory === true && Number(product.stock_quantity ?? 0) < qty) {
      throw ApiErrorFactory.conflict(`Not enough stock for ${product.name}`);
    }
    for (let n = 0; n < qty; n += 1) expandedProductIds.push(product.id as string);
  }

  // Capture the customer (CRM) so the retail cart resolves to them by phone.
  await getOrCreateCustomer(tenantId, {
    name: payload.customer_name,
    phone: payload.customer_phone,
    email: payload.customer_email ?? null,
  });

  // Build cart + draft order + items via the shared retail engine (source: catalog).
  const cart = await addProductsToRetailCart({
    tenantId,
    externalId: payload.customer_phone,
    productIds: expandedProductIds,
    source: 'catalog',
  });

  // Best-effort payment link. No provider configured ⇒ leave as a draft order.
  let paymentUrl: string | null = null;
  try {
    const link = await createRetailOrderPaymentLinkForCustomer({
      tenantId,
      externalId: payload.customer_phone,
      actorUserId: 'public_storefront',
      orderId: cart.orderId,
      channel: null,
    });
    paymentUrl = link.paymentUrl ?? null;
  } catch (err) {
    defaultLogger.warn('[storefront] payment link unavailable; order left as draft', {
      tenantId,
      orderId: cart.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    orderId: cart.orderId,
    totalCents: cart.totalCents,
    itemCount: cart.itemCount,
    paymentUrl,
  };
}

const publicStorefrontService = {
  getTenantProducts,
  createPublicOrder,
};

export default publicStorefrontService;
