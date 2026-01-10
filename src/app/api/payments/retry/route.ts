import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';

interface RetryRequest {
  transactionId: string;
}

export const POST = createHttpHandler(
  async (ctx) => {
    const body: RetryRequest = await ctx.request.json();
    const { transactionId } = body;
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    if (!transactionId) {
      throw ApiErrorFactory.missingRequiredField('transactionId');
    }

    // Verify transaction belongs to tenant
    const { data: transaction } = await ctx.supabase
      .from('transactions')
      .select('id')
      .eq('id', transactionId)
      .eq('tenant_id', tenantId)
      .single();

    if (!transaction) {
      throw ApiErrorFactory.notFound('Transaction');
    }

    const paymentService = new PaymentService(ctx.supabase);
    const result = await paymentService.retryFailedTransaction(transactionId);

    if (!result.success) {
      throw ApiErrorFactory.databaseError(new Error(result.error || 'Retry processing failed'));
    }

    return {
      success: true,
      message: 'Transaction retry initiated successfully',
    };
  },
  'POST',
  { auth: true, roles: ['manager', 'owner', 'superadmin'] }
);