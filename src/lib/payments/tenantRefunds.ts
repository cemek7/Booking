import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import { isValidAmountMinor } from './settlementPolicy';

/**
 * Refunds for settled tenant payments. Amounts are minor units end to end.
 * Owner decision 2026-10-02: a FULL refund reverses Booka's platform fee;
 * a partial refund keeps it.
 */
export type RefundDeps = {
  admin: SupabaseClient;
  refund: (body: { transaction: string; amount: number }) => Promise<{ status: boolean; message?: string }>;
};

async function paystackRefund(body: { transaction: string; amount: number }) {
  const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
  const res = await fetchWithTimeout('https://api.paystack.co/refund', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 15_000,
  });
  return res.json() as Promise<{ status: boolean; message?: string }>;
}

async function reverseFee(
  admin: SupabaseClient,
  tx: { tenant_id: string; provider_reference: string; platform_fee_minor?: unknown },
  total: number,
): Promise<void> {
  const fee = Number(tx.platform_fee_minor ?? 0);
  if (!(fee > 0)) return;
  const { error: ledgerError } = await admin.from('tenant_revenue_ledger').insert({
    tenant_id: tx.tenant_id,
    revenue_type: 'refund',
    amount_credits: -(fee / 100),
    source: 'paystack',
    reference: `${tx.provider_reference}:fee_refund`,
    description: 'Booka platform fee returned on full refund',
    metadata: { platform_fee_minor: fee, amount_minor: total },
  });
  if (ledgerError && ledgerError.code !== '23505') {
    defaultLogger.error('[tenantRefunds] fee reversal not written', {
      tenantId: tx.tenant_id, reference: tx.provider_reference, error: ledgerError.message,
    });
  }
}

export async function refundTenantPayment(
  input: { tenantId: string; transactionId: string; amountMinor?: number; reason?: string },
  deps?: RefundDeps,
): Promise<{ ok: true; refundedMinor: number; full: boolean } | { ok: false; error: string }> {
  const { admin, refund } = deps ?? { admin: createSupabaseAdminClient(), refund: paystackRefund };
  const { data: tx, error } = await admin.from('transactions')
    .select('id, tenant_id, provider_reference, amount_minor, platform_fee_minor, settlement_verification_status, refund_amount')
    .eq('id', input.transactionId).eq('tenant_id', input.tenantId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!tx || tx.settlement_verification_status !== 'verified' || tx.amount_minor === null || tx.amount_minor === undefined) {
    return { ok: false, error: 'Only verified payments can be refunded' };
  }
  const total = Number(tx.amount_minor);
  const alreadyMinor = Math.round(Number(tx.refund_amount ?? 0) * 100);
  if (alreadyMinor === total && input.amountMinor === undefined) {
    // Self-heal: money already fully refunded; re-attempt the idempotent fee reversal only.
    await reverseFee(admin, tx, total);
    return { ok: true, refundedMinor: 0, full: true };
  }
  const requested = input.amountMinor ?? total - alreadyMinor;
  if (!isValidAmountMinor(requested)) return { ok: false, error: 'Refund amount must be a positive whole number of kobo' };
  if (alreadyMinor + requested > total) return { ok: false, error: 'Refund exceeds the amount paid' };

  let res: { status: boolean; message?: string };
  try {
    res = await refund({ transaction: tx.provider_reference, amount: requested });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Refund request failed' };
  }
  if (!res.status) return { ok: false, error: res.message || 'Refund failed' };

  const refundedTotal = alreadyMinor + requested;
  const full = refundedTotal === total;
  const { error: updateError } = await admin.from('transactions').update({
    refund_amount: refundedTotal / 100, // legacy major-unit column
    refund_reason: input.reason ?? null,
    status: full ? 'refunded' : 'partially_refunded',
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id);
  if (updateError) {
    defaultLogger.error('[tenantRefunds] refund sent but not recorded', {
      tenantId: input.tenantId, transactionId: input.transactionId, reference: tx.provider_reference,
      requestedMinor: requested, refundedTotalMinor: refundedTotal,
    });
    return { ok: false, error: 'Refund was sent to Paystack but could not be recorded. Contact support before retrying.' };
  }

  if (full) await reverseFee(admin, tx, total);
  return { ok: true, refundedMinor: requested, full };
}
