import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace } from '@opentelemetry/api';
import { createHash } from 'crypto';

export type EventPayload = Record<string, unknown> | null;

export interface EmitOptions {
  supabase: SupabaseClient;
  event: string;
  payload: EventPayload;
  tenant_id?: string | null;
  location_id?: string | null;
  version?: string;
}

/**
 * publishEvent: idempotent event publishing via outbox pattern.
 * All events go through event_outbox first with hash-based deduplication.
 */
export async function publishEvent(opts: EmitOptions) {
  const { supabase, event, payload, tenant_id = null, location_id = null, version = '1.0.0' } = opts;
  const tracer = trace.getTracer('boka');
  const span = tracer.startSpan('event.publish', { attributes: { 'event.type': event, 'tenant.id': tenant_id ?? 'none' } });
  
  // Generate deterministic hash for idempotency
  const hashInput = JSON.stringify({
    type: event,
    tenant_id: tenant_id || null,
    payload: payload || null
  });
  const hash = createHash('sha256').update(hashInput).digest('hex');
  
  try {
    // Try to insert into outbox first (idempotent via unique hash constraint)
    const outboxRow = {
      type: event,
      tenant_id,
      location_id,
      payload: payload || null,
      hash
    };
    
    const outboxRes = await supabase.from('event_outbox').insert(outboxRow).select('id');
    if (outboxRes.error) {
      // Check if it's a uniqueness violation (duplicate hash)
      if (outboxRes.error.code === '23505' && outboxRes.error.message?.includes('hash')) {
        span.setAttribute('event.duplicate', true);
        span.setAttribute('event.hash', hash);
        return null; // Event already exists, skip gracefully
      }
      throw outboxRes.error;
    }
    
    span.setAttribute('event.outbox_id', outboxRes.data[0].id);
    span.setAttribute('event.hash', hash);
    span.setAttribute('event.persisted', true);
    
    return outboxRes.data;
  } catch (e) {
    console.warn('[eventBus] failed to publish to outbox', event, e);
    span.setAttribute('event.persisted', false);
    return null;
  } finally {
    span.end();
  }
}

/**
 * Emit booking.created event using PRD contract shape (subset).
 */
export async function emitBookingCreated(supabase: SupabaseClient, booking: Record<string, any>) {
  if (!booking) return;
  const payload = {
    booking_id: booking.id ?? null,
    tenant_id: booking.tenant_id ?? null,
    location_id: booking.location_id ?? null,
    service: booking.service ?? null,
    start: booking.start_at ?? null,
    end: booking.end_at ?? null,
    status: booking.status ?? null,
    metadata: booking.metadata ?? null,
  } as Record<string, unknown>;
  await publishEvent({ supabase, event: 'booking.created', payload, tenant_id: booking.tenant_id ?? null, location_id: booking.location_id ?? null });
}

export default { publishEvent, emitBookingCreated };
