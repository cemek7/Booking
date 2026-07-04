export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const id = ctx.params?.id;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    }
    if (!id) {
      throw ApiErrorFactory.validationError({ id: 'Order ID required' });
    }

    const { data, error } = await ctx.supabase
      .from('retail_orders')
      .select(`
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
          product:products(id, name, category, sku),
          variant:product_variants(id, name, sku)
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw ApiErrorFactory.databaseError(error);
    if (!data) throw ApiErrorFactory.notFound('Retail order');

    return { data };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
