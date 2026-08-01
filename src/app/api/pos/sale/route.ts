export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createPosSale } from '@/lib/commerce/pos';

const SaleSchema = z.object({
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(999) })).min(1, 'Add at least one item'),
  paymentMethod: z.enum(['cash', 'transfer', 'card']),
  customer: z.object({ name: z.string().trim().max(120).optional(), phone: z.string().trim().max(32).optional() }).optional(),
});

/**
 * POST /api/pos/sale — record an in-store sale (owner/manager/staff).
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const parsed = SaleSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }

    // Card payments return the customer to the POS confirmation after Paystack.
    let callbackUrl: string | null = null;
    try { callbackUrl = new URL('/dashboard/pos?paid=1', ctx.request.url).toString(); } catch { /* optional */ }

    try {
      const result = await createPosSale({
        tenantId,
        actorUserId: ctx.user!.id,
        items: parsed.data.items,
        paymentMethod: parsed.data.paymentMethod,
        customer: parsed.data.customer ?? null,
        callbackUrl,
      });
      return { success: true, ...result };
    } catch (err) {
      throw ApiErrorFactory.badRequest(err instanceof Error ? err.message : 'Sale failed');
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
