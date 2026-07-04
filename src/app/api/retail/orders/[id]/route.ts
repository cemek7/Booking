export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getRetailOrderById, transitionRetailOrder } from '@/lib/commerce/retail-orders';

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

    try {
      const data = await getRetailOrderById(tenantId, id);
      return { data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load retail order';
      if (/not found/i.test(message)) throw ApiErrorFactory.notFound('Retail order');
      throw ApiErrorFactory.internalServerError(new Error(message));
    }
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

const RetailOrderTransitionSchema = z.object({
  action: z.enum([
    'mark_paid',
    'mark_pending_payment',
    'mark_preparing',
    'mark_fulfilled',
    'mark_cancelled',
    'mark_refunded',
  ]),
  notes: z.string().optional(),
});

export const PATCH = createHttpHandler(
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

    const parsed = RetailOrderTransitionSchema.parse(await ctx.request.json());

    try {
      const data = await transitionRetailOrder({
        tenantId,
        orderId: id,
        actorUserId: userId,
        action: parsed.action,
        notes: parsed.notes,
      });
      return { data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update retail order';
      if (/not found/i.test(message)) throw ApiErrorFactory.notFound('Retail order');
      if (/must|cannot|insufficient/i.test(message)) throw ApiErrorFactory.badRequest(message);
      throw ApiErrorFactory.internalServerError(new Error(message));
    }
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
