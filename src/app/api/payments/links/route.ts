export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantCurrency } from '@/lib/tenant-currency';
import { PaymentsAdapter } from '@/lib/paymentsAdapter';

const CreateSchema = z.object({
  amount: z.number().positive().max(10_000_000), // major units (e.g. NGN)
  description: z.string().trim().min(1).max(200),
  customer_email: z.string().trim().email().optional().or(z.literal('')),
  customer_phone: z.string().trim().max(32).optional(),
});

/**
 * GET /api/payments/links — recent ad-hoc payment links for the tenant.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');
    const { data, error } = await ctx.supabase
      .from('transactions')
      .select('id, amount, currency, status, provider_reference, created_at, raw')
      .eq('tenant_id', tenantId)
      .eq('type', 'payment_link')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw ApiErrorFactory.databaseError(error);
    return { links: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * POST /api/payments/links — mint a Paystack payment link for a custom amount.
 * Splits to the tenant's subaccount when configured. Records a transaction so
 * it shows in payment tracking and reconciles on the webhook.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const parsed = CreateSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }
    const body = parsed.data;

    const admin = createSupabaseAdminClient();
    const currency = await getTenantCurrency(admin, tenantId, 'NGN').catch(() => 'NGN');
    const { data: tenantRow } = await admin.from('tenants').select('metadata').eq('id', tenantId).maybeSingle();
    const subaccountCode = (tenantRow?.metadata as { paystack_subaccount_code?: string } | null)?.paystack_subaccount_code;

    const reference = `link_${tenantId.replace(/-/g, '').slice(0, 20)}_${randomUUID().slice(0, 8)}`;
    const amountMinor = Math.round(body.amount * 100);

    const adapter = new PaymentsAdapter();
    const result = await adapter.createStandalonePaymentLink({
      tenant_id: tenantId,
      reference_key: reference,
      amount_minor_units: amountMinor,
      currency,
      customer_email: body.customer_email || null,
      customer_phone: body.customer_phone || null,
      description: body.description,
      subaccountCode: subaccountCode ?? null,
      metadata: { type: 'payment_link', description: body.description, created_by: ctx.user!.id },
    });

    if (result.status !== 'created' || !result.payment_url) {
      throw ApiErrorFactory.badRequest(result.error === 'missing_credentials'
        ? 'Payments are not configured yet. Add your bank details in Settings → Payments.'
        : (result.error || 'Could not create payment link'));
    }

    // Record so it appears in tracking + reconciles on the webhook (amount in major units).
    const { error: txError } = await admin.from('transactions').insert({
      tenant_id: tenantId,
      amount: body.amount,
      currency,
      type: 'payment_link',
      status: 'initiated',
      provider_reference: result.id ?? reference,
      raw: {
        provider: result.provider ?? 'paystack',
        description: body.description,
        payment_url: result.payment_url,
        customer_email: body.customer_email || null,
        customer_phone: body.customer_phone || null,
      },
    });
    if (txError) throw ApiErrorFactory.databaseError(txError);

    return { success: true, paymentUrl: result.payment_url, reference: result.id ?? reference, amount: body.amount, currency };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
