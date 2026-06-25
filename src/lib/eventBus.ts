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

import { getEventBus } from './eventbus/eventBus';

interface PublishEventOptions {
  supabase?: unknown;
  event: string;
  payload: Record<string, unknown>;
  tenantId?: string;
}

/**
 * Publish a generic event via the shared EventBus instance.
 * Accepts the legacy object signature: { supabase?, event, payload, tenantId? }
 */
export async function publishEvent(options: PublishEventOptions): Promise<null | void> {
  try {
    const { event: eventType, payload, tenantId } = options;
    const aggregateId = (payload.id as string) ?? 'system';
    const aggregateType = eventType.split('.')[0] ?? 'system';
    const bus = getEventBus();
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
