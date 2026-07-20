import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { computeCloseFromInputs, type CloseInputs } from './computeClose';

interface ReservationCloseRow {
  id: string;
  price_cents_snapshot: number | null;
  discount_cents: number | null;
  discount_reason: string | null;
}

interface RetailOrderCloseRow {
  id: string;
  total_cents: number | null;
  delivery_fee_cents: number | null;
  discount_cents: number | null;
  amount_paid_cents: number | null;
  payment_status: string | null;
}

interface TransactionCloseRow {
  subject_type: string | null;
  subject_id: string | null;
  amount: number | null;
  type: string | null;
  status: string | null;
  refund_amount: number | null;
}

export function resolveDayWindowUtc(
  businessDate: string,
  timezone: string
): { startUtc: string; endUtc: string } {
  const offsetMs = tzOffsetMs(businessDate, timezone);
  const startLocalMidnightUtc = new Date(`${businessDate}T00:00:00.000Z`).getTime() - offsetMs;
  const start = new Date(startLocalMidnightUtc);
  const end = new Date(startLocalMidnightUtc + 24 * 60 * 60 * 1000);
  return {
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  };
}

function tzOffsetMs(date: string, timezone: string): number {
  const probe = new Date(`${date}T12:00:00.000Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(formatter.formatToParts(probe).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - probe.getTime();
}

export async function computeDailyClose(
  admin: SupabaseClient,
  tenantId: string,
  businessDate: string,
  timezone: string
): Promise<{ runId: string }> {
  const { startUtc, endUtc } = resolveDayWindowUtc(businessDate, timezone);
  const inputs = await fetchInputs(admin, tenantId, startUtc, endUtc);
  const result = computeCloseFromInputs(inputs);
  const nowIso = new Date().toISOString();

  const { data: run, error: runError } = await admin
    .from('reconciliation_runs')
    .upsert(
      {
        tenant_id: tenantId,
        business_date: businessDate,
        timezone,
        status: 'computed',
        currency: 'NGN',
        expected_revenue_cents: result.expectedRevenueCents,
        adjusted_expected_cents: result.adjustedExpectedCents,
        recorded_payments_cents: result.recordedPaymentsCents,
        approved_outstanding_cents: result.approvedOutstandingCents,
        revenue_gap_cents: result.revenueGapCents,
        breakdown: result.breakdown,
        computed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'tenant_id,business_date' }
    )
    .select('id')
    .single<{ id: string }>();

  if (runError || !run) {
    throw new Error(`reconciliation upsert failed: ${runError?.message ?? 'missing run row'}`);
  }

  const { error: deleteError } = await admin.from('reconciliation_items').delete().eq('run_id', run.id);
  if (deleteError) throw deleteError;

  if (result.items.length > 0) {
    const { error: itemsError } = await admin.from('reconciliation_items').insert(
      result.items.map((item) => ({
        tenant_id: tenantId,
        run_id: run.id,
        item_type: item.itemType,
        severity: item.severity,
        entity_type: item.entityType,
        entity_id: item.entityId,
        expected_cents: item.expectedCents,
        actual_cents: item.actualCents,
        difference_cents: item.differenceCents,
        detail: item.detail,
      }))
    );
    if (itemsError) throw itemsError;
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'system',
    action: BUSINESS_EVENT_ACTIONS.RECONCILIATION_COMPUTED,
    entityType: 'reconciliation_run',
    entityId: run.id,
    source: 'system',
    metadata: {
      businessDate,
      gapCents: result.revenueGapCents,
      itemCount: result.items.length,
    },
  });

  return { runId: run.id };
}

async function fetchInputs(
  admin: SupabaseClient,
  tenantId: string,
  startUtc: string,
  endUtc: string
): Promise<CloseInputs> {
  const [{ data: reservations, error: reservationsError }, { data: orders, error: ordersError }, { data: transactions, error: transactionsError }] =
    await Promise.all([
      admin
        .from('reservations')
        .select('id, price_cents_snapshot, discount_cents, discount_reason')
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .gte('completed_at', startUtc)
        .lt('completed_at', endUtc),
      admin
        .from('retail_orders')
        .select('id, total_cents, delivery_fee_cents, discount_cents, amount_paid_cents, payment_status')
        .eq('tenant_id', tenantId)
        .eq('fulfillment_status', 'fulfilled')
        .gte('updated_at', startUtc)
        .lt('updated_at', endUtc),
      admin
        .from('transactions')
        .select('subject_type, subject_id, amount, type, status, refund_amount')
        .eq('tenant_id', tenantId)
        .gte('created_at', startUtc)
        .lt('created_at', endUtc),
    ]);

  if (reservationsError) throw reservationsError;
  if (ordersError) throw ordersError;
  if (transactionsError) throw transactionsError;

  const paidByReservation = new Map<string, number>();
  let refundsCents = 0;

  for (const transaction of (transactions ?? []) as TransactionCloseRow[]) {
    const amountCents = Math.round(Number(transaction.amount ?? 0) * 100);
    if (transaction.type === 'refund') {
      refundsCents += Math.round(Number(transaction.refund_amount ?? transaction.amount ?? 0) * 100);
      continue;
    }

    const isPaidLike =
      transaction.status === 'success' &&
      (transaction.type === 'payment' || transaction.type === 'deposit' || transaction.type === 'sale');

    if (isPaidLike && transaction.subject_type === 'reservation' && transaction.subject_id) {
      paidByReservation.set(
        transaction.subject_id,
        (paidByReservation.get(transaction.subject_id) ?? 0) + amountCents
      );
    }
  }

  return {
    completedReservations: ((reservations ?? []) as ReservationCloseRow[]).map((reservation) => ({
      id: reservation.id,
      priceSnapshotCents: Number(reservation.price_cents_snapshot ?? 0),
      discountCents: Number(reservation.discount_cents ?? 0),
      discountReason: reservation.discount_reason ?? null,
      paidCents: paidByReservation.get(reservation.id) ?? 0,
    })),
    fulfilledOrders: ((orders ?? []) as RetailOrderCloseRow[]).map((order) => ({
      id: order.id,
      totalCents: Number(order.total_cents ?? 0),
      deliveryFeeCents: Number(order.delivery_fee_cents ?? 0),
      discountCents: Number(order.discount_cents ?? 0),
      paidCents: Number(order.amount_paid_cents ?? 0),
      paymentStatus: order.payment_status ?? 'unpaid',
    })),
    refundsCents,
    creditsCents: 0,
    approvedOutstandingCents: 0,
  };
}
