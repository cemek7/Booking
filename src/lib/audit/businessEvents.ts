import type { SupabaseClient } from '@supabase/supabase-js';
import { processBusinessEventForAnomalies } from '@/lib/anomalies/realtimeSubscriber';
import { processBusinessEventForCustomerProfile } from '@/lib/customers/profileSubscriber';

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
  STOCK_COUNT_APPROVED: 'stock_count.approved',
  RETAIL_SALE_RECORDED: 'retail_sale.recorded',
  EXPENSE_RECORDED: 'expense.recorded',
  PURCHASE_RECORDED: 'purchase.recorded',
  SUPPLIER_PAYMENT_RECORDED: 'supplier_payment.recorded',
  STOCK_RECEIPT_RECORDED: 'stock_receipt.recorded',
  ORDER_REFUNDED: 'order.refunded',
  OUTSTANDING_BALANCE_RECORDED: 'outstanding_balance.recorded',
  RETAIL_ORDER_CREATED: 'retail_order.created',
  ORDER_CANCELLED: 'order.cancelled',
  CUSTOMER_NOTE_ADDED: 'customer.note_added',
  CUSTOMER_TAGGED: 'customer.tagged',
  CUSTOMER_MERGED: 'customer.merged',
  STAFF_PERMISSION_CHANGED: 'staff.permission_changed',
  COMMAND_DENIED: 'command.denied',
  ACCESS_DENIED: 'access.denied',
  ANOMALY_DETECTED: 'anomaly.detected',
  ANOMALY_RESOLVED: 'anomaly.resolved',
  ANOMALY_REVIEWED: 'anomaly.reviewed',
  ANOMALY_ALERTED: 'anomaly.alerted',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  APPROVAL_ALERTED: 'approval.alerted',
  SERVICE_CONSUMPTION_RECORDED: 'service.consumption_recorded',
  CAPTURE_CONFIRMED: 'capture.confirmed',
  RECOMMENDATION_ACCEPTED: 'recommendation.accepted',
  RECOMMENDATION_DISMISSED: 'recommendation.dismissed',
  RECOMMENDATION_SNOOZED: 'recommendation.snoozed',
  RECOMMENDATION_ALERTED: 'recommendation.alerted',
  RECOMMENDATION_OUTCOME_RECORDED: 'recommendation.outcome_recorded',
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
    const payload = {
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
    };
    const { data, error } = await admin
      .from('business_events')
      .insert(payload)
      .select('tenant_id, action, entity_type, entity_id, created_at, metadata')
      .single<{
        tenant_id: string;
        action: string;
        entity_type?: string | null;
        entity_id?: string | null;
        created_at?: string | null;
        metadata?: Record<string, unknown> | null;
      }>();

    if (error) {
      console.warn('[businessEvents] write failed', {
        tenantId: event.tenantId,
        action: event.action,
        error: error.message,
      });
      return;
    }

    if (data) {
      processBusinessEventForAnomalies(admin, {
        tenantId: data.tenant_id,
        action: data.action,
        entityType: data.entity_type ?? null,
        entityId: data.entity_id ?? null,
        createdAt: data.created_at ?? null,
        metadata: data.metadata ?? null,
      }).catch((subscriberError) => {
        console.warn('[businessEvents] anomaly subscriber failed', {
          tenantId: event.tenantId,
          action: event.action,
          error:
            subscriberError instanceof Error
              ? subscriberError.message
              : String(subscriberError),
        });
      });

      processBusinessEventForCustomerProfile(admin, {
        tenantId: data.tenant_id,
        action: data.action,
        entityType: data.entity_type ?? null,
        entityId: data.entity_id ?? null,
      }).catch((subscriberError) => {
        console.warn('[businessEvents] customer profile subscriber failed', {
          tenantId: event.tenantId,
          action: event.action,
          error:
            subscriberError instanceof Error
              ? subscriberError.message
              : String(subscriberError),
        });
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
