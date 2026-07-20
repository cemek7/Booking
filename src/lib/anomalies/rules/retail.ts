import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnomalyCandidate } from '../upsertAnomaly';
import type { AnomalyRule, RuleContext, RuleWindow } from './registry';

type RetailOrderRow = {
  id: string;
  total_cents?: number | null;
  amount_paid_cents?: number | null;
  payment_status?: string | null;
  updated_at?: string | null;
  discount_cents?: number | null;
};

type TransactionRow = {
  id: string;
  subject_type?: string | null;
  subject_id?: string | null;
  amount?: number | null;
  type?: string | null;
  status?: string | null;
  created_at?: string | null;
  original_transaction_id?: string | null;
  refund_amount?: number | null;
  refund_reason?: string | null;
  refund_reason_text?: string | null;
};

type MovementRow = {
  reference_id?: string | null;
  movement_type?: string | null;
  quantity_change?: number | null;
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

  return ((data ?? []) as TransactionRow[])
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

async function saleWithoutPaymentDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const { data, error } = await admin
    .from('retail_orders')
    .select('id, total_cents, amount_paid_cents, payment_status')
    .eq('tenant_id', tenantId)
    .eq('status', 'paid')
    .gte('updated_at', window.startUtc)
    .lt('updated_at', window.endUtc);

  if (error) throw error;

  return ((data ?? []) as RetailOrderRow[])
    .filter((order) => Number(order.amount_paid_cents ?? 0) <= 0)
    .map((order) => ({
      tenantId,
      ruleKey: 'sale_without_payment',
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

async function paymentWithoutMatchingSaleDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const { data, error } = await admin
    .from('transactions')
    .select('id, subject_type, subject_id, amount, type, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('type', 'sale')
    .eq('status', 'success')
    .gte('created_at', window.startUtc)
    .lt('created_at', window.endUtc);

  if (error) throw error;

  const rolloutCutoffMs = window.rolloutCutoffUtc ? new Date(window.rolloutCutoffUtc).getTime() : null;
  const retailIds = new Set<string>();
  const rows = (data ?? []) as TransactionRow[];
  const validSubjectIds = rows
    .map((row) => row.subject_id)
    .filter((id): id is string => typeof id === 'string' && !!id);

  if (validSubjectIds.length > 0) {
    const { data: orders, error: ordersError } = await admin
      .from('retail_orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', validSubjectIds);
    if (ordersError) throw ordersError;
    for (const row of orders ?? []) retailIds.add(String((row as { id: string }).id));
  }

  return rows
    .filter((row) => {
      if (!row.created_at) return false;
      if (rolloutCutoffMs && new Date(row.created_at).getTime() < rolloutCutoffMs) return false;
      if (row.subject_type !== 'retail_order' || !row.subject_id) return false;
      return !retailIds.has(row.subject_id);
    })
    .map((row) => ({
      tenantId,
      ruleKey: 'payment_without_matching_sale',
      domain: 'retail',
      severity: 'high',
      entityType: 'transaction',
      entityId: row.id,
      expectedValueCents: 0,
      actualValueCents: Math.round(Number(row.amount ?? 0) * 100),
      differenceCents: Math.round(Number(row.amount ?? 0) * 100),
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { transaction_id: row.id, subject_id: row.subject_id },
    }));
}

async function cancelledOrderNotRestockedDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const [{ data: orders, error: ordersError }, { data: movements, error: movementsError }] = await Promise.all([
    admin
      .from('retail_orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'cancelled')
      .gte('updated_at', window.startUtc)
      .lt('updated_at', window.endUtc),
    admin
      .from('inventory_movements')
      .select('reference_id, movement_type, quantity_change')
      .eq('tenant_id', tenantId)
      .eq('reference_type', 'retail_order')
      .gte('created_at', window.startUtc)
      .lt('created_at', window.endUtc),
  ]);

  if (ordersError) throw ordersError;
  if (movementsError) throw movementsError;

  const restocked = new Set<string>(
    ((movements ?? []) as MovementRow[])
      .filter((row) => row.movement_type === 'return' || row.movement_type === 'refund_restock')
      .map((row) => String(row.reference_id ?? ''))
      .filter(Boolean)
  );

  return (orders ?? [])
    .map((row) => String((row as { id: string }).id))
    .filter((id) => !restocked.has(id))
    .map((id) => ({
      tenantId,
      ruleKey: 'cancelled_order_not_restocked',
      domain: 'retail',
      severity: 'high',
      entityType: 'retail_order',
      entityId: id,
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { order_id: id },
    }));
}

async function refundWithoutStockAdjustmentDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const [{ data: refunds, error: refundsError }, { data: movements, error: movementsError }] = await Promise.all([
    admin
      .from('transactions')
      .select('id, subject_type, subject_id')
      .eq('tenant_id', tenantId)
      .eq('type', 'refund')
      .gte('created_at', window.startUtc)
      .lt('created_at', window.endUtc),
    admin
      .from('inventory_movements')
      .select('reference_id, movement_type')
      .eq('tenant_id', tenantId)
      .eq('reference_type', 'retail_order')
      .gte('created_at', window.startUtc)
      .lt('created_at', window.endUtc),
  ]);

  if (refundsError) throw refundsError;
  if (movementsError) throw movementsError;

  const adjusted = new Set<string>(
    ((movements ?? []) as MovementRow[])
      .filter((row) => row.movement_type === 'refund_restock')
      .map((row) => String(row.reference_id ?? ''))
      .filter(Boolean)
  );

  return ((refunds ?? []) as TransactionRow[])
    .filter((row) => row.subject_type === 'retail_order' && row.subject_id && !adjusted.has(row.subject_id))
    .map((row) => ({
      tenantId,
      ruleKey: 'refund_without_stock_adjustment',
      domain: 'retail',
      severity: 'high',
      entityType: 'retail_order',
      entityId: row.subject_id!,
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { transaction_id: row.id, order_id: row.subject_id },
    }));
}

async function excessiveManualDiscountDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const thresholdPct = 0.15;
  const { data, error } = await admin
    .from('retail_orders')
    .select('id, total_cents, discount_cents')
    .eq('tenant_id', tenantId)
    .gt('discount_cents', 0)
    .gte('updated_at', window.startUtc)
    .lt('updated_at', window.endUtc);

  if (error) throw error;

  return ((data ?? []) as RetailOrderRow[])
    .filter((order) => {
      const discount = Number(order.discount_cents ?? 0);
      const gross = Number(order.total_cents ?? 0) + discount;
      return gross > 0 && discount / gross > thresholdPct;
    })
    .map((order) => ({
      tenantId,
      ruleKey: 'excessive_manual_discount',
      domain: 'retail',
      severity: 'medium',
      entityType: 'retail_order',
      entityId: order.id,
      expectedValueCents: Number(order.total_cents ?? 0) + Number(order.discount_cents ?? 0),
      actualValueCents: Number(order.discount_cents ?? 0),
      differenceCents: Number(order.discount_cents ?? 0),
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { order_id: order.id },
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
  {
    key: 'sale_without_payment',
    domain: 'retail',
    severity: 'high',
    mode: 'batch',
    detect: saleWithoutPaymentDetect,
    dedupKey: (candidate) => `sale_without_payment:${candidate.entityId}`,
  },
  {
    key: 'payment_without_matching_sale',
    domain: 'retail',
    severity: 'high',
    mode: 'batch',
    detect: paymentWithoutMatchingSaleDetect,
    dedupKey: (candidate) => `payment_without_matching_sale:${candidate.entityId}`,
  },
  {
    key: 'cancelled_order_not_restocked',
    domain: 'retail',
    severity: 'high',
    mode: 'batch',
    detect: cancelledOrderNotRestockedDetect,
    dedupKey: (candidate) => `cancelled_order_not_restocked:${candidate.entityId}`,
  },
  {
    key: 'refund_without_stock_adjustment',
    domain: 'retail',
    severity: 'high',
    mode: 'batch',
    detect: refundWithoutStockAdjustmentDetect,
    dedupKey: (candidate) => `refund_without_stock_adjustment:${candidate.entityId}`,
  },
  {
    key: 'excessive_manual_discount',
    domain: 'retail',
    severity: 'medium',
    mode: 'batch',
    detect: excessiveManualDiscountDetect,
    dedupKey: (candidate) => `excessive_manual_discount:${candidate.entityId}`,
  },
];
