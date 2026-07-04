export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    }

    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status');
    const chatId = url.searchParams.get('chat_id');
    const customerId = url.searchParams.get('customer_id');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

    let query = ctx.supabase
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
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (chatId) query = query.eq('source_chat_id', chatId);
    if (customerId) query = query.eq('customer_id', customerId);

    const { data, error, count } = await query;
    if (error) throw ApiErrorFactory.databaseError(error);

    return {
      data: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
