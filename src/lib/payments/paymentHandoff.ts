import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { SettlementFailureCode } from './tenantSettlement';

/**
 * When a deposit cannot be collected (settlement not configured / disabled /
 * provider failure), the reservation stays `pending`, a teammate is asked to
 * arrange payment, and auto-cancel leaves it alone (owner decision 2026-10-02).
 * Staff resolve it by confirming or cancelling the reservation.
 */
export const PAYMENT_HANDOFF_CUSTOMER_MESSAGE =
  "Your booking request is saved. We couldn't create a payment link right now, so a team member will message you here to arrange your deposit.";

export interface PaymentHandoffStore {
  loadMetadata(tenantId: string, reservationId: string): Promise<Record<string, unknown> | null>;
  saveMetadata(tenantId: string, reservationId: string, metadata: Record<string, unknown>): Promise<void>;
  insertEscalation(row: Record<string, unknown>): Promise<void>;
}

export function isPaymentHandoffOpen(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const handoff = (metadata as Record<string, unknown>).payment_handoff;
  return Boolean(handoff && typeof handoff === 'object' && (handoff as Record<string, unknown>).status === 'open');
}

export async function openReservationPaymentHandoff(
  input: { tenantId: string; reservationId: string; reason: SettlementFailureCode; customerPhone: string | null; threadId?: string | null },
  store: PaymentHandoffStore = defaultStore(),
): Promise<void> {
  const metadata = (await store.loadMetadata(input.tenantId, input.reservationId)) ?? {};
  await store.saveMetadata(input.tenantId, input.reservationId, {
    ...metadata,
    payment_handoff: { status: 'open', reason: input.reason, opened_at: new Date().toISOString() },
  });
  try {
    await store.insertEscalation({
      tenant_id: input.tenantId,
      customer_phone: input.customerPhone ?? `reservation:${input.reservationId}`,
      session_id: `reservation:${input.reservationId}`,
      conversation_thread_id: input.threadId ?? null,
      reason: 'Deposit link could not be created; a teammate must arrange payment',
      reason_code: 'payment_settlement',
      status: 'pending',
    });
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
  }
}

function defaultStore(): PaymentHandoffStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadMetadata(tenantId, reservationId) {
      const { data, error } = await admin.from('reservations').select('metadata').eq('tenant_id', tenantId).eq('id', reservationId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.metadata as Record<string, unknown> | null) ?? null;
    },
    async saveMetadata(tenantId, reservationId, metadata) {
      const { error } = await admin.from('reservations').update({ metadata }).eq('tenant_id', tenantId).eq('id', reservationId);
      if (error) throw new Error(error.message);
    },
    async insertEscalation(row) {
      const { error } = await admin.from('escalation_queue').insert(row);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    },
  };
}
