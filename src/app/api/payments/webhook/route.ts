export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getEventBus } from '@/lib/eventbus/eventBus';
import PaymentService from '@/lib/paymentService';
import Stripe from 'stripe';
import crypto from 'crypto';
import { defaultLogger } from '@/lib/logger';
import { handlePaymentFailure, handlePaymentRefund, handlePaymentSuccess } from '@/lib/payments/lifecycle';
import { processPaystackWebhook } from '@/lib/payments/paystackWebhookProcessor';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

interface PaymentWebhookPayload {
  provider?: string;
  source?: string;
  reference?: string;
  id?: string;
  data?: {
    reference?: string;
    status?: string;
    created_at?: string;
    amount?: number;
    metadata?: Record<string, unknown> | null;
    customer?: { email?: string } | null;
    authorization?: {
      authorization_code?: string;
      reusable?: boolean;
      last4?: string;
      card_type?: string;
      channel?: string;
    } | null;
  };
  status?: string;
  event?: string;
  created_at?: string;
  metadata?: { reservation_id?: string; tenant_id?: string } | null;
}

// Payment webhook route: handles provider callbacks (Paystack/Stripe stubs).
// Verifies minimal fields and updates transactions row status.

export const POST = createHttpHandler(
  async (ctx) => {
    // Capture raw body for signature verification
    let rawText: string;
    try {
      rawText = await ctx.request.text();
    } catch {
      throw ApiErrorFactory.validationError({ body: 'Failed to read request body' });
    }

    // Paystack events are handled by the single verified processor.
    const paystackSignature = ctx.request.headers.get('x-paystack-signature');
    if (paystackSignature) {
      const result = await processPaystackWebhook({ rawBody: rawText, signature: paystackSignature });
      return NextResponse.json(result.body, { status: result.status });
    }

    let parsed: PaymentWebhookPayload | null = null;
    try {
      parsed = JSON.parse(rawText) as PaymentWebhookPayload;
    } catch {
      throw ApiErrorFactory.validationError({ body: 'Invalid JSON in request' });
    }

    const provider = (parsed?.provider || parsed?.source || '').toLowerCase();
    const ref = parsed?.reference || parsed?.id || parsed?.data?.reference || null;
    const status = parsed?.status || parsed?.data?.status || parsed?.event || 'unknown';
    const reservationId = parsed?.metadata?.reservation_id || parsed?.data?.metadata?.reservation_id || null;

    // Signature verification (Stripe, Flutterwave; Paystack is delegated above)
    // At least one recognised signature header must be present and verified.
    // Requests with no recognised header are rejected regardless of provider field value,
    // closing the bypass where provider:"custom" skips all checks.
    const stripeSigHeader = ctx.request.headers.get('stripe-signature');
    const flutterwaveSigHeader = ctx.request.headers.get('verif-hash');
    const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const flutterwaveSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET || '';

    let signatureVerified = false;

    if (stripeSigHeader) {
      if (!stripeSecret) {
        throw ApiErrorFactory.externalServiceError('Stripe secret not configured');
      }
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || stripeSecret, {
          apiVersion: '2024-11-20' as Stripe.LatestApiVersion,
        });
        stripe.webhooks.constructEvent(rawText, stripeSigHeader, stripeSecret);
      } catch {
        throw ApiErrorFactory.validationError({ signature: 'Invalid Stripe signature' });
      }
      signatureVerified = true;
    }

    if (flutterwaveSigHeader) {
      if (!flutterwaveSecret) {
        throw ApiErrorFactory.externalServiceError('Flutterwave webhook secret not configured');
      }
      const sigBuf = Buffer.from(flutterwaveSigHeader);
      const secretBuf = Buffer.from(flutterwaveSecret);
      const isValid = sigBuf.length === secretBuf.length &&
        crypto.timingSafeEqual(sigBuf, secretBuf);
      if (!isValid) {
        throw ApiErrorFactory.validationError({ signature: 'Invalid Flutterwave signature' });
      }
      signatureVerified = true;
    }

    if (!signatureVerified) {
      defaultLogger.warn('[api/payments/webhook] Rejecting request: no recognised signature header', { provider });
      throw ApiErrorFactory.validationError({ signature: 'A recognised webhook signature header is required (stripe-signature or verif-hash)' });
    }

    if (!ref) {
      throw ApiErrorFactory.validationError({ reference: 'Payment reference is required' });
    }

    // Reject webhooks with a timestamp older than 72 hours
    const webhookTimestamp = parsed.data?.created_at || parsed.created_at || null;
    if (webhookTimestamp) {
      const webhookAge = Date.now() - new Date(webhookTimestamp).getTime();
      const seventyTwoHoursMs = 72 * 60 * 60 * 1000;
      if (webhookAge > seventyTwoHoursMs) {
        defaultLogger.warn('payment webhook: rejecting stale webhook older than 72 hours', { webhookTimestamp });
        return { ok: true, stale: true };
      }
    }

    const webhookProviderKey = provider || 'unknown';
    const webhookEventType = status || 'unknown';
    const webhookExternalId = `${ref}:${webhookEventType}`;
    let webhookMarkerInserted = false;
    // Idempotency / replay protection: insert into webhook_events
    try {
      const insertEvt = await ctx.supabase.from('webhook_events').insert({
        provider: webhookProviderKey,
        external_id: webhookExternalId,
        event_type: status,
        payload: parsed
      }).select('id');

      if (insertEvt.error) {
        if (insertEvt.error.code === '23505') {
          // Unique-violation (PostgreSQL error code) — replay detected
          return { ok: true, replay: true };
        }
        defaultLogger.warn('payment webhook: webhook_events insert failed', insertEvt.error);
      } else {
        webhookMarkerInserted = true;
      }
    } catch (e) {
      defaultLogger.warn('payment webhook: webhook_events handling failed', e);
    }

    try {
    // Update transaction status using provider verification if needed
    // IMPORTANT: derive tenantId from the found transaction record, never trust payload metadata
    // DB failures are NOT swallowed here — they propagate as 500 so the provider retries delivery.
    if (ref) {
      // Find transaction by provider reference alone — never use payload-supplied tenant_id
      const { data: transaction } = await ctx.supabase
        .from('transactions')
        .select('id, status, raw, tenant_id, amount_minor')
        .eq('provider_reference', ref)
        .maybeSingle();

      if (!transaction) {
        defaultLogger.warn('[api/payments/webhook] No transaction found for reference', { ref, provider });
      } else if (transaction.amount_minor !== null && transaction.amount_minor !== undefined) {
        // A Paystack-settled row changes state only through Paystack verification.
        defaultLogger.warn('[api/payments/webhook] Ignoring non-Paystack event for a settled transaction', { ref, provider });
      } else {
        // Derive tenantId from the DB record, never from payload metadata
        const verifiedTenantId = transaction.tenant_id as string;

        // Use PaymentService to verify current status if webhook status differs
        const paymentService = new PaymentService(ctx.supabase);
        let finalStatus = status;

        if (transaction.status !== status && /success|paid|completed/i.test(status)) {
          // Verify with provider for high-value status changes
          try {
            const txProvider = paymentService['getProvider'](
              (transaction.raw as { provider?: string } | null)?.provider,
            );
            if (txProvider) {
              const verification = await txProvider.verifyPayment(ref);
              finalStatus = verification.status;
            }
          } catch (verifyError) {
            defaultLogger.warn('Webhook verification failed, using webhook status', verifyError);
          }
        }

        // Update transaction — failure is fatal: let it throw so the provider retries
        const { error: updateError } = await ctx.supabase
          .from('transactions')
          .update({
            status: finalStatus,
            reconciliation_status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', transaction.id);

        if (updateError) {
          defaultLogger.error('[api/payments/webhook] Transaction update failed — provider will retry', { ref, updateError });
          throw ApiErrorFactory.databaseError(updateError);
        }

        // Publish events — failure is non-fatal (best-effort)
        try {
          const evt = /success|paid/i.test(String(finalStatus)) ? 'payment.succeeded' : 'payment.updated';
          const bus = getEventBus();
          await bus.publishEvent(ref || 'payment', 'payment', evt, { ref, provider, status: finalStatus, reservation_id: reservationId }, { metadata: { tenant_id: verifiedTenantId }, tenantId: verifiedTenantId });
        } catch (e) {
          defaultLogger.warn('payment webhook: publishEvent failed', e);
        }

        // Trigger post-payment confirmation for successful payments
        if (/success|paid/i.test(String(finalStatus)) && ref) {
          const prov = (provider || 'paystack') as 'paystack' | 'stripe' | 'flutterwave';
          await handlePaymentSuccess({
            tenantId: verifiedTenantId,
            reference: ref as string,
            provider: prov,
            reservationId: reservationId as string | null,
          });
        } else if (/refund/i.test(String(finalStatus)) && ref) {
          const prov = (provider || 'paystack') as 'paystack' | 'stripe' | 'flutterwave';
          handlePaymentRefund({
            tenantId: verifiedTenantId,
            reference: ref as string,
            provider: prov,
            reservationId: reservationId as string | null,
          }).catch(err => defaultLogger.error('payment webhook: handlePaymentRefund error', err));
        } else if (/fail|cancel|expired/i.test(String(finalStatus)) && ref) {
          const prov = (provider || 'paystack') as 'paystack' | 'stripe' | 'flutterwave';
          handlePaymentFailure({
            tenantId: verifiedTenantId,
            reference: ref as string,
            provider: prov,
            reservationId: reservationId as string | null,
            reason: String(finalStatus),
          }).catch(err => defaultLogger.error('payment webhook: handlePaymentFailure error', err));
        }
      }
    }

      return { ok: true };
    } catch (error) {
      if (webhookMarkerInserted) {
        const { error: cleanupError } = await createSupabaseAdminClient()
          .from('webhook_events')
          .delete()
          .eq('provider', webhookProviderKey)
          .eq('external_id', webhookExternalId);
        if (cleanupError) {
          defaultLogger.error('payment webhook: failed to release replay marker', {
            provider: webhookProviderKey,
            externalId: webhookExternalId,
            cleanupError,
          });
        }
      }
      throw error;
    }
  },
  'POST',
  { auth: false } // Webhooks don't require auth, use signature validation
);
