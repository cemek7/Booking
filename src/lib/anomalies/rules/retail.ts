import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnomalyCandidate } from '../upsertAnomaly';
import type { AnomalyRule, RuleContext, RuleWindow } from './registry';

type RetailOrderRow = {
  id: string;
  total_cents?: number | null;
  amount_paid_cents?: number | null;
  payment_status?: string | null;
};

type RefundTransactionRow = {
  id: string;
  subject_type?: string | null;
  subject_id?: string | null;
  refund_amount?: number | null;
  refund_reason?: string | null;
};

async function deliveredOrderUnpaidDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const { data, error } = await admin
    .from('retail_orders')
    .select('id, total_cents, amount_paid_cents, payment_status')
    .eq('tenant_id', tenantId)
    .eq('fulfillment_status', 'fulfilled')
    .gte('updated_at', window.startUtc)
    .lt('updated_at', window.endUtc);

  if (error) throw error;

  return ((data ?? []) as RetailOrderRow[])
    .filter((order) => (order.payment_status ?? 'unpaid') !== 'paid' || Number(order.amount_paid_cents ?? 0) < Number(order.total_cents ?? 0))
    .map((order) => ({
      tenantId,
      ruleKey: 'delivered_order_unpaid',
      domain: 'retail',
      severity: 'high',
      entityType: 'retail_order',
      entityId: order.id,
      expectedValueCents: Number(order.total_cents ?? 0),
      actualValueCents: Number(order.amount_paid_cents ?? 0),
      differenceCents: Number(order.total_cents ?? 0) - Number(order.amount_paid_cents ?? 0),
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { order_id: order.id, payment_status: order.payment_status ?? 'unpaid' },
    }));
}

async function refundWithoutReasonDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const { data, error } = await admin
    .from('transactions')
    .select('id, subject_type, subject_id, refund_amount, refund_reason')
    .eq('tenant_id', tenantId)
    .eq('type', 'refund')
    .gte('created_at', window.startUtc)
    .lt('created_at', window.endUtc);

  if (error) throw error;

  return ((data ?? []) as RefundTransactionRow[])
    .filter((row) => Number(row.refund_amount ?? 0) > 0 && (!row.refund_reason || !row.refund_reason.trim()))
    .map((row) => ({
      tenantId,
      ruleKey: 'refund_without_reason',
      domain: row.subject_type === 'retail_order' ? 'retail' : 'service',
      entityType: row.subject_type === 'retail_order' ? 'retail_order' : 'transaction',
      entityId: row.subject_id ?? row.id,
      severity: 'medium',
      expectedValueCents: Math.round(Number(row.refund_amount ?? 0) * 100),
      actualValueCents: 0,
      differenceCents: Math.round(Number(row.refund_amount ?? 0) * 100),
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { transaction_id: row.id, subject_type: row.subject_type ?? null },
    }));
}

export const retailRules: AnomalyRule[] = [
  {
    key: 'delivered_order_unpaid',
    domain: 'retail',
    severity: 'high',
    mode: 'both',
    triggerActions: ['retail_order.delivered', 'retail_sale.recorded', 'payment.recorded'],
    detect: deliveredOrderUnpaidDetect,
    dedupKey: (candidate) => `delivered_order_unpaid:${candidate.entityId}`,
  },
  {
    key: 'refund_without_reason',
    domain: 'retail',
    severity: 'medium',
    mode: 'both',
    triggerActions: ['order.refunded'],
    detect: refundWithoutReasonDetect,
    dedupKey: (candidate) => `refund_without_reason:${candidate.entityType}:${candidate.entityId}`,
  },
];
