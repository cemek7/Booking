import type { SupabaseClient } from '@supabase/supabase-js';

export const BUSINESS_EVENT_ACTIONS = {
  RESERVATION_COMPLETED: 'reservation.completed',
  PAYMENT_RECORDED: 'payment.recorded',
  RECONCILIATION_COMPUTED: 'reconciliation.computed',
  RECONCILIATION_DELIVERED: 'reconciliation.delivered',
  RETAIL_ORDER_DELIVERED: 'retail_order.delivered',
  DISCOUNT_APPLIED: 'discount.applied',
  PRODUCT_STOCK_ADJUSTED: 'product.stock_adjusted',
  PRODUCT_PRICE_CHANGED: 'product.price_changed',
  PRODUCT_ADDED: 'product.added',
  PRODUCT_AVAILABILITY_CHANGED: 'product.availability_changed',
  STOCK_DAMAGED: 'stock.damaged',
  STOCK_RESTOCKED: 'stock.restocked',
  STOCK_TRANSFERRED: 'stock.transferred',
  STOCK_COUNT_RECORDED: 'stock.count_recorded',
} as const;

export type BusinessEventActorType = 'user' | 'staff' | 'customer' | 'ai' | 'system';
export type BusinessEventSource = 'whatsapp' | 'dashboard' | 'api' | 'system';

export interface BusinessEventInput {
  tenantId: string;
  actorType: BusinessEventActorType;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  source?: BusinessEventSource;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** Best-effort business event write. Never throws — timeline logging must not break the action it records. */
export async function recordBusinessEvent(
  admin: SupabaseClient,
  event: BusinessEventInput
): Promise<void> {
  try {
    const { error } = await admin.from('business_events').insert({
      tenant_id: event.tenantId,
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      action: event.action,
      entity_type: event.entityType ?? null,
      entity_id: event.entityId ?? null,
      source: event.source ?? 'system',
      before: event.before ?? null,
      after: event.after ?? null,
      reason: event.reason ?? null,
      metadata: event.metadata ?? {},
    });

    if (error) {
      console.warn('[businessEvents] write failed', {
        tenantId: event.tenantId,
        action: event.action,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn('[businessEvents] write threw', {
      tenantId: event.tenantId,
      action: event.action,
      error,
    });
  }
}
