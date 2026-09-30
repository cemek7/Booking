export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import {
  confirmRetailOrderFulfillment,
  RetailFulfillmentConfirmationSchema,
} from '@/lib/commerce/retail-fulfillment-confirmation';

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const userId = ctx.user?.id;
    const orderId = ctx.params?.id;
    if (!tenantId || !userId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required', userId: 'User ID required' });
    }
    if (!orderId) throw ApiErrorFactory.validationError({ id: 'Order ID required' });

    const parsed = RetailFulfillmentConfirmationSchema.safeParse(await ctx.request.json());
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    try {
      const data = await confirmRetailOrderFulfillment({
        tenantId,
        orderId,
        actorUserId: userId,
        method: parsed.data.method,
        provider: parsed.data.provider ?? null,
        deliveryFeeCents: parsed.data.deliveryFeeCents,
        note: parsed.data.note ?? null,
      });
      return { data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm order fulfillment';
      if (/not found/i.test(message)) throw ApiErrorFactory.notFound('Retail order');
      if (/required|provider|pickup|delivery|payment link amount/i.test(message)) {
        throw ApiErrorFactory.conflict(message);
      }
      throw ApiErrorFactory.internalServerError(new Error(message));
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] },
);
