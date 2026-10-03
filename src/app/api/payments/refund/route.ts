export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';
import { refundTenantPayment } from '@/lib/payments/tenantRefunds';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const RefundSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
  amount: z.number().positive().optional(),
  amountMinor: z.number().int().positive().optional(),
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
    const { transactionId, amount, amountMinor, reason } = parsed.data;
    const tenantId = getVerifiedTenantId(ctx);

    // Settled (minor-unit) payments refund in kobo through the settlement boundary.
    const { data: settledRow, error: settledLookupError } = await createSupabaseAdminClient()
      .from('transactions')
      .select('amount_minor')
      .eq('id', transactionId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    // Fail closed: if we cannot tell whether this is a settled payment, never
    // fall through to the legacy refund path.
    if (settledLookupError) {
      throw ApiErrorFactory.databaseError(new Error('Could not load the payment for refund'));
    }
    if (settledRow && settledRow.amount_minor !== null && settledRow.amount_minor !== undefined) {
      if (amount !== undefined) {
        throw ApiErrorFactory.validationError({ amount: 'Send amountMinor (whole kobo) for this payment; amount is not supported.' });
      }
      const result = await refundTenantPayment({ tenantId, transactionId, amountMinor, reason });
      if (!result.ok) throw ApiErrorFactory.validationError({ refund: result.error });
      return {
        success: true,
        refundedMinor: result.refundedMinor,
        full: result.full,
        message: 'Refund processed successfully',
      };
    }

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
  { auth: true, roles: ['manager', 'owner', 'superadmin'], permissions: [BOOKA_PERMISSIONS.ISSUE_REFUNDS] }
);
