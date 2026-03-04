import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { verifyStripeSignature } from '@/lib/webhooks/validation';

/**
 * POST /api/payments/stripe
 * Stripe webhook handler - receives events from Stripe and records transactions
 *
 * Security: Validates stripe-signature header (required in production)
 * Auth: Webhook signature validation (no Bearer token needed)
 * RBAC: None (webhook is called by Stripe directly)
 *
 * Request: Raw Stripe event JSON
 * Response: { received: true } on success
 */
export const POST = createHttpHandler(
  async (ctx) => {
    // ✅ SECURITY: Verify webhook signature BEFORE processing
    const rawBody = await ctx.request.text();
    const signature = ctx.request.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

    if (!webhookSecret) {
      console.error('[api/payments/stripe] STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // Verify signature (prevents forged webhooks)
    if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
      console.warn('🚨 [api/payments/stripe] SECURITY: Invalid Stripe webhook signature rejected');
      return NextResponse.json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' }, { status: 400 });
    }

    // ✅ Signature verified - safe to process
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (error) {
      console.error('[api/payments/stripe] Failed to parse webhook body:', error);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Map to transactions table
    const tx = {
      tenant_id: event?.data?.object?.metadata?.tenant_id || null,
      amount: ((event?.data?.object?.amount_received ?? event?.data?.object?.amount) || 0) / 100,
      currency: event?.data?.object?.currency || 'USD',
      type: event.type || 'stripe_event',
      status: event?.data?.object?.status || 'unknown',
      raw: event,
    };

    const { error } = await ctx.supabase.from('transactions').insert([tx]);
    if (error) {
      console.error('[api/payments/stripe] Error inserting Stripe transaction:', error);
      throw ApiErrorFactory.databaseError(error);
    }

    return { received: true };
  },
  'POST',
  { auth: false }
);
