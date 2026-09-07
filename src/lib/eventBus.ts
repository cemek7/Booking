/**
 * eventBus.ts — legacy compatibility facade
 *
 * Canonical implementation:
 * `src/lib/eventbus/eventBus.ts`
 *
 * Keep this file only for older imports and helpers that have not yet been
 * migrated. New code should import `getEventBus()` from the canonical module.
 */
export {
  EventBusService,
  getEventBus,
} from './eventbus/eventBus';

export type {
  Event,
  OutboxEvent,
  EventHandler,
} from './eventbus/eventBus';

import { EventBusService, getEventBus } from './eventbus/eventBus';
import type { SupabaseClient } from '@supabase/supabase-js';

interface PublishEventOptions {
  supabase?: SupabaseClient;
  event: string;
  payload: Record<string, unknown>;
  tenantId?: string;
}

/**
 * Publish a generic event via the EventBus.
 * Accepts the legacy object signature: { supabase?, event, payload, tenantId? }
 *
 * When a `supabase` client is supplied (as the payment/scheduling/security
 * services do), the event is published through THAT client rather than the
 * shared singleton's request-scoped client. Previously the injected client was
 * silently ignored, so events raised from background/service contexts — where
 * the singleton's cookie-based client cannot read a request — were dropped.
 */
export async function publishEvent(options: PublishEventOptions): Promise<null | void> {
  try {
    const { event: eventType, payload, tenantId, supabase } = options;
    const aggregateId = (payload.id as string) ?? 'system';
    const aggregateType = eventType.split('.')[0] ?? 'system';
    const bus = supabase ? new EventBusService({}, supabase) : getEventBus();
    await bus.publishEvent(aggregateId, aggregateType, eventType, payload, { tenantId });
  } catch {
    return null;
  }
}

/**
 * Legacy helper used by reservationService.ts
 */
export async function emitBookingCreated(
  bookingId: string,
  tenantId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await publishEvent({ event: 'booking.created', payload: { bookingId, ...payload }, tenantId });
}
