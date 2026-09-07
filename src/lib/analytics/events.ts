// Canonical Booka product/business analytics events.
// These names are stable enough to drive PostHog funnels and
// the app's own analytics_events table without UI-specific noise.
export const ANALYTICS_EVENTS = {
  TENANT_CREATED: 'tenant_created',
  TENANT_ONBOARDING_STARTED: 'tenant_onboarding_started',
  TENANT_ONBOARDING_COMPLETED: 'tenant_onboarding_completed',
  WHATSAPP_CONNECTED: 'whatsapp_connected',
  FIRST_CUSTOMER_MESSAGE_RECEIVED: 'first_customer_message_received',
  BOOKING_FLOW_STARTED: 'booking_flow_started',
  SERVICE_SELECTED: 'service_selected',
  SLOT_PRESENTED: 'slot_presented',
  SLOT_SELECTED: 'slot_selected',
  BOOKING_COMPLETED: 'booking_completed',
  BOOKING_FAILED: 'booking_failed',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_RESCHEDULED: 'booking_rescheduled',
  REMINDER_SENT: 'reminder_sent',
  REMINDER_DELIVERED: 'reminder_delivered',
  OWNER_COMMAND_USED: 'owner_command_used',
  HUMAN_HANDOFF_REQUESTED: 'human_handoff_requested',
  PAYMENT_REQUESTED: 'payment_requested',
  PAYMENT_SUCCEEDED: 'payment_succeeded',
  PAYMENT_FAILED: 'payment_failed',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_CANCELED: 'subscription_canceled',
  WALLET_TOPPED_UP: 'wallet_topped_up',
  OPERATING_LOOP_VIEWED: 'operating_loop_viewed',
  OPERATING_OBJECTIVE_EXECUTED: 'operating_objective_executed',
  OPERATING_OBJECTIVE_DELIVERY_OUTCOME: 'operating_objective_delivery_outcome',
  OPERATING_OBJECTIVE_DEFERRED: 'operating_objective_deferred',
  OPERATING_OBJECTIVE_DISMISSED: 'operating_objective_dismissed',
  OPERATING_ONBOARDING_READINESS_UPDATED: 'operating_onboarding_readiness_updated',
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type AnalyticsChannel = 'whatsapp' | 'instagram' | 'web' | 'system';

export type AnalyticsFlow =
  | 'activation'
  | 'booking'
  | 'cancellation'
  | 'reschedule'
  | 'owner_command'
  | 'payment'
  | 'support'
  | 'retention';

export type AnalyticsProvider =
  | 'meta'
  | 'waha'
  | 'evolution'
  | 'cloudflare'
  | 'openrouter'
  | 'gemini'
  | 'paystack'
  | 'stripe'
  | 'supabase'
  | 'system';

export interface AnalyticsEventProperties {
  tenant_id: string;
  tenant_plan?: string | null;
  business_category?: string | null;
  channel?: AnalyticsChannel | null;
  flow?: AnalyticsFlow | null;
  provider?: AnalyticsProvider | null;
  flow_version?: string | null;
  ai_layer_used?: string | null;
  service_id?: string | null;
  reservation_id?: string | null;
  customer_id?: string | null;
  staff_id?: string | null;
  failure_reason?: string | null;
  message_turn_count?: number | null;
  time_to_complete_seconds?: number | null;
  staff_count?: number | null;
  metadata?: Record<string, unknown>;
}
