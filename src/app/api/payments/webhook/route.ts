import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { publishEvent } from '@/lib/eventBus';
import PaymentService from '@/lib/paymentService';
import Stripe from 'stripe';
import crypto from 'crypto';

interface PaymentWebhookPayload {
  provider?: string;
  source?: string;
  reference?: string;
  id?: string;
  data?: { reference?: string; status?: string; metadata?: Record<string, unknown> | null };
  status?: string;
  event?: string;
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
    const tenantId = parsed?.metadata?.tenant_id || parsed?.data?.metadata?.tenant_id || null;

    // Signature verification (Paystack & Stripe minimal implementations)
    const paystackSigHeader = ctx.request.headers.get('x-paystack-signature');
    const stripeSigHeader = ctx.request.headers.get('stripe-signature');
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY || '';
    const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

    if (paystackSigHeader && provider.includes('paystack')) {
      if (!paystackSecret) {
        throw ApiErrorFactory.externalServiceError('Paystack secret not configured');
      }
      const computed = crypto.createHmac('sha512', paystackSecret).update(rawText).digest('hex');
      if (computed !== paystackSigHeader) {
        throw ApiErrorFactory.validationError({ signature: 'Invalid Paystack signature' });
      }
    }

    if (stripeSigHeader && provider.includes('stripe')) {
      if (!stripeSecret) {
        throw ApiErrorFactory.externalServiceError('Stripe secret not configured');
      }
      try {
        const stripe = new Stripe(stripeSecret, { apiVersion: '2023-10-16' });
        const event = stripe.webhooks.constructEvent(rawText, stripeSigHeader, stripeSecret);
        // Event validated successfully
      } catch (e) {
        throw ApiErrorFactory.validationError({ signature: 'Invalid Stripe signature' });
      }
    }

    if (!ref) {
      throw ApiErrorFactory.validationError({ reference: 'Payment reference is required' });
    }

    // Idempotency / replay protection: insert into webhook_events
    try {
      const providerKey = provider || 'unknown';
      const externalId = ref || `${providerKey}-${Date.now()}`;
      const insertEvt = await ctx.supabase.from('webhook_events').insert({ 
        provider: providerKey, 
        external_id: externalId, 
        event_type: status,
        payload: parsed 
      }).select('id');
      
      if (insertEvt.error) {
        if (String(insertEvt.error.message || '').toLowerCase().includes('duplicate')) {
          // Replay detected, return success anyway
          return { ok: true, replay: true };
        }
        console.warn('payment webhook: webhook_events insert failed', insertEvt.error);
      }
    } catch (e) {
      console.warn('payment webhook: webhook_events handling failed', e);
    }

    // Update transaction status using provider verification if needed
    try {
      if (ref && tenantId) {
        // Find transaction by provider reference
        const { data: transaction } = await ctx.supabase
          .from('transactions')
          .select('id, status, provider')
          .eq('provider_reference', ref)
          .eq('tenant_id', tenantId)
          .single();

        if (transaction) {
          // Use PaymentService to verify current status if webhook status differs
          const paymentService = new PaymentService(ctx.supabase);
          let finalStatus = status;
          
          if (transaction.status !== status && /success|paid|completed/i.test(status)) {
            // Verify with provider for high-value status changes
            try {
              const provider = paymentService['getProvider'](transaction.provider);
              if (provider) {
                const verification = await provider.verifyPayment(ref);
                finalStatus = verification.status;
              }
            } catch (verifyError) {
              console.warn('Webhook verification failed, using webhook status', verifyError);
            }
          }

          // Update transaction with final status
          await ctx.supabase
            .from('transactions')
            .update({ 
              status: finalStatus,
              reconciliation_status: 'pending',
              updated_at: new Date().toISOString()
            })
            .eq('id', transaction.id);
        }
      }
    } catch (e) {
      console.warn('payment webhook: transaction update failed', e);
    }

    try {
      const evt = /success|paid/i.test(String(status)) ? 'payment.succeeded' : 'payment.updated';
      const tenantVal: string | null = tenantId && typeof tenantId === 'string' ? tenantId : null;
      await publishEvent({ supabase: ctx.supabase, event: evt, payload: { ref, provider, status, reservation_id: reservationId }, tenant_id: tenantVal });
    } catch (e) {
      console.warn('payment webhook: publishEvent failed', e);
    }

    return { ok: true };
  },
  'POST',
  { auth: false } // Webhooks don't require auth, use signature validation
);
