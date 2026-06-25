export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { verifyStripeSignature } from '@/lib/webhooks/validation';
import { defaultLogger } from '@/lib/logger';
import { handlePaymentSuccess } from '@/lib/payments/lifecycle';

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
      defaultLogger.error('[api/payments/stripe] STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // Verify signature (prevents forged webhooks)
    if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
      defaultLogger.warn('🚨 [api/payments/stripe] SECURITY: Invalid Stripe webhook signature rejected');
      // Return 400 so monitoring catches forged/misrouted requests.
      // Stripe retries on 4xx/5xx — legitimate delivery failures will retry with a valid signature.
      return NextResponse.json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' }, { status: 400 });
    }

    // ✅ Signature verified - safe to process
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (error) {
      defaultLogger.error('[api/payments/stripe] Failed to parse webhook body:', error);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // B.2: Resolve tenant_id from DB-sourced transaction record first (prevents metadata spoofing)
    const metadataTenantId = event?.data?.object?.metadata?.tenant_id || null;
    const paymentRef: string | undefined = event?.data?.object?.id;
    let verifiedTenantId: string | null = null;

    // Primary: look up tenant from existing transaction record written at checkout
    if (paymentRef) {
      const { data: existingTx } = await ctx.supabase
        .from('transactions')
        .select('tenant_id')
        .eq('provider_reference', paymentRef)
        .maybeSingle();
      if (existingTx?.tenant_id) {
        verifiedTenantId = existingTx.tenant_id;
      }
    }

    // Fallback: validate metadata tenant exists in DB (only if no prior record)
    if (!verifiedTenantId && metadataTenantId) {
      const { data: tenant } = await ctx.supabase
        .from('tenants')
        .select('id')
        .eq('id', metadataTenantId)
        .maybeSingle();

      if (tenant) {
        verifiedTenantId = tenant.id;
      } else {
        defaultLogger.warn(`[api/payments/stripe] SECURITY: invalid tenant_id in metadata: ${metadataTenantId}`);
      }
    }

    // Map to transactions table
    const tx = {
      tenant_id: verifiedTenantId,
      amount: ((event?.data?.object?.amount_received ?? event?.data?.object?.amount) || 0) / 100,
      currency: event?.data?.object?.currency || 'USD',
      type: event.type || 'stripe_event',
      status: event?.data?.object?.status || 'unknown',
      raw: event,
    };

    const eventId: string | undefined = event?.id;
    if (eventId) {
      const { data: dup } = await ctx.supabase
        .from('transactions')
        .select('id')
        .filter('raw->>id', 'eq', eventId)
        .maybeSingle();
      if (dup) return { received: true };
    }

    const { error } = await ctx.supabase.from('transactions').insert([tx]);
    if (error) {
      defaultLogger.error('[api/payments/stripe] Error inserting Stripe transaction:', error);
      throw ApiErrorFactory.databaseError(error);
    }

    // Trigger shared post-payment confirmation path for successful charges
    if (/payment_intent\.succeeded|charge\.succeeded/i.test(event.type || '') && verifiedTenantId) {
      const ref = event?.data?.object?.id || null;
      const reservationId = event?.data?.object?.metadata?.reservation_id || null;

      // C.2: Deduplicate on provider_reference to guard against dual charge.succeeded + payment_intent.succeeded
      if (ref) {
        const { data: alreadyConfirmed } = await ctx.supabase
          .from('transactions')
          .select('id')
          .eq('provider_reference', ref)
          .eq('status', 'success')
          .maybeSingle();
        if (alreadyConfirmed) {
          defaultLogger.debug('[api/payments/stripe] duplicate success event, skipping handlePaymentSuccess');
          return { received: true };
        }
        await ctx.supabase.from('transactions').update({ status: 'success' }).eq('provider_reference', ref);
      }

      handlePaymentSuccess({
        tenantId: verifiedTenantId,
        reference: ref,
        provider: 'stripe',
        reservationId,
        amountMinor: event?.data?.object?.amount_received ?? event?.data?.object?.amount,
        currency: event?.data?.object?.currency,
      }).catch(err => defaultLogger.error('[api/payments/stripe] handlePaymentSuccess error', err));
    }

    // B.3: Handle payment failure — update both transaction and reservation
    if (/payment_intent\.payment_failed/i.test(event.type || '') && verifiedTenantId) {
      const ref = event?.data?.object?.id || null;
      const reservationId = event?.data?.object?.metadata?.reservation_id || null;
      if (ref && reservationId) {
        await ctx.supabase
          .from('transactions')
          .update({ status: 'failed' })
          .eq('provider_reference', ref)
          .eq('tenant_id', verifiedTenantId);

        await ctx.supabase
          .from('reservations')
          .update({ status: 'payment_failed' })
          .eq('id', reservationId)
          .eq('tenant_id', verifiedTenantId);
        defaultLogger.warn('[api/payments/stripe] payment_intent.payment_failed', { ref, reservationId, verifiedTenantId });
      }
    }

    // Handle refunds — update transaction and reservation to refunded status
    if (/charge\.refunded/i.test(event.type || '') && verifiedTenantId) {
      const ref = event?.data?.object?.payment_intent || event?.data?.object?.id || null;
      const reservationId = event?.data?.object?.metadata?.reservation_id || null;
      if (ref) {
        await ctx.supabase
          .from('transactions')
          .update({ status: 'refunded' })
          .eq('provider_reference', ref)
          .eq('tenant_id', verifiedTenantId);
      }
      if (reservationId) {
        await ctx.supabase
          .from('reservations')
          .update({ status: 'refunded' })
          .eq('id', reservationId)
          .eq('tenant_id', verifiedTenantId);
      }
      defaultLogger.info('[api/payments/stripe] charge.refunded processed', { ref, reservationId });
    }

    return { received: true };
  },
  'POST',
  { auth: false }
);
