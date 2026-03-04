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
    // Derive tenant from authenticated user; only superadmin may override via header.
    const headerTenantId = ctx.request.headers.get('X-Tenant-ID');
    const tenantId = (ctx.user!.role === 'superadmin' && headerTenantId)
      ? headerTenantId
      : ctx.user!.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const normalizedTransactionId =
      typeof transactionId === 'string' ? transactionId.trim() : '';

    if (!normalizedTransactionId) {
      throw ApiErrorFactory.validationError({ transactionId: 'Transaction ID is required' });
    }

    // User auto-validated with roles check
    const paymentService = new PaymentService(ctx.supabase);
    const result = await paymentService.processRefund({
      tenantId: tenantId,
      transactionId: normalizedTransactionId,
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