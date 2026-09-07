export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { verifyPaystackSignature } from '@/lib/webhooks/validation';
import { defaultLogger } from '@/lib/logger';
import { handlePaymentFailure, handlePaymentRefund, handlePaymentSuccess } from '@/lib/payments/lifecycle';

/**
 * POST /api/payments/paystack
 * Paystack webhook handler — updates existing transactions based on event type.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    // SECURITY: Verify webhook signature BEFORE processing
    const rawBody = await ctx.request.text();
    const signature = ctx.request.headers.get('x-paystack-signature');
    const webhookSecret = process.env.PAYSTACK_SECRET_KEY || '';

    if (!webhookSecret) {
      defaultLogger.error('[api/payments/paystack] PAYSTACK_SECRET_KEY not configured');
      return { error: 'Webhook not configured' };
    }

    if (!verifyPaystackSignature(rawBody, signature, webhookSecret)) {
      defaultLogger.warn('🚨 [api/payments/paystack] SECURITY: Invalid Paystack webhook signature rejected');
      return NextResponse.json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' }, { status: 400 });
    }

    interface PaystackChargeData {
      reference?: string;
      amount?: number;
      currency?: string;
      gateway_response?: string;
      status?: string;
      metadata?: { reservation_id?: string | null } | null;
    }
    let payload: { event?: string; data?: PaystackChargeData } | undefined;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      defaultLogger.error('[api/payments/paystack] Failed to parse webhook body');
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const event: string = payload?.event ?? '';
    const data: PaystackChargeData = payload?.data ?? {};

    switch (event) {
      case 'charge.success': {
        const ref: string | undefined = data.reference;
        if (ref) {
          const { data: existing } = await ctx.supabase
            .from('transactions')
            .select('id, status, tenant_id')
            .eq('provider_reference', ref)
            .maybeSingle();
          const alreadyProcessed = existing?.status === 'success';
          const verifiedTenantId: string | null = existing?.tenant_id ?? null; // DB-sourced, not payload

          const { error } = await ctx.supabase
            .from('transactions')
            .update({ status: 'success' })
            .eq('provider_reference', ref);
          if (error) defaultLogger.error('[api/payments/paystack] charge.success update error:', error);

          // Shared post-payment confirmation (confirm booking + send WhatsApp/email)
          const reservationId = data?.metadata?.reservation_id || null;
          if (verifiedTenantId && !alreadyProcessed) {
            handlePaymentSuccess({
              tenantId: verifiedTenantId,
              reference: ref,
              provider: 'paystack',
              reservationId,
              amountMinor: data.amount,
              currency: data.currency,
            }).catch(err => defaultLogger.error('[api/payments/paystack] handlePaymentSuccess error', err));
          }
        }
        break;
      }

      case 'charge.failed': {
        const ref: string | undefined = data.reference;
        if (ref) {
          const { data: existing } = await ctx.supabase
            .from('transactions')
            .select('id, tenant_id')
            .eq('provider_reference', ref)
            .maybeSingle();

          const { error } = await ctx.supabase
            .from('transactions')
            .update({ status: 'failed' })
            .eq('provider_reference', ref);
          if (error) defaultLogger.error('[api/payments/paystack] charge.failed update error:', error);

          const reservationId = data?.metadata?.reservation_id || null;
          if (reservationId && existing?.tenant_id) {
            await ctx.supabase
              .from('reservations')
              .update({ status: 'payment_failed' })
              .eq('id', reservationId)
              .eq('tenant_id', existing.tenant_id);
            defaultLogger.warn('[api/payments/paystack] charge.failed — reservation marked payment_failed',
              { ref, reservationId });
          }
          if (existing?.tenant_id) {
            handlePaymentFailure({
              tenantId: existing.tenant_id,
              reference: ref,
              provider: 'paystack',
              reservationId,
              amountMinor: data.amount,
              currency: data.currency,
              reason: data?.gateway_response || data?.status || 'charge.failed',
            }).catch(err => defaultLogger.error('[api/payments/paystack] handlePaymentFailure error', err));
          }
        }
        break;
      }

      case 'charge.refunded': {
        const ref: string | undefined = data.reference;
        if (ref) {
          const { data: existing } = await ctx.supabase
            .from('transactions')
            .select('id, tenant_id')
            .eq('provider_reference', ref)
            .maybeSingle();

          await ctx.supabase
            .from('transactions')
            .update({ status: 'refunded' })
            .eq('provider_reference', ref);

          const reservationId = data?.metadata?.reservation_id || null;
          if (reservationId && existing?.tenant_id) {
            await ctx.supabase
              .from('reservations')
              .update({ status: 'refunded' })
              .eq('id', reservationId)
              .eq('tenant_id', existing.tenant_id);
          }
          if (existing?.tenant_id) {
            handlePaymentRefund({
              tenantId: existing.tenant_id,
              reference: ref,
              provider: 'paystack',
              reservationId,
              amountMinor: data.amount,
              currency: data.currency,
            }).catch(err => defaultLogger.error('[api/payments/paystack] handlePaymentRefund error', err));
          }
          defaultLogger.info('[api/payments/paystack] charge.refunded processed', { ref, reservationId });
        }
        break;
      }

      case 'transfer.success':
      case 'transfer.failed':
      case 'transfer.reversed':
        // Settlement is automatic via subaccount split — no transaction row to update
        defaultLogger.info(`[api/payments/paystack] ${event} received (auto-settled)`, {
          reference: data.reference,
          amount: data.amount,
        });
        break;

      default:
        defaultLogger.debug(`[api/payments/paystack] unhandled event: ${event}`);
        break;
    }

    return { received: true };
  },
  'POST',
  { auth: false } // Webhooks don't require auth
);
