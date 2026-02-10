import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { verifyPaystackSignature } from '@/lib/webhooks/validation';

/**
 * POST /api/payments/paystack
 * Paystack webhook handler - receives events from Paystack and records transactions
 */
export const POST = createHttpHandler(
  async (ctx) => {
    // ✅ SECURITY: Verify webhook signature BEFORE processing
    const rawBody = await ctx.request.text();
    const signature = ctx.request.headers.get('x-paystack-signature');
    const webhookSecret = process.env.PAYSTACK_SECRET_KEY || '';

    if (!webhookSecret) {
      console.error('[api/payments/paystack] PAYSTACK_SECRET_KEY not configured');
      return { error: 'Webhook not configured' };
    }

    // Verify signature (prevents forged webhooks)
    if (!verifyPaystackSignature(rawBody, signature, webhookSecret)) {
      console.warn('🚨 [api/payments/paystack] SECURITY: Invalid Paystack webhook signature rejected');
      return { error: 'Invalid signature', code: 'INVALID_SIGNATURE' };
    }

    // ✅ Signature verified - safe to process
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error('[api/payments/paystack] Failed to parse webhook body:', error);
      return { error: 'Invalid JSON' };
    }

    const data = payload?.data || payload;
    const tx = {
      tenant_id: data?.metadata?.tenant_id || null,
      amount: (data?.amount ?? 0) / 100,
      currency: data?.currency || 'NGN',
      type: payload?.event || 'paystack_event',
      status: data?.status || 'unknown',
      raw: payload,
    };

    const { error } = await ctx.supabase.from('transactions').insert([tx]);
    if (error) {
      console.error('[api/payments/paystack] Error inserting transaction:', error);
      throw ApiErrorFactory.databaseError(error as Error);
    }

    return { received: true };
  },
  'POST',
  { auth: false } // Webhooks don't require auth
);
