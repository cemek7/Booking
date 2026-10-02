import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyTransaction } from '@/lib/paystack';
import { creditVerifiedTopup } from '@/lib/billing/walletTopup';
import { handlePaymentFailure, handlePaymentSuccess } from '@/lib/payments/lifecycle';
import { defaultLogger } from '@/lib/logger';

/**
 * The only Paystack webhook processor (spec 2026-10-02 §8). Both
 * /api/payments/webhook and /api/payments/paystack delegate here.
 * Tenant and subject always come from the transactions row, never the payload.
 */

export type WebhookDeps = {
  admin: SupabaseClient;
  verify: typeof verifyTransaction;
  onSuccess: typeof handlePaymentSuccess;
  onFailure: typeof handlePaymentFailure;
  creditTopup: typeof creditVerifiedTopup;
  secret: string;
};

export type SettleOutcome = 'verified' | 'already_verified' | 'mismatch' | 'not_found' | 'legacy_review' | 'not_successful';

type Result = { status: number; body: Record<string, unknown> };

function defaultDeps(): WebhookDeps {
  return {
    admin: createSupabaseAdminClient(),
    verify: verifyTransaction,
    onSuccess: handlePaymentSuccess,
    onFailure: handlePaymentFailure,
    creditTopup: creditVerifiedTopup,
    secret: process.env.PAYSTACK_SECRET_KEY || '',
  };
}

function signatureValid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const computed = Buffer.from(crypto.createHmac('sha512', secret).update(rawBody).digest('hex'), 'hex');
  const given = Buffer.from(signature, 'hex');
  return computed.length === given.length && crypto.timingSafeEqual(computed, given);
}

export async function processPaystackWebhook(
  input: { rawBody: string; signature: string | null },
  deps?: WebhookDeps,
): Promise<Result> {
  // Signature first: no DB client is created for an unauthenticated request
  // unless deps were injected.
  const secret = deps?.secret ?? (process.env.PAYSTACK_SECRET_KEY || '');
  if (!signatureValid(input.rawBody, input.signature, secret)) {
    return { status: 401, body: { error: 'Invalid signature', code: 'INVALID_SIGNATURE' } };
  }
  const d = deps ?? defaultDeps();

  let payload: { event?: string; data?: Record<string, any> };
  try { payload = JSON.parse(input.rawBody); } catch { return { status: 400, body: { error: 'Invalid JSON' } }; }
  const event = String(payload.event ?? '');
  const data = payload.data ?? {};
  const reference = typeof data.reference === 'string' ? data.reference : null;
  if (!reference) return { status: 200, body: { ok: true, ignored: 'no_reference' } };

  const externalId = `${reference}:${event}`;
  const marker = await d.admin.from('webhook_events')
    .insert({ provider: 'paystack', external_id: externalId, event_type: event, payload })
    .select('id');
  if (marker.error) {
    if (marker.error.code === '23505') return { status: 200, body: { ok: true, replay: true } };
    defaultLogger.error('[paystackWebhook] replay marker claim failed', { reference, code: marker.error.code });
    return { status: 500, body: { error: 'replay_marker_unavailable' } };
  }

  const release = async () => {
    try {
      await d.admin.from('webhook_events').delete().eq('provider', 'paystack').eq('external_id', externalId);
    } catch (e) {
      defaultLogger.error('[paystackWebhook] failed to release replay marker', { reference, error: String(e) });
    }
  };

  try {
    if (event === 'charge.success' && /^bokawallet_/.test(reference)) {
      const chargedMinor = Number(data.amount ?? 0);
      if (!Number.isFinite(chargedMinor) || chargedMinor <= 0) return { status: 200, body: { ok: true, wallet_topup: false, reason: 'no_amount' } };
      const credit = await d.creditTopup({
        admin: d.admin, reference, amountMinor: chargedMinor,
        customerEmail: data.customer?.email ?? null, authorization: data.authorization ?? null,
      });
      if (credit.credited) {
        defaultLogger.info('[paystackWebhook] wallet topped up', { reference, tenantId: credit.tenantId, amountCredits: credit.amountCredits });
      } else {
        // 'no_pending_intent' is the ordinary replay case, not a failure.
        defaultLogger.warn('[paystackWebhook] wallet top-up not credited', { reference, reason: (credit as any).reason });
      }
      return { status: 200, body: { ok: true, wallet_topup: credit.credited } };
    }

    if (event === 'charge.success') {
      const outcome = await settleVerifiedCharge(reference, d);
      return { status: 200, body: { ok: true, outcome } };
    }

    if (event === 'charge.failed') {
      const row = await loadRow(d.admin, reference);
      if (row) {
        // NULL-safe: `.neq` alone would skip legacy rows whose column is NULL.
        const { error } = await d.admin.from('transactions')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .or('settlement_verification_status.is.null,settlement_verification_status.neq.verified');
        if (error) throw new Error(`failed-status update failed: ${error.message}`);
        await d.onFailure({
          tenantId: row.tenant_id, reference, provider: 'paystack',
          reservationId: row.subject_type === 'reservation' ? row.subject_id : null,
          amountMinor: row.amount_minor ?? undefined, currency: row.currency ?? undefined,
          reason: String(data.gateway_response ?? data.status ?? 'charge.failed'),
        });
      }
      return { status: 200, body: { ok: true } };
    }

    return { status: 200, body: { ok: true, ignored: event } };
  } catch (error) {
    await release();
    throw error;
  }
}

type Row = {
  id: string; tenant_id: string; status: string; currency: string | null;
  subject_type: 'reservation' | 'retail_order' | 'payment_link' | null; subject_id: string | null;
  amount_minor: number | null; platform_fee_minor: number | null;
  settlement_subaccount_code: string | null; settlement_policy_code: string | null;
  settlement_policy_version: number | null; settlement_verification_status: string | null;
};

async function loadRow(admin: SupabaseClient, reference: string): Promise<Row | null> {
  const { data, error } = await admin.from('transactions')
    .select('id, tenant_id, status, currency, subject_type, subject_id, amount_minor, platform_fee_minor, settlement_subaccount_code, settlement_policy_code, settlement_policy_version, settlement_verification_status')
    .eq('provider_reference', reference).maybeSingle();
  if (error) throw new Error(`transaction lookup failed: ${error.message}`);
  if (!data) return null;
  return { ...data, amount_minor: data.amount_minor === null ? null : Number(data.amount_minor),
    platform_fee_minor: data.platform_fee_minor === null ? null : Number(data.platform_fee_minor) } as Row;
}

/** Verify with Paystack and settle exactly once. Throws on provider/DB errors so callers retry. */
export async function settleVerifiedCharge(reference: string, deps: WebhookDeps = defaultDeps()): Promise<SettleOutcome> {
  const row = await loadRow(deps.admin, reference);
  if (!row) { defaultLogger.warn('[paystackWebhook] no transaction for reference', { reference }); return 'not_found'; }
  if (row.settlement_verification_status === 'verified') return 'already_verified';
  if (row.amount_minor === null || !row.settlement_subaccount_code) {
    defaultLogger.error('[paystackWebhook] legacy transaction needs manual review', { reference, tenantId: row.tenant_id });
    return 'legacy_review';
  }

  const verified = await deps.verify(reference);
  if (!verified.success) throw new Error(`paystack verify failed: ${verified.error}`);
  const v = verified.data;
  if (v.status !== 'success') return 'not_successful';

  const providerColumns = {
    provider_amount_minor: v.amountMinor,
    provider_currency: v.currency,
    provider_fee_minor: v.feesMinor,
    provider_subaccount_code: v.subaccountCode,
    updated_at: new Date().toISOString(),
  };
  const matches = v.reference === reference
    && v.amountMinor === row.amount_minor
    && v.currency === row.currency
    && v.subaccountCode === row.settlement_subaccount_code;

  if (!matches) {
    const { error } = await deps.admin.from('transactions')
      .update({ ...providerColumns, settlement_verification_status: 'mismatch', reconciliation_status: 'discrepancy' })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
    defaultLogger.error('[paystackWebhook] SETTLEMENT MISMATCH — manual review', {
      reference, tenantId: row.tenant_id,
      expected: { amount: row.amount_minor, currency: row.currency, subaccount: row.settlement_subaccount_code },
      observed: { amount: v.amountMinor, currency: v.currency, subaccount: v.subaccountCode },
    });
    return 'mismatch';
  }

  // Claim: only one concurrent delivery flips the row to verified.
  const { data: claimed, error: claimError } = await deps.admin.from('transactions')
    .update({ ...providerColumns, status: 'success', settlement_verification_status: 'verified', reconciliation_status: 'pending' })
    .eq('id', row.id).neq('settlement_verification_status', 'verified')
    .select('id');
  if (claimError) throw new Error(claimError.message);
  if (!claimed || claimed.length === 0) return 'already_verified';

  const fee = row.platform_fee_minor ?? 0;
  if (fee > 0) {
    const { error } = await deps.admin.from('tenant_revenue_ledger').insert({
      tenant_id: row.tenant_id,
      revenue_type: 'platform_transaction_fee',
      amount_credits: fee / 100,
      source: 'paystack',
      reference,
      description: 'Booka platform fee on customer payment',
      metadata: { platform_fee_minor: fee, amount_minor: row.amount_minor, policy_code: row.settlement_policy_code, policy_version: row.settlement_policy_version },
    });
    if (error && error.code !== '23505') throw new Error(error.message);
  }

  try {
    await deps.onSuccess({
      tenantId: row.tenant_id,
      reference,
      provider: 'paystack',
      reservationId: row.subject_type === 'reservation' ? row.subject_id : null,
      subjectType: row.subject_type,
      amountMinor: row.amount_minor,
      currency: row.currency ?? 'NGN',
    });
  } catch (error) {
    // Payment is already verified and recorded; confirmation must be retried
    // by staff or the webhook retry path. Never revert the payment.
    defaultLogger.error('[paystackWebhook] post-payment handling failed after verified claim', { reference, tenantId: row.tenant_id, error: String(error) });
    throw error;
  }
  return 'verified';
}
