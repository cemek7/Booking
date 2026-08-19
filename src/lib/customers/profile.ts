import type { SupabaseClient } from '@supabase/supabase-js';

type ReservationProfileRow = {
  id: string;
  start_at?: string | null;
  status?: string | null;
  price_cents_snapshot?: number | null;
  tenant_staff_id?: string | null;
};

type RetailOrderProfileRow = {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  total_cents?: number | null;
  amount_paid_cents?: number | null;
  updated_at?: string | null;
};

type TransactionProfileRow = {
  amount?: number | null;
  type?: string | null;
  status?: string | null;
  subject_type?: string | null;
  subject_id?: string | null;
};

function isSuccessfulTransaction(row: TransactionProfileRow): boolean {
  return ['success', 'paid'].includes(String(row.status ?? '').toLowerCase());
}

function isPositivePayment(row: TransactionProfileRow): boolean {
  return ['payment', 'deposit'].includes(String(row.type ?? '').toLowerCase());
}

function toCents(amount: number | null | undefined): number {
  return Math.round(Number(amount ?? 0) * 100);
}

function averageRounded(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export async function recomputeProfile(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const [{ data: reservations, error: reservationsError }, { data: retailOrders, error: retailOrdersError }] =
    await Promise.all([
      admin
        .from('reservations')
        .select('id, start_at, status, price_cents_snapshot, tenant_staff_id')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId),
      admin
        .from('retail_orders')
        .select('id, status, payment_status, total_cents, amount_paid_cents, updated_at')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId),
    ]);

  if (reservationsError) throw reservationsError;
  if (retailOrdersError) throw retailOrdersError;

  const reservationRows = (reservations ?? []) as ReservationProfileRow[];
  const retailOrderRows = (retailOrders ?? []) as RetailOrderProfileRow[];

  const reservationIds = reservationRows.map((row) => row.id);
  const retailOrderIds = retailOrderRows.map((row) => row.id);

  let transactions: TransactionProfileRow[] = [];
  if (reservationIds.length > 0 || retailOrderIds.length > 0) {
    const { data: transactionRows, error: transactionsError } = await admin
      .from('transactions')
      .select('amount, type, status, subject_type, subject_id')
      .eq('tenant_id', tenantId);

    if (transactionsError) throw transactionsError;
    transactions = (transactionRows ?? []) as TransactionProfileRow[];
  }

  const reservationIdSet = new Set(reservationIds);
  const retailOrderIdSet = new Set(retailOrderIds);

  const paymentCents = transactions.reduce((sum, row) => {
    if (!isSuccessfulTransaction(row) || !isPositivePayment(row)) return sum;

    const reservationMatch =
      row.subject_type === 'reservation' && !!row.subject_id && reservationIdSet.has(row.subject_id);
    const retailMatch =
      row.subject_type === 'retail_order' && row.subject_id && retailOrderIdSet.has(row.subject_id);

    if (!reservationMatch && !retailMatch) return sum;
    return sum + toCents(row.amount);
  }, 0);

  const completedReservations = reservationRows.filter((row) => row.status === 'completed');
  const noShowCount = reservationRows.filter((row) => row.status === 'no_show').length;
  const cancellationCount = reservationRows.filter((row) => row.status === 'cancelled').length;

  const outstandingBalanceCents = retailOrderRows.reduce((sum, row) => {
    const total = Number(row.total_cents ?? 0);
    const paid = Number(row.amount_paid_cents ?? 0);
    const balance = Math.max(0, total - paid);
    if (balance <= 0) return sum;
    if (String(row.payment_status ?? '').toLowerCase() === 'paid') return sum;
    return sum + balance;
  }, 0);

  const completedReservationDates = completedReservations
    .map((row) => (row.start_at ? Date.parse(row.start_at) : NaN))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const intervals: number[] = [];
  for (let index = 1; index < completedReservationDates.length; index += 1) {
    const previous = completedReservationDates[index - 1];
    const current = completedReservationDates[index];
    intervals.push(Math.max(0, Math.round((current - previous) / (24 * 60 * 60 * 1000))));
  }

  const preferredStaffCounts = new Map<string, number>();
  for (const row of completedReservations) {
    if (!row.tenant_staff_id) continue;
    preferredStaffCounts.set(
      row.tenant_staff_id,
      (preferredStaffCounts.get(row.tenant_staff_id) ?? 0) + 1,
    );
  }

  let preferredStaffId: string | null = null;
  let preferredStaffCount = 0;
  for (const [staffId, count] of preferredStaffCounts.entries()) {
    if (count > preferredStaffCount) {
      preferredStaffId = staffId;
      preferredStaffCount = count;
    }
  }

  const completedRetailOrders = retailOrderRows.filter((row) => row.payment_status === 'paid');
  const commerceCount = completedReservations.length + completedRetailOrders.length;
  const lastVisitAt = completedReservations
    .map((row) => row.start_at)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1) ?? null;

  const payload = {
    tenant_id: tenantId,
    customer_id: customerId,
    lifetime_bookings: completedReservations.length,
    last_visit: lastVisitAt,
    lifetime_value_cents: paymentCents,
    avg_spend_cents: commerceCount > 0 ? Math.round(paymentCents / commerceCount) : 0,
    outstanding_balance_cents: outstandingBalanceCents,
    repeat_interval_days: intervals.length > 0 ? averageRounded(intervals) : null,
    preferred_staff_id: preferredStaffId,
    no_show_count: noShowCount,
    cancellation_count: cancellationCount,
    last_computed_at: new Date().toISOString(),
    generated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await admin
    .from('customer_profile_summary')
    .upsert(payload, { onConflict: 'tenant_id,customer_id' });

  if (upsertError) throw upsertError;
}
