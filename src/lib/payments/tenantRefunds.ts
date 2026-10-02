import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
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
  await admin.from('transactions').update({
    refund_amount: refundedTotal / 100, // legacy major-unit column
    refund_reason: input.reason ?? null,
    status: full ? 'refunded' : 'partially_refunded',
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id);

  const fee = Number(tx.platform_fee_minor ?? 0);
  if (full && fee > 0) {
    const { error: ledgerError } = await admin.from('tenant_revenue_ledger').insert({
      tenant_id: tx.tenant_id,
      revenue_type: 'refund',
      amount_credits: -(fee / 100),
      source: 'paystack',
      reference: `${tx.provider_reference}:fee_refund`,
      description: 'Booka platform fee returned on full refund',
      metadata: { platform_fee_minor: fee, amount_minor: total },
    });
    if (ledgerError && ledgerError.code !== '23505') return { ok: false, error: ledgerError.message };
  }
  return { ok: true, refundedMinor: requested, full };
}
