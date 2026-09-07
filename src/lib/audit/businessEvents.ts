import type { SupabaseClient } from '@supabase/supabase-js';
import { processBusinessEventForAnomalies } from '@/lib/anomalies/realtimeSubscriber';
import { processBusinessEventForCustomerProfile } from '@/lib/customers/profileSubscriber';

// Canonical action vocabulary lives in a dependency-free leaf module to avoid an
// import cycle (businessEvents -> subscribers -> rules -> action constants).
// Re-exported here so existing `from '@/lib/audit/businessEvents'` imports work.
export { BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEventActions';
export type { BusinessEventAction } from '@/lib/audit/businessEventActions';

/** Serialize a subscriber error — PostgREST errors are plain objects (message/code/details), not Error instances. */
function describeSubscriberError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; details?: unknown };
    if (e.message || e.code || e.details) {
      return [e.code && `[${e.code}]`, e.message, e.details].filter(Boolean).join(' ');
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

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
          error: describeSubscriberError(subscriberError),
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
          error: describeSubscriberError(subscriberError),
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
