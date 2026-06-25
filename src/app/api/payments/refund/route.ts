export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';

const RefundSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
  amount: z.number().positive().optional(),
  reason: z.string().optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const raw = await ctx.request.json();
    const parsed = RefundSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
      throw ApiErrorFactory.validationError(fields);
    }
    const { transactionId, amount, reason } = parsed.data;
    const tenantId = getVerifiedTenantId(ctx);

    // User auto-validated with roles check
    const paymentService = new PaymentService(ctx.supabase);
    const refundResult = await paymentService.processRefund({
      tenantId: tenantId,
      transactionId,
      amount,
      reason,
    });

    if (!refundResult.success) {
      throw ApiErrorFactory.databaseError(new Error(refundResult.error || 'Refund processing failed'));
    }

    return {
      success: true,
      refundId: refundResult.refundId,
      message: 'Refund processed successfully',
    };
  },
  'POST',
  { auth: true, roles: ['manager', 'owner', 'superadmin'] }
);
