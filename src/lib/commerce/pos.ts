import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  addProductsToRetailCart,
  transitionRetailOrder,
  createRetailOrderPaymentLink,
} from '@/lib/commerce/retail-orders';
import { defaultLogger } from '@/lib/logger';

/**
 * Staff-facing point-of-sale. Rings up an in-store sale against the same
 * retail_orders engine the storefront/chat use. Each sale gets its OWN cart
 * (a unique external ref) so it never collides with a customer's online cart.
 *
 * - cash/transfer -> the order is marked paid immediately, which decrements
 *   tracked inventory (update_inventory RPC) and attributes the sale.
 * - card          -> a Paystack checkout link is minted for the customer to pay.
 */
export type PosPaymentMethod = 'cash' | 'transfer' | 'card';

export interface PosSaleInput {
  tenantId: string;
  actorUserId: string;
  items: Array<{ product_id: string; quantity: number }>;
  paymentMethod: PosPaymentMethod;
  customer?: { name?: string; phone?: string } | null;
  callbackUrl?: string | null;
}

export interface PosSaleResult {
  orderId: string;
  totalCents: number;
  itemCount: number;
  paid: boolean;
  paymentUrl: string | null;
}

export async function createPosSale(input: PosSaleInput): Promise<PosSaleResult> {
  const supabase = createSupabaseAdminClient();

  const items = (input.items ?? []).filter((i) => i && i.product_id && Number(i.quantity) > 0);
  if (items.length === 0) throw new Error('No items to sell');

  // Validate every line against the live catalogue (tenant-scoped, active, stock).
  const expandedProductIds: string[] = [];
  for (const item of items) {
    const qty = Math.min(Math.max(Math.floor(Number(item.quantity)), 1), 999);
    const { data: product } = await supabase
      .from('products')
      .select('id, name, is_active, track_inventory, stock_quantity')
      .eq('tenant_id', input.tenantId)
      .eq('id', item.product_id)
      .maybeSingle();
    if (!product || product.is_active !== true) throw new Error('A selected product is unavailable');
    if (product.track_inventory === true && Number(product.stock_quantity ?? 0) < qty) {
      throw new Error(`Not enough stock for ${product.name}`);
    }
    for (let n = 0; n < qty; n += 1) expandedProductIds.push(product.id as string);
  }

  // Unique per-sale cart ref so POS never merges with an online cart.
  const saleRef = `pos:${input.actorUserId}:${input.tenantId}:${expandedProductIds.length}:${globalThis.crypto?.randomUUID?.() ?? Math.round(performance.now())}`;

  const cart = await addProductsToRetailCart({
    tenantId: input.tenantId,
    externalId: saleRef,
    productIds: expandedProductIds,
    source: 'manual',
  });

  // Best-effort: attach a walk-in customer name/phone to the order metadata.
  if (input.customer?.name || input.customer?.phone) {
    await supabase
      .from('retail_orders')
      .update({ metadata: { pos: true, walk_in: { name: input.customer.name ?? null, phone: input.customer.phone ?? null } } })
      .eq('tenant_id', input.tenantId)
      .eq('id', cart.orderId)
      .then(undefined, () => undefined);
  }

  if (input.paymentMethod === 'card') {
    const link = await createRetailOrderPaymentLink({
      tenantId: input.tenantId,
      orderId: cart.orderId,
      actorUserId: input.actorUserId,
      channel: null,
      callbackUrl: input.callbackUrl ?? null,
    });
    return { orderId: cart.orderId, totalCents: cart.totalCents, itemCount: cart.itemCount, paid: false, paymentUrl: link.paymentUrl ?? null };
  }

  // Cash / transfer: money is in hand — mark paid (decrements stock + attributes).
  try {
    await transitionRetailOrder({
      tenantId: input.tenantId,
      orderId: cart.orderId,
      actorUserId: input.actorUserId,
      action: 'mark_paid',
      notes: `POS sale (${input.paymentMethod})`,
    });
  } catch (err) {
    defaultLogger.error('[pos] mark_paid failed', { orderId: cart.orderId, error: err instanceof Error ? err.message : String(err) });
    throw new Error('Sale recorded but could not be marked paid — check the order in Orders.');
  }

  return { orderId: cart.orderId, totalCents: cart.totalCents, itemCount: cart.itemCount, paid: true, paymentUrl: null };
}
