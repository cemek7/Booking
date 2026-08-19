export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const RetrySchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const raw = await ctx.request.json();
    const parsed = RetrySchema.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
      throw ApiErrorFactory.validationError(fields);
    }
    const { transactionId } = parsed.data;
    const tenantId = getVerifiedTenantId(ctx);

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
    const retryResult = await paymentService.retryFailedTransaction(transactionId);

    if (!retryResult.success) {
      throw ApiErrorFactory.databaseError(new Error(retryResult.error || 'Retry processing failed'));
    }

    return {
      success: true,
      message: 'Transaction retry initiated successfully',
    };
  },
  'POST',
  { auth: true, roles: ['manager', 'owner', 'superadmin'], permissions: [BOOKA_PERMISSIONS.RECORD_PAYMENTS] }
);
