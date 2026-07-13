import { createSupabaseAdminClient } from '@/lib/supabase/server';

export type FrontDeskEventType =
  | 'inquiry_received'
  | 'lead_created'
  | 'lead_qualified'
  | 'quote_sent'
  | 'offer_sent'
  | 'upsell_sent'
  | 'cross_sell_sent'
  | 'upsell_accepted'
  | 'cross_sell_accepted'
  | 'follow_up_scheduled'
  | 'follow_up_sent'
  | 'recovery_sent'
  | 'booking_created'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'booking_no_show'
  | 'showcase_sent'
  | 'catalog_sent'
  | 'recommendation_sent'
  | 'handoff_requested'
  | 'payment_requested'
  | 'payment_completed'
  | 'payment_failed'
  | 'payment_refunded';

export type FrontDeskEventCategory =
  | 'conversation'
  | 'lead'
  | 'sales'
  | 'booking'
  | 'retention'
  | 'payment'
  | 'support';

export async function recordFrontDeskEvent(input: {
  tenantId: string;
  eventType: FrontDeskEventType;
  eventCategory: FrontDeskEventCategory;
  channel?: string | null;
  actorRole?: string | null;
  actorId?: string | null;
  customerId?: string | null;
  reservationId?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  campaignRunId?: string | null;
  messageId?: string | null;
  correlationId?: string | null;
  amount?: number | null;
  currency?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    await supabaseAdmin
      .from('ai_front_desk_events')
      .insert({
        tenant_id: input.tenantId,
        event_type: input.eventType,
        event_category: input.eventCategory,
        channel: input.channel ?? null,
        actor_role: input.actorRole ?? null,
        actor_id: input.actorId ?? null,
        customer_id: input.customerId ?? null,
        reservation_id: input.reservationId ?? null,
        service_id: input.serviceId ?? null,
        staff_id: input.staffId ?? null,
        campaign_run_id: input.campaignRunId ?? null,
        message_id: input.messageId ?? null,
        correlation_id: input.correlationId ?? null,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        status_from: input.statusFrom ?? null,
        status_to: input.statusTo ?? null,
        metadata: input.metadata ?? {},
      });
  } catch {
    // best effort only; operational capture should not break customer flow
  }
}
