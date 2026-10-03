import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyTransaction } from '@/lib/paystack';
import { creditVerifiedTopup } from '@/lib/billing/walletTopup';
import { handlePaymentFailure, handlePaymentRefund, handlePaymentSuccess } from '@/lib/payments/lifecycle';
import { openSettlementEscalation } from '@/lib/payments/paymentHandoff';
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
  onRefund: typeof handlePaymentRefund;
  creditTopup: typeof creditVerifiedTopup;
  secret: string;
};

export type SettleOutcome = 'verified' | 'already_verified' | 'mismatch' | 'not_found' | 'legacy_review' | 'not_successful' | 'refunded';

type Result = { status: number; body: Record<string, unknown> };

function defaultDeps(): WebhookDeps {
  return {
    admin: createSupabaseAdminClient(),
    verify: verifyTransaction,
    onSuccess: handlePaymentSuccess,
    onFailure: handlePaymentFailure,
    onRefund: handlePaymentRefund,
    creditTopup: creditVerifiedTopup,
    secret: process.env.PAYSTACK_SECRET_KEY || '',
  };
}

const NOT_VERIFIED = 'settlement_verification_status.is.null,settlement_verification_status.neq.verified';
const REFUNDED_STATUSES = new Set(['refunded', 'partially_refunded']);

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
  if (!secret) defaultLogger.error('[paystackWebhook] PAYSTACK_SECRET_KEY not configured');
  if (!signatureValid(input.rawBody, input.signature, secret)) {
    return { status: 401, body: { error: 'Invalid signature', code: 'INVALID_SIGNATURE' } };
  }
  const d = deps ?? defaultDeps();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Paystack payload, shape varies by event
  let payload: { event?: string; data?: Record<string, any> };
  try { payload = JSON.parse(input.rawBody); } catch { return { status: 400, body: { error: 'Invalid JSON' } }; }
  const event = String(payload.event ?? '');
  const data = payload.data ?? {};
  const isRefundEvent = event === 'charge.refunded' || event === 'refund.processed';
  const rawRef = isRefundEvent ? (data.transaction_reference ?? data.reference) : data.reference;
  const reference = typeof rawRef === 'string' ? rawRef : null;
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
        defaultLogger.warn('[paystackWebhook] wallet top-up not credited', { reference, reason: (credit as { reason?: string }).reason });
      }
      return { status: 200, body: { ok: true, wallet_topup: credit.credited } };
    }

    if (event === 'charge.success') {
      const outcome = await settleVerifiedCharge(reference, d);
      if (outcome === 'not_successful') {
        // Paystack does not yet report success: free the marker so its retry
        // of this same event is processed instead of being dropped as a replay.
        await release();
        return { status: 503, body: { error: 'payment_not_yet_successful', outcome } };
      }
      return { status: 200, body: { ok: true, outcome } };
    }

    if (event === 'charge.failed') {
      const row = await loadRow(d.admin, reference);
      if (row) {
        // NULL-safe guard; a verified (paid) row must never be failed or have
        // its booking undone, so onFailure runs only if the guarded update hit a row.
        const { data: updated, error } = await d.admin.from('transactions')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .or(NOT_VERIFIED)
          .select('id');
        if (error) throw new Error(`failed-status update failed: ${error.message}`);
        if (updated && updated.length > 0) {
          await d.onFailure({
            tenantId: row.tenant_id, reference, provider: 'paystack',
            reservationId: row.subject_type === 'reservation' ? row.subject_id : null,
            subjectType: row.subject_type, subjectId: row.subject_id,
            amountMinor: row.amount_minor ?? undefined, currency: row.currency ?? undefined,
            reason: String(data.gateway_response ?? data.status ?? 'charge.failed'),
          });
        }
      }
      return { status: 200, body: { ok: true } };
    }

    if (isRefundEvent) {
      const row = await loadRow(d.admin, reference);
      if (!row) return { status: 200, body: { ok: true, ignored: 'no_transaction' } };
      if (row.settlement_verification_status !== 'verified' || row.amount_minor === null) {
        defaultLogger.warn('[paystackWebhook] refund event for a row that is not verified; ignored', {
          reference, tenantId: row.tenant_id, verification: row.settlement_verification_status,
        });
        return { status: 200, body: { ok: true, ignored: 'not_verified' } };
      }
      const totalMinor = row.amount_minor;
      const eventAmount = Number(data.amount);
      // Paystack reports the refunded amount in kobo; absent/invalid means a full refund.
      const eventMinor = Number.isSafeInteger(eventAmount) && eventAmount > 0 ? eventAmount : totalMinor;
      const recordedMinor = Math.round(Number(row.refund_amount ?? 0) * 100);
      // A Booka-initiated refund is already recorded by refundTenantPayment;
      // its webhook must not be added a second time.
      const refundedTotalMinor = recordedMinor >= eventMinor
        ? Math.min(totalMinor, recordedMinor)
        : Math.min(totalMinor, recordedMinor + eventMinor);
      const full = refundedTotalMinor === totalMinor;
      const { error } = await d.admin.from('transactions')
        .update({
          status: full ? 'refunded' : 'partially_refunded',
          refund_amount: refundedTotalMinor / 100, // legacy major-unit column
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (error) throw new Error(`refund status update failed: ${error.message}`);
      if (full) {
        await d.onRefund({
          tenantId: row.tenant_id, reference, provider: 'paystack',
          reservationId: row.subject_type === 'reservation' ? row.subject_id : null,
          subjectType: row.subject_type, subjectId: row.subject_id,
          amountMinor: row.amount_minor ?? undefined, currency: row.currency ?? undefined,
        });
      }
      return { status: 200, body: { ok: true, refunded: full, refunded_minor: refundedTotalMinor } };
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
  settlement_effects_completed_at: string | null; refund_amount: number | string | null;
};

async function loadRow(admin: SupabaseClient, reference: string): Promise<Row | null> {
  const { data, error } = await admin.from('transactions')
    .select('id, tenant_id, status, currency, subject_type, subject_id, amount_minor, platform_fee_minor, settlement_subaccount_code, settlement_policy_code, settlement_policy_version, settlement_verification_status, settlement_effects_completed_at, refund_amount')
    .eq('provider_reference', reference).maybeSingle();
  if (error) throw new Error(`transaction lookup failed: ${error.message}`);
  if (!data) return null;
  return { ...data, amount_minor: data.amount_minor === null ? null : Number(data.amount_minor),
    platform_fee_minor: data.platform_fee_minor === null ? null : Number(data.platform_fee_minor) } as Row;
}

/**
 * Fee ledger row + subject confirmation for a verified row, then stamp
 * settlement_effects_completed_at. Every step is idempotent, so a delivery
 * that failed half-way is safely re-run by the next one (final-review B1).
 */
async function runSettlementEffects(row: Row, reference: string, deps: WebhookDeps): Promise<void> {
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
      subjectId: row.subject_id,
      amountMinor: row.amount_minor ?? undefined,
      currency: row.currency ?? 'NGN',
    });
  } catch (error) {
    // Payment is already verified and recorded; never revert it. The effects
    // stamp stays NULL, so the webhook retry re-runs these effects.
    defaultLogger.error('[paystackWebhook] post-payment handling failed after verified claim', { reference, tenantId: row.tenant_id, error: String(error) });
    throw error;
  }

  const { error: stampError } = await deps.admin.from('transactions')
    .update({ settlement_effects_completed_at: new Date().toISOString() })
    .eq('id', row.id);
  if (stampError) throw new Error(`settlement effects stamp failed: ${stampError.message}`);
}

/** Verify with Paystack and settle exactly once. Throws on provider/DB errors so callers retry. */
export async function settleVerifiedCharge(reference: string, deps: WebhookDeps = defaultDeps()): Promise<SettleOutcome> {
  const row = await loadRow(deps.admin, reference);
  if (!row) { defaultLogger.warn('[paystackWebhook] no transaction for reference', { reference }); return 'not_found'; }
  if (REFUNDED_STATUSES.has(row.status)) {
    // A refunded payment must never confirm its subject again.
    defaultLogger.warn('[paystackWebhook] charge.success for a refunded row; not confirming', { reference, tenantId: row.tenant_id, status: row.status });
    return 'refunded';
  }
  if (row.settlement_verification_status === 'verified') {
    if (row.settlement_effects_completed_at) return 'already_verified';
    await runSettlementEffects(row, reference, deps);
    return 'verified';
  }
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
    const { data: flagged, error } = await deps.admin.from('transactions')
      .update({ ...providerColumns, settlement_verification_status: 'mismatch', reconciliation_status: 'discrepancy' })
      .eq('id', row.id)
      .or(NOT_VERIFIED)
      .select('id');
    if (error) throw new Error(error.message);
    defaultLogger.error('[paystackWebhook] SETTLEMENT MISMATCH — manual review', {
      reference, tenantId: row.tenant_id,
      expected: { amount: row.amount_minor, currency: row.currency, subaccount: row.settlement_subaccount_code },
      observed: { amount: v.amountMinor, currency: v.currency, subaccount: v.subaccountCode },
    });
    if (flagged && flagged.length > 0) {
      // Spec §8 step 9: an operator must see it. 23505 = already alerted.
      await openSettlementEscalation(deps.admin, {
        tenantId: row.tenant_id,
        reference,
        reason: 'Paystack payment did not match the expected settlement — manual review',
      });
    }
    return 'mismatch';
  }

  // Claim: only one concurrent delivery flips the row to verified. A refunded
  // row is never re-confirmed.
  const { data: claimed, error: claimError } = await deps.admin.from('transactions')
    .update({ ...providerColumns, status: 'success', settlement_verification_status: 'verified', reconciliation_status: 'pending' })
    .eq('id', row.id).or(NOT_VERIFIED)
    .neq('status', 'refunded').neq('status', 'partially_refunded')
    .select('id');
  if (claimError) throw new Error(claimError.message);
  if (!claimed || claimed.length === 0) return 'already_verified';

  await runSettlementEffects(row, reference, deps);
  return 'verified';
}
