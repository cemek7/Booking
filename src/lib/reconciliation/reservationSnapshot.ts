import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';

interface ReservationServiceLine {
  service_id: string;
  quantity: number | null;
}

interface ServicePriceRow {
  id: string;
  price_cents: number | null;
}

interface LegacyReservationRow {
  service_id: string | null;
}

/** Sum services.price_cents × reservation_services.quantity over a reservation's lines. */
export async function snapshotReservationTotalCents(
  admin: SupabaseClient,
  tenantId: string,
  reservationId: string
): Promise<number> {
  const { data: lines, error: linesError } = await admin
    .from('reservation_services')
    .select('service_id, quantity')
    .eq('tenant_id', tenantId)
    .eq('reservation_id', reservationId);

  if (linesError) throw linesError;

  let serviceLines: Array<{ service_id: string; quantity: number }> = (lines ?? []).map(
    (line: ReservationServiceLine) => ({
      service_id: line.service_id,
      quantity: line.quantity ?? 1,
    })
  );

  if (serviceLines.length === 0) {
    const { data: reservation, error: reservationError } = await admin
      .from('reservations')
      .select('service_id')
      .eq('tenant_id', tenantId)
      .eq('id', reservationId)
      .maybeSingle<LegacyReservationRow>();

    if (reservationError) throw reservationError;
    if (reservation?.service_id) {
      serviceLines = [{ service_id: reservation.service_id, quantity: 1 }];
    }
  }

  if (serviceLines.length === 0) return 0;

  const serviceIds = [...new Set(serviceLines.map((line) => line.service_id))];
  const { data: services, error: servicesError } = await admin
    .from('services')
    .select('id, price_cents')
    .eq('tenant_id', tenantId)
    .in('id', serviceIds);

  if (servicesError) throw servicesError;

  const priceById = new Map(
    (services ?? []).map((service: ServicePriceRow) => [service.id, Number(service.price_cents ?? 0)])
  );

  return serviceLines.reduce((sum, line) => {
    return sum + (priceById.get(line.service_id) ?? 0) * (line.quantity ?? 1);
  }, 0);
}

/** Freeze revenue inputs exactly when a reservation transitions to completed. */
export async function markReservationCompleted(
  admin: SupabaseClient,
  tenantId: string,
  reservationId: string,
  actorId: string | null
): Promise<void> {
  const total = await snapshotReservationTotalCents(admin, tenantId, reservationId);
  const nowIso = new Date().toISOString();

  const { error } = await admin
    .from('reservations')
    .update({
      status: 'completed',
      completed_at: nowIso,
      price_cents_snapshot: total,
    })
    .eq('tenant_id', tenantId)
    .eq('id', reservationId);

  if (error) throw error;

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: actorId ? 'user' : 'system',
    actorId,
    action: BUSINESS_EVENT_ACTIONS.RESERVATION_COMPLETED,
    entityType: 'reservation',
    entityId: reservationId,
    source: 'api',
    after: {
      status: 'completed',
      price_cents_snapshot: total,
    },
  });
}
