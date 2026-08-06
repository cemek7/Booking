import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/types/roles';
import { defaultLogger } from '@/lib/logger';
import { createServiceLogger } from '@/lib/logger/service-logger';
import { emitBookingCreated } from './eventBus';
import { incrBooking } from './usageMetrics';
import { trace } from '@opentelemetry/api';
import { reservationCreationDuration, bookingCreated } from './metrics';
import DoubleBookingPrevention from './doubleBookingPrevention';
import { notifyBookingEvent } from '@/lib/integrations/notification-aggregator';
import { resolveCustomer } from '@/lib/customers/identity';
 
type ReservationActor = { id: string | null; role?: Role | null };
type ReservationConflict = { conflict_type: string };

function deriveDateParts(startAt: string, endAt: string): {
  date: string;
  time: string;
  duration: number;
} {
  const start = new Date(startAt);
  const end = new Date(endAt);

  return {
    date: startAt.slice(0, 10),
    time: start.toISOString().slice(11, 16),
    duration: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)),
  };
}

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
  customer_id?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  service_id?: string | null;
  service?: string | null;
  start_at: string;
  end_at: string;
  status?: string;
  metadata?: unknown | null;
  staff_id?: string | null;
};

type CancelReservationPayload = {
  tenant_id: string;
  reservation_id: string;
  reason?: string | null;
};

type RescheduleReservationPayload = {
  tenant_id: string;
  reservation_id: string;
  start_at: string;
  end_at: string;
  staff_id?: string | null;
  reason?: string | null;
};

/**
 * Centralized reservation creation service.
 * Performs interval-overlap detection and writes reservation + audit logs + reminders.
 * Note: for full race-safety add a DB constraint or use serializable transactions in migrations.
 */
export async function createReservation(
  supabase: SupabaseClient,
  payload: CreateReservationPayload,
  actor?: ReservationActor
): Promise<ReservationRow | null> {
  const svcLogger = createServiceLogger('ReservationService', { tenantId: payload.tenant_id });
  svcLogger.logOperationStart('createReservation', { entityType: 'reservation' });

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
      conflicts?: ReservationConflict[];
    };
    conflictError.code = 'conflict';
    conflictError.conflicts = conflictResult.conflicts as ReservationConflict[];
    span.setAttribute('reservation.conflict_count', conflictResult.conflicts.length);
    span.setAttribute(
      'reservation.conflict_types',
      (conflictResult.conflicts as ReservationConflict[]).map((c) => c.conflict_type).join(',')
    );
    throw conflictError;
  }

  const customerId = await resolveCustomerId(supabase, payload);
  const { date, time, duration } = deriveDateParts(start_at, end_at);

  const record = {
    tenant_id,
    customer_id: customerId,
    customer_number: payload.phone || null,
    service_id: payload.service_id || null,
    date,
    time,
    duration,
    start_at,
    end_at,
    status: payload.status || 'confirmed',
    metadata: payload.metadata || null,
    staff_id: payload.staff_id || null,
    tenant_staff_id: payload.staff_id || null,
  } as Record<string, unknown>;

  const { data: inserted, error: insertErr } = await supabase
    .from('reservations')
    .insert(record)
    .select('*')
    .maybeSingle();
  if (insertErr) throw insertErr;
  if (!inserted) {
    defaultLogger.warn('reservationService: insert returned no row — skipping post-insert steps');
    return null;
  }

  // Metrics: booking created
  try { bookingCreated(tenant_id); } catch {}

  // Emit booking.created event (best-effort) after successful insert.
  try {
    const row = inserted as ReservationRow;
    await emitBookingCreated(row.id, row.tenant_id, row as unknown as Record<string, unknown>);
  } catch (e) {
    defaultLogger.warn('reservationService: failed to emit booking.created event', e);
  }

  // Send booking confirmation notifications (best-effort)
  try {
    await notifyBookingEvent({
      eventType: 'confirmation',
      customer: {
        name: payload.customer_name ?? '',
        phone: payload.phone ?? undefined,
        preferences: { email: false, sms: false, whatsapp: true },
      },
      bookingDetails: {
        serviceName: payload.service ?? '',
        date: payload.start_at,
        time: payload.start_at,
        location: undefined,
      },
    });
  } catch (e) {
    defaultLogger.warn('reservationService: notification failed', e);
  }

  // Increment booking metrics (best-effort, non-fatal)
  try {
    await incrBooking(supabase, tenant_id);
  } catch (e) {
    defaultLogger.warn('reservationService: incrBooking failed', e);
  }

  // Audit log: record creation (best-effort)
  try {
    const actorObj: ReservationActor = actor ?? { id: null, role: null };
    const notes = JSON.stringify({
      customer_id: customerId,
      customer_name: payload.customer_name,
      phone: payload.phone,
      service: payload.service,
      service_id: payload.service_id,
      start_at,
      end_at,
    });
    const reservationId = (inserted as ReservationRow | null)?.id ?? null;
    await supabase.from('reservation_logs').insert({ reservation_id: reservationId, tenant_id, action: 'create', actor: actorObj, notes });
  } catch (e) {
    // non-fatal
    defaultLogger.warn('reservationService: failed to write reservation_logs', e);
  }

  // Schedule reasonable reminders (best-effort): 24h and 2h before
  try {
    if (inserted && (inserted as ReservationRow).id) {
      const rid = (inserted as ReservationRow).id;
      const start = new Date(start_at).getTime();
      const remind24 = new Date(start - 24 * 60 * 60 * 1000);
      const remind2 = new Date(start - 2 * 60 * 60 * 1000);
      const now = new Date();
      const remindersToInsert = [];
      if (remind24 > now) {
        remindersToInsert.push({ tenant_id, reservation_id: rid, remind_at: remind24.toISOString(), method: 'whatsapp', status: 'pending', raw: { reason: '24h' } });
      }
      if (remind2 > now) {
        remindersToInsert.push({ tenant_id, reservation_id: rid, remind_at: remind2.toISOString(), method: 'whatsapp', status: 'pending', raw: { reason: '2h' } });
      }
      if (remindersToInsert.length > 0) {
        await supabase.from('reminders').insert(remindersToInsert);
      }
    }
  } catch (e) {
    defaultLogger.warn('reservationService: failed to create reminders', e);
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
    defaultLogger.warn('reservationService: failed to attach service to reservation', e);
  }

  const endHr = process.hrtime.bigint();
  const durationSeconds = Number(endHr - startHr) / 1e9;
  try {
    reservationCreationDuration.observe(durationSeconds);
    span.setAttribute('duration.seconds', durationSeconds);
  } catch {}
  span.end();
  svcLogger.logOperationSuccess('createReservation', { entityId: inserted?.id, entityType: 'reservation' });
  return inserted;
}

export async function cancelReservation(
  supabase: SupabaseClient,
  payload: CancelReservationPayload,
  actor?: ReservationActor
): Promise<ReservationRow | null> {
  const { data, error } = await supabase
    .from('reservations')
    .update({
      status: 'cancelled',
      metadata: {
        cancelled_at: new Date().toISOString(),
        cancellation_reason: payload.reason ?? null,
      },
    })
    .eq('id', payload.reservation_id)
    .eq('tenant_id', payload.tenant_id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  try {
    const actorObj: ReservationActor = actor ?? { id: null, role: null };
    await supabase.from('reservation_logs').insert({
      reservation_id: payload.reservation_id,
      tenant_id: payload.tenant_id,
      action: 'cancel',
      actor: actorObj,
      notes: JSON.stringify({ reason: payload.reason ?? null }),
    });
  } catch (e) {
    defaultLogger.warn('reservationService: failed to write cancel log', e);
  }

  return data as ReservationRow;
}

export async function rescheduleReservation(
  supabase: SupabaseClient,
  payload: RescheduleReservationPayload,
  actor?: ReservationActor
): Promise<ReservationRow | null> {
  const { data: existing, error: fetchError } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', payload.reservation_id)
    .eq('tenant_id', payload.tenant_id)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!existing) return null;

  const targetStaffId =
    payload.staff_id ??
    (typeof existing.staff_id === 'string' ? existing.staff_id : null) ??
    (typeof existing.tenant_staff_id === 'string' ? existing.tenant_staff_id : null);

  const doubleBookingPrevention = new DoubleBookingPrevention(supabase);
  const conflictResult = await doubleBookingPrevention.checkBookingConflicts({
    tenantId: payload.tenant_id,
    startAt: payload.start_at,
    endAt: payload.end_at,
    resourceIds: targetStaffId ? [targetStaffId] : undefined,
    excludeReservationId: payload.reservation_id,
  });

  if (conflictResult.hasConflict) {
    const conflictError = new Error('Time slot unavailable - conflicts detected') as Error & {
      code?: string;
      conflicts?: ReservationConflict[];
    };
    conflictError.code = 'conflict';
    conflictError.conflicts = conflictResult.conflicts as ReservationConflict[];
    throw conflictError;
  }

  const metadata = {
    ...((existing.metadata as Record<string, unknown> | null) ?? {}),
    rescheduled_at: new Date().toISOString(),
    reschedule_reason: payload.reason ?? null,
  };

  const { data, error } = await supabase
    .from('reservations')
    .update({
      start_at: payload.start_at,
      end_at: payload.end_at,
      staff_id: targetStaffId,
      tenant_staff_id: targetStaffId,
      metadata,
    })
    .eq('id', payload.reservation_id)
    .eq('tenant_id', payload.tenant_id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  try {
    const actorObj: ReservationActor = actor ?? { id: null, role: null };
    await supabase.from('reservation_logs').insert({
      reservation_id: payload.reservation_id,
      tenant_id: payload.tenant_id,
      action: 'reschedule',
      actor: actorObj,
      notes: JSON.stringify({
        reason: payload.reason ?? null,
        previous_start_at: existing.start_at ?? null,
        previous_end_at: existing.end_at ?? null,
        start_at: payload.start_at,
        end_at: payload.end_at,
      }),
    });
  } catch (e) {
    defaultLogger.warn('reservationService: failed to write reschedule log', e);
  }

  return data as ReservationRow;
}

async function resolveCustomerId(
  supabase: SupabaseClient,
  payload: CreateReservationPayload
): Promise<string | null> {
  if (payload.customer_id) return payload.customer_id;
  try {
    return await resolveCustomer(supabase, payload.tenant_id, payload.phone, {
      name: payload.customer_name ?? payload.phone ?? null,
      source: 'reservation_service',
    });
  } catch (error) {
    defaultLogger.warn('reservationService: failed to resolve customer link', error);
    return null;
  }
}

const serviceExports = { createReservation, cancelReservation, rescheduleReservation };
export default serviceExports;
