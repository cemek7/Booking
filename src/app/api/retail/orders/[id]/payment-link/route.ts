export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createRetailOrderPaymentLink } from '@/lib/commerce/retail-orders';

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const userId = ctx.user?.id;
    const id = ctx.params?.id;

    if (!tenantId || !userId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required', userId: 'User ID required' });
    }
    if (!id) {
      throw ApiErrorFactory.validationError({ id: 'Order ID required' });
    }

    const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
    const callbackUrl = baseUrl ? `${baseUrl}/dashboard/orders?order=${encodeURIComponent(id)}` : null;

    try {
      const data = await createRetailOrderPaymentLink({
        tenantId,
        orderId: id,
        actorUserId: userId,
        callbackUrl,
      });
      return { data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create retail order payment link';
      if (/not found/i.test(message)) throw ApiErrorFactory.notFound('Retail order');
      if (/already paid|greater than zero|failed to create retail order payment link/i.test(message)) {
        throw ApiErrorFactory.badRequest(message);
      }
      throw ApiErrorFactory.internalServerError(new Error(message));
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
