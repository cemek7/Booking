export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { listRetailOrders } from '@/lib/commerce/retail-orders';

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    }

    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status');
    const paymentStatus = url.searchParams.get('payment_status');
    const fulfillmentStatus = url.searchParams.get('fulfillment_status');
    const chatId = url.searchParams.get('chat_id');
    const customerId = url.searchParams.get('customer_id');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

    try {
      return await listRetailOrders({
        tenantId,
        status,
        paymentStatus,
        fulfillmentStatus,
        chatId,
        customerId,
        limit,
        offset,
      });
    } catch (error) {
      throw ApiErrorFactory.internalServerError(
        error instanceof Error ? error : new Error('Failed to load retail orders')
      );
    }
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
