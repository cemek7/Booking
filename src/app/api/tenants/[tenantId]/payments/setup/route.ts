export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSubaccount } from '@/lib/paystack';
import { defaultLogger } from '@/lib/logger';

const SetupBodySchema = z.object({
  settlementBank: z.string().min(2, 'Bank code is required'),
  accountNumber: z.string().min(10, 'Account number is required'),
  percentageCharge: z.number().min(0).max(100).default(0),
});

/**
 * POST /api/tenants/:tenantId/payments/setup
 *
 * Creates a Paystack subaccount for split-payment settlement.
 * Called from tenant dashboard "Payment Settings" after onboarding.
 *
 * Body: { settlementBank: string, accountNumber: string, percentageCharge?: number }
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    if (ctx.user?.role !== 'superadmin' && ctx.user?.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json().catch(() => ({}));
    const parsed = SetupBodySchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }

    const { data: tenant, error: tenantErr } = await ctx.supabase
      .from('tenants')
      .select('name, metadata')
      .eq('id', tenantId)
      .single();

    if (tenantErr || !tenant) {
      throw ApiErrorFactory.notFound('Tenant');
    }

    const result = await createSubaccount({
      businessName: tenant.name as string,
      settlementBank: parsed.data.settlementBank,
      accountNumber: parsed.data.accountNumber,
      percentageCharge: parsed.data.percentageCharge,
      primaryContactEmail: ctx.user?.email ?? '',
    });

    if (!result.success || !result.subaccount) {
      defaultLogger.warn('[payments/setup] Paystack subaccount creation failed', { tenantId, error: result.error });
      throw ApiErrorFactory.internalServerError(
        new Error(result.error ?? 'Paystack subaccount creation failed')
      );
    }

    const existingMeta = (
      tenant.metadata && typeof tenant.metadata === 'object' ? tenant.metadata : {}
    ) as Record<string, unknown>;

    const updatedMeta = {
      ...existingMeta,
      paystack_subaccount_code: result.subaccount.subaccountCode,
      paystack_subaccount_setup_at: new Date().toISOString(),
      paystack_subaccount_pending: false,
    };

    const { error: updateErr } = await ctx.supabase
      .from('tenants')
      .update({ metadata: updatedMeta })
      .eq('id', tenantId);

    if (updateErr) {
      defaultLogger.warn('[payments/setup] Failed to store subaccount code in metadata', { tenantId, error: updateErr });
    }

    return { success: true, subaccountCode: result.subaccount.subaccountCode };
  },
  'POST',
  { auth: true, roles: ['owner', 'superadmin'] }
);
