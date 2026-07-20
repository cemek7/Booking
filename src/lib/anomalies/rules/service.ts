import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnomalyCandidate } from '../upsertAnomaly';
import type { AnomalyRule, RuleContext, RuleWindow } from './registry';

type ReservationRow = {
  id: string;
  price_cents_snapshot?: number | null;
  discount_cents?: number | null;
  discount_reason?: string | null;
};

type TransactionRow = {
  subject_type?: string | null;
  subject_id?: string | null;
  amount?: number | null;
  type?: string | null;
  status?: string | null;
};

async function completedServiceUnpaidDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const [{ data: reservations, error: reservationsError }, { data: transactions, error: transactionsError }] =
    await Promise.all([
      admin
        .from('reservations')
        .select('id, price_cents_snapshot')
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .gte('completed_at', window.startUtc)
        .lt('completed_at', window.endUtc),
      admin
        .from('transactions')
        .select('subject_type, subject_id, amount, type, status')
        .eq('tenant_id', tenantId)
        .gte('created_at', window.startUtc)
        .lt('created_at', window.endUtc),
    ]);

  if (reservationsError) throw reservationsError;
  if (transactionsError) throw transactionsError;

  const paidByReservation = new Map<string, number>();
  for (const transaction of (transactions ?? []) as TransactionRow[]) {
    const isPaidLike =
      transaction.status === 'success' &&
      (transaction.type === 'payment' || transaction.type === 'deposit' || transaction.type === 'sale');
    if (!isPaidLike || transaction.subject_type !== 'reservation' || !transaction.subject_id) continue;
    paidByReservation.set(
      transaction.subject_id,
      (paidByReservation.get(transaction.subject_id) ?? 0) + Math.round(Number(transaction.amount ?? 0) * 100)
    );
  }

  return ((reservations ?? []) as ReservationRow[])
    .filter((reservation) => Number(reservation.price_cents_snapshot ?? 0) > (paidByReservation.get(reservation.id) ?? 0))
    .map((reservation) => ({
      tenantId,
      ruleKey: 'completed_service_unpaid',
      domain: 'service',
      severity: 'high',
      entityType: 'reservation',
      entityId: reservation.id,
      expectedValueCents: Number(reservation.price_cents_snapshot ?? 0),
      actualValueCents: paidByReservation.get(reservation.id) ?? 0,
      differenceCents: Number(reservation.price_cents_snapshot ?? 0) - (paidByReservation.get(reservation.id) ?? 0),
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { reservation_id: reservation.id },
    }));
}

async function discountWithoutReasonDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const { data, error } = await admin
    .from('reservations')
    .select('id, discount_cents, discount_reason')
    .eq('tenant_id', tenantId)
    .gt('discount_cents', 0)
    .gte('updated_at', window.startUtc)
    .lt('updated_at', window.endUtc);

  if (error) throw error;

  return ((data ?? []) as ReservationRow[])
    .filter((row) => !row.discount_reason || !row.discount_reason.trim())
    .map((row) => ({
      tenantId,
      ruleKey: 'discount_without_reason',
      domain: 'service',
      severity: 'medium',
      entityType: 'reservation',
      entityId: row.id,
      expectedValueCents: Number(row.discount_cents ?? 0),
      actualValueCents: 0,
      differenceCents: Number(row.discount_cents ?? 0),
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { reservation_id: row.id },
    }));
}

export const serviceRules: AnomalyRule[] = [
  {
    key: 'completed_service_unpaid',
    domain: 'service',
    severity: 'high',
    mode: 'both',
    triggerActions: ['reservation.completed', 'payment.recorded'],
    detect: completedServiceUnpaidDetect,
    dedupKey: (candidate) => `completed_service_unpaid:${candidate.entityId}`,
  },
  {
    key: 'discount_without_reason',
    domain: 'service',
    severity: 'medium',
    mode: 'both',
    triggerActions: ['discount.applied'],
    detect: discountWithoutReasonDetect,
    dedupKey: (candidate) => `discount_without_reason:reservation:${candidate.entityId}`,
  },
];
