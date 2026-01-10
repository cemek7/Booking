import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';

export const POST = createHttpHandler(
  async (ctx) => {
    const { date } = await ctx.request.json();
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // User auto-validated as owner/superadmin with roles check
    const paymentService = new PaymentService(ctx.supabase);
    const result = await paymentService.reconcileLedger(tenantId, date);

    if (!result.success) {
      throw ApiErrorFactory.databaseError(new Error(result.error || 'Reconciliation failed'));
    }

    return {
      success: true,
      discrepancies: result.discrepancies || [],
      message: `Reconciliation completed. Found ${result.discrepancies?.length || 0} discrepancies.`,
    };
  },
  'POST',
  { auth: true, roles: ['owner', 'superadmin'] }
);