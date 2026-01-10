import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';

interface RefundRequest {
  transactionId: string;
  amount?: number;
  reason?: string;
}

export const POST = createHttpHandler(
  async (ctx) => {
    const body: RefundRequest = await ctx.request.json();
    const { transactionId, amount, reason } = body;
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    if (!transactionId) {
      throw ApiErrorFactory.missingRequiredField('transactionId');
    }

    // User auto-validated with roles check
    const paymentService = new PaymentService(ctx.supabase);
    const result = await paymentService.processRefund({
      tenantId: tenantId,
      transactionId,
      amount,
      reason,
    });

    if (!result.success) {
      throw ApiErrorFactory.databaseError(new Error(result.error || 'Refund processing failed'));
    }

    return {
      success: true,
      refundId: result.refundId,
      message: 'Refund processed successfully',
    };
  },
  'POST',
  { auth: true, roles: ['manager', 'owner', 'superadmin'] }
);