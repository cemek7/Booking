import type { SupabaseClient } from '@supabase/supabase-js';
import { getReconcileDriftPct, resolveMessageCostCredits } from '@/lib/billing/messageRates';

const CHARGES_TABLE = 'whatsapp_message_charges';

export interface ReconciliationSummary {
  month: string;                 // 'YYYY-MM'
  billableMessages: number;
  settledCredits: number;
  releasedMessages: number;
  freeMessages: number;
  byCategory: Record<string, number>;
}

export interface StrandedReservation {
  chargeId: string;
  tenantId: string;
  walletReservationId: string;
  reservedCredits: number;
  sentAt: string;
}

type ChargeRow = {
  billable?: boolean | null;
  settled_credits?: number | string | null;
  status?: string | null;
  pricing_category?: string | null;
};

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function zeroed(month: string): ReconciliationSummary {
  return {
    month,
    billableMessages: 0,
    settledCredits: 0,
    releasedMessages: 0,
    freeMessages: 0,
    byCategory: {},
  };
}

/**
 * Aggregates one month of message charges for comparison against Meta's invoice.
 *
 * Only `mode = 'live'` rows count. Shadow rows record volume for calibration but
 * are not revenue, and mixing them would make every reconciliation look wrong
 * for the first month after the cutover.
 */
export async function buildMonthlyReconciliation(
  admin: SupabaseClient,
  month: string,
): Promise<ReconciliationSummary> {
  const { start, end } = monthBounds(month);

  const { data, error } = await admin
    .from(CHARGES_TABLE)
    .select('billable, settled_credits, status, pricing_category')
    .eq('mode', 'live')
    .gte('sent_at', start)
    .lt('sent_at', end);

  if (error) {
    // A reconciliation report that throws is a report nobody reads. Return a
    // zeroed summary and let the caller's drift check flag the impossible
    // result, rather than taking down the whole monthly job.
    console.error('[messageReconciliation] monthly query failed', { month, error });
    return zeroed(month);
  }

  const summary = zeroed(month);

  for (const row of (data ?? []) as ChargeRow[]) {
    if (row.status === 'released') {
      summary.releasedMessages += 1;
      continue;
    }

    if (row.billable) {
      summary.billableMessages += 1;
      summary.settledCredits += Number(row.settled_credits ?? 0);
      const category = row.pricing_category ?? 'unknown';
      summary.byCategory[category] = (summary.byCategory[category] ?? 0) + 1;
    } else {
      summary.freeMessages += 1;
    }
  }

  // Float addition of NUMERIC(20,6) values accumulates representation error over
  // thousands of rows; round to the column's own precision.
  summary.settledCredits = Number(summary.settledCredits.toFixed(6));

  return summary;
}

/**
 * Compares what Booka metered against what Meta actually invoiced.
 *
 * Drift is the signal that the provisional Nigeria rate, or Booka's model of
 * which messages are billable, has diverged from reality.
 */
export function evaluateDrift(
  summary: ReconciliationSummary,
  metaReportedCost: number,
): { driftPct: number; withinTolerance: boolean } {
  const expected = summary.billableMessages * resolveMessageCostCredits();
  const tolerance = getReconcileDriftPct();

  if (expected === 0) {
    // No billable messages: any non-zero invoice is 100% unexplained, and a
    // zero invoice is a perfect match. Guarding the denominator here is what
    // keeps this from returning NaN, which would compare false against every
    // tolerance and silently read as "within".
    const driftPct = metaReportedCost === 0 ? 0 : 100;
    return { driftPct, withinTolerance: metaReportedCost === 0 };
  }

  const driftPct = Math.abs((metaReportedCost - expected) / expected) * 100;
  return { driftPct, withinTolerance: driftPct <= tolerance };
}

/**
 * Finds charge rows holding a wallet reservation that the stale-reservation
 * sweeper structurally cannot see.
 *
 * The sweeper filters `wamid IS NOT NULL`, and that filter is correct:
 * `settle_ai_wallet_spend` is not idempotent, so sweeping a row whose
 * reservation was already settled would refund the tenant twice. The cost of
 * that correctness is a blind spot — a row can sit at `status='reserved'` with
 * a NULL wamid and a live reservation, and nothing automatic will ever free it.
 * Two known paths get there: `attachWamid`'s orphan merge deleting the orphan
 * and then failing to settle, and the process dying between a successful
 * reservation and either `attachWamid` or `abandonCharge`.
 *
 * This REPORTS ONLY. It must never auto-release. A row that settled
 * successfully but failed its final update is indistinguishable at the row
 * level from one that never settled — both read `status='reserved'`,
 * `settled_credits = 0` — so auto-releasing would double-refund precisely the
 * case this query exists to catch. A human resolves each one against
 * `ai_wallet_ledger`.
 */
export async function findStrandedReservations(
  admin: SupabaseClient,
  olderThanMs: number,
): Promise<StrandedReservation[]> {
  const cutoffIso = new Date(Date.now() - olderThanMs).toISOString();

  const { data, error } = await admin
    .from(CHARGES_TABLE)
    .select('id, tenant_id, wallet_reservation_id, reserved_credits, sent_at')
    .eq('status', 'reserved')
    .is('wamid', null)
    .not('wallet_reservation_id', 'is', null)
    .lt('sent_at', cutoffIso);

  if (error) {
    console.error('[messageReconciliation] stranded-reservation query failed', { error });
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    chargeId: String(row.id),
    tenantId: String(row.tenant_id),
    walletReservationId: String(row.wallet_reservation_id),
    reservedCredits: Number(row.reserved_credits ?? 0),
    sentAt: String(row.sent_at),
  }));
}
