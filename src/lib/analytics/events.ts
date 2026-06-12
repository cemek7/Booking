// src/lib/analytics/events.ts
export const ANALYTICS_EVENTS = {
  SIGNUP_COMPLETED: 'signup_completed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  BOOKING_CREATED: 'booking_created',
  PAYMENT_SUCCEEDED: 'payment_succeeded',
  PAYMENT_FAILED: 'payment_failed',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_CANCELED: 'subscription_canceled',
  WALLET_TOPPED_UP: 'wallet_topped_up',
  AI_CONVERSATION_HANDLED: 'ai_conversation_handled',
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
