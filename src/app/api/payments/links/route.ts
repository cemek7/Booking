export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { initializeTenantPayment } from '@/lib/payments/tenantSettlement';

const CreateSchema = z.object({
  amount: z.number().positive().max(10_000_000), // major units (e.g. NGN)
  description: z.string().trim().min(1).max(200),
  customer_email: z.string().trim().email(),
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
      .select('id, amount, amount_minor, currency, status, provider_reference, created_at, raw')
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
 * Settles through the tenant settlement boundary, which writes the
 * transaction row so it shows in payment tracking and reconciles on the webhook.
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

    const amountMinor = Math.round(body.amount * 100);
    const linkId = randomUUID();
    const result = await initializeTenantPayment({
      tenantId,
      amountMinor,
      currency: 'NGN',
      customerEmail: body.customer_email,
      subject: { type: 'payment_link', id: linkId },
      idempotencyKey: `payment_link:${linkId}`,
      metadata: {
        type: 'payment_link',
        description: body.description,
        created_by: ctx.user!.id,
        customer_phone: body.customer_phone ?? null,
      },
    });
    if (!result.ok) {
      const configuration = ['SETTLEMENT_DISABLED', 'SETTLEMENT_NOT_CONFIGURED', 'POLICY_NOT_ACCEPTED'].includes(result.code);
      throw ApiErrorFactory.badRequest(configuration
        ? 'Payments are not set up yet. Finish setup in Settings → Payments.'
        : result.message);
    }

    return {
      success: true,
      paymentUrl: result.authorizationUrl,
      reference: result.reference,
      amount: amountMinor / 100,
      currency: 'NGN',
    };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
