import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnomalyCandidate } from '../upsertAnomaly';
import type { AnomalyRule, RuleContext, RuleWindow } from './registry';

type ReservationRow = {
  id: string;
  price_cents_snapshot?: number | null;
  discount_cents?: number | null;
  discount_reason?: string | null;
  tenant_staff_id?: string | null;
  staff_id?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
};

type TransactionRow = {
  id?: string;
  subject_type?: string | null;
  subject_id?: string | null;
  amount?: number | null;
  type?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type BusinessEventRow = {
  action?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  created_at?: string | null;
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

async function paymentBelowServicePriceDetect(
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
    .filter((reservation) => {
      const expected = Number(reservation.price_cents_snapshot ?? 0);
      const paid = paidByReservation.get(reservation.id) ?? 0;
      return expected > 0 && paid > 0 && paid < expected;
    })
    .map((reservation) => {
      const expected = Number(reservation.price_cents_snapshot ?? 0);
      const paid = paidByReservation.get(reservation.id) ?? 0;
      return {
        tenantId,
        ruleKey: 'payment_below_service_price',
        domain: 'service',
        severity: 'medium',
        entityType: 'reservation',
        entityId: reservation.id,
        expectedValueCents: expected,
        actualValueCents: paid,
        differenceCents: expected - paid,
        detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
        detail: { reservation_id: reservation.id },
      };
    });
}

async function serviceCompletedWithoutStaffDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const { data, error } = await admin
    .from('reservations')
    .select('id, tenant_staff_id, staff_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .gte('completed_at', window.startUtc)
    .lt('completed_at', window.endUtc);

  if (error) throw error;

  return ((data ?? []) as ReservationRow[])
    .filter((row) => !row.tenant_staff_id && !row.staff_id)
    .map((row) => ({
      tenantId,
      ruleKey: 'service_completed_without_staff',
      domain: 'service',
      severity: 'medium',
      entityType: 'reservation',
      entityId: row.id,
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { reservation_id: row.id },
    }));
}

async function appointmentCancelledAfterCompletionDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const [{ data: reservations, error: reservationsError }, { data: events, error: eventsError }] = await Promise.all([
    admin
      .from('reservations')
      .select('id, completed_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .gte('completed_at', window.startUtc)
      .lt('completed_at', window.endUtc),
    admin
      .from('business_events')
      .select('action, entity_type, entity_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('action', 'booking.cancelled')
      .gte('created_at', window.startUtc)
      .lt('created_at', window.endUtc),
  ]);

  if (reservationsError) throw reservationsError;
  if (eventsError) throw eventsError;

  const reservationMap = new Map<string, ReservationRow>(
    ((reservations ?? []) as ReservationRow[]).map((row) => [row.id, row])
  );

  return ((events ?? []) as BusinessEventRow[])
    .filter((event) => event.entity_type === 'reservation' && event.entity_id && reservationMap.has(event.entity_id))
    .filter((event) => {
      const reservation = reservationMap.get(event.entity_id!);
      if (!reservation?.completed_at || !event.created_at) return false;
      return new Date(event.created_at).getTime() >= new Date(reservation.completed_at).getTime();
    })
    .map((event) => ({
      tenantId,
      ruleKey: 'appointment_cancelled_after_completion',
      domain: 'service',
      severity: 'high',
      entityType: 'reservation',
      entityId: event.entity_id!,
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: { reservation_id: event.entity_id },
    }));
}

async function depositsNotAppliedDetect(
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

  const grouped = new Map<string, TransactionRow[]>();
  for (const transaction of (transactions ?? []) as TransactionRow[]) {
    if (transaction.subject_type !== 'reservation' || !transaction.subject_id || transaction.status !== 'success') continue;
    const arr = grouped.get(transaction.subject_id) ?? [];
    arr.push(transaction);
    grouped.set(transaction.subject_id, arr);
  }

  return ((reservations ?? []) as ReservationRow[])
    .filter((reservation) => {
      const rows = grouped.get(reservation.id) ?? [];
      if (rows.length === 0) return false;
      return rows.every((row) => row.type === 'deposit');
    })
    .map((reservation) => {
      const rows = grouped.get(reservation.id) ?? [];
      const depositCents = rows.reduce((sum, row) => sum + Math.round(Number(row.amount ?? 0) * 100), 0);
      return {
        tenantId,
        ruleKey: 'deposits_not_applied',
        domain: 'service',
        severity: 'high',
        entityType: 'reservation',
        entityId: reservation.id,
        expectedValueCents: Number(reservation.price_cents_snapshot ?? 0),
        actualValueCents: depositCents,
        differenceCents: Number(reservation.price_cents_snapshot ?? 0) - depositCents,
        detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
        detail: { reservation_id: reservation.id, deposit_only: true },
      };
    });
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
  {
    key: 'payment_below_service_price',
    domain: 'service',
    severity: 'medium',
    mode: 'batch',
    detect: paymentBelowServicePriceDetect,
    dedupKey: (candidate) => `payment_below_service_price:${candidate.entityId}`,
  },
  {
    key: 'service_completed_without_staff',
    domain: 'service',
    severity: 'medium',
    mode: 'batch',
    detect: serviceCompletedWithoutStaffDetect,
    dedupKey: (candidate) => `service_completed_without_staff:${candidate.entityId}`,
  },
  {
    key: 'appointment_cancelled_after_completion',
    domain: 'service',
    severity: 'high',
    mode: 'batch',
    detect: appointmentCancelledAfterCompletionDetect,
    dedupKey: (candidate) => `appointment_cancelled_after_completion:${candidate.entityId}`,
  },
  {
    key: 'deposits_not_applied',
    domain: 'service',
    severity: 'high',
    mode: 'batch',
    detect: depositsNotAppliedDetect,
    dedupKey: (candidate) => `deposits_not_applied:${candidate.entityId}`,
  },
];
