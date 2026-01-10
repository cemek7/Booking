import { createServerSupabaseClient } from '@/lib/supabase/server';
import { emitBookingCreated } from './eventBus';
import { incrBooking } from './usageMetrics';
import { trace } from '@opentelemetry/api';
import { reservationCreationDuration, bookingCreated } from './metrics';
import DoubleBookingPrevention from './doubleBookingPrevention';


interface ReservationRow {
  id: string;
  tenant_id: string;
  start_at: string;
  end_at: string;
  status: string;
  service?: string | null;
  metadata?: unknown | null;
  location_id?: string | null;
  [key: string]: unknown;
}

type CreateReservationPayload = {
  tenant_id: string;
  customer_name?: string | null;
  phone?: string | null;
  service?: string | null;
  start_at: string;
  end_at: string;
  status?: string;
  metadata?: unknown | null;
  staff_id?: string | null;
};

/**
 * Centralized reservation creation service.
 * Performs interval-overlap detection and writes reservation + audit logs + reminders.
 * Note: for full race-safety add a DB constraint or use serializable transactions in migrations.
 */
import { Role } from '@/types/roles';
import { assertRole } from '@/types/type-safe-rbac';

export async function createReservation(supabase: SupabaseClient, payload: CreateReservationPayload, actor?: { id: string; role?: Role | null }) {
  const tracer = trace.getTracer('boka');
  const span = tracer.startSpan('reservation.create', {
    attributes: {
      'tenant.id': payload.tenant_id,
      'reservation.start_at': payload.start_at,
      'reservation.end_at': payload.end_at,
      'reservation.service': payload.service || 'unknown'
    }
  });
  const startHr = process.hrtime.bigint();
  if (!supabase) throw new Error('supabase client required');
  const { tenant_id, start_at, end_at } = payload;
  if (!tenant_id) throw new Error('tenant_id required');
  if (!start_at) throw new Error('start_at required');
  if (!end_at) throw new Error('end_at required');

  // Enhanced conflict detection with double-booking prevention
  const doubleBookingPrevention = new DoubleBookingPrevention(supabase);
  
  // Check for conflicts using advanced detection
  const conflictResult = await doubleBookingPrevention.checkBookingConflicts({
    tenantId: tenant_id,
    startAt: start_at,
    endAt: end_at,
    resourceIds: payload.staff_id ? [payload.staff_id] : undefined,
  });
  
  if (conflictResult.hasConflict) {
    const conflictError = new Error('Time slot unavailable - conflicts detected') as Error & { 
      code?: string; 
      conflicts?: typeof conflictResult.conflicts;
    };
    conflictError.code = 'conflict';
    conflictError.conflicts = conflictResult.conflicts;
    span.setAttribute('reservation.conflict_count', conflictResult.conflicts.length);
    span.setAttribute('reservation.conflict_types', conflictResult.conflicts.map(c => c.conflict_type).join(','));
    throw conflictError;
  }

  const record = {
    tenant_id,
    customer_name: payload.customer_name || null,
    phone: payload.phone || null,
    service: payload.service || null,
    start_at,
    end_at,
    status: payload.status || 'confirmed',
    metadata: payload.metadata || null,
    staff_id: payload.staff_id || null,
  } as Record<string, unknown>;

  const { data: inserted, error: insertErr } = await supabase.from('reservations').insert(record).select('*').maybeSingle();
  if (insertErr) throw insertErr;

  // Metrics: booking created
  try { bookingCreated(tenant_id); } catch {}

  // Emit booking.created event (best-effort) after successful insert.
  try {
    await emitBookingCreated(supabase, inserted as ReservationRow);
  } catch (e) {
    console.warn('reservationService: failed to emit booking.created event', e);
  }

  // Increment booking metrics (best-effort, non-fatal)
  try {
    await incrBooking(supabase, tenant_id);
  } catch (e) {
    console.warn('reservationService: incrBooking failed', e);
  }

  // Audit log: record creation (best-effort)
  try {
    const actorObj = actor ?? { id: null, role: null };
    const notes = JSON.stringify({ customer_name: payload.customer_name, phone: payload.phone, service: payload.service, start_at, end_at });
    const reservationId = (inserted as ReservationRow | null)?.id ?? null;
    await supabase.from('reservation_logs').insert({ reservation_id: reservationId, tenant_id, action: 'create', actor: actorObj, notes });
  } catch (e) {
    // non-fatal
    console.warn('reservationService: failed to write reservation_logs', e);
  }

  // Schedule reasonable reminders (best-effort): 24h and 2h before
  try {
    if (inserted && (inserted as ReservationRow).id) {
      const rid = (inserted as ReservationRow).id;
      const start = new Date(start_at).getTime();
      const remind24 = new Date(start - 24 * 60 * 60 * 1000).toISOString();
      const remind2 = new Date(start - 2 * 60 * 60 * 1000).toISOString();
      await supabase.from('reminders').insert([
        { tenant_id, reservation_id: rid, remind_at: remind24, method: 'whatsapp', status: 'pending', raw: { reason: '24h' } },
        { tenant_id, reservation_id: rid, remind_at: remind2, method: 'whatsapp', status: 'pending', raw: { reason: '2h' } },
      ]);
    }
  } catch (e) {
    console.warn('reservationService: failed to create reminders', e);
  }

  // Attach service to reservation if service_id provided (reservation_services join table)
  try {
    const insertedId = inserted && (inserted as { id?: string }).id ? (inserted as { id: string }).id : null;
    const payloadTyped = payload as { service_id?: string; service?: string };
    const serviceId = payloadTyped.service_id || (typeof payloadTyped.service === 'string' && /^[0-9a-fA-F-]{36}$/.test(payloadTyped.service) ? payloadTyped.service : null);
    if (insertedId && serviceId) {
      await supabase.from('reservation_services').insert([{ reservation_id: insertedId, service_id: serviceId, tenant_id, customer_id: null, quantity: 1 }]);
    }
  } catch (e) {
    console.warn('reservationService: failed to attach service to reservation', e);
  }

  const endHr = process.hrtime.bigint();
  const durationSeconds = Number(endHr - startHr) / 1e9;
  try {
    reservationCreationDuration.observe(durationSeconds);
    span.setAttribute('duration.seconds', durationSeconds);
  } catch {}
  span.end();
  return inserted;
}

const serviceExports = { createReservation };
export default serviceExports;
