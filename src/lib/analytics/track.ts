// src/lib/analytics/track.ts
import posthog from 'posthog-js';
import { hasAnalyticsConsent } from '@/lib/consent/consentStore';
import type { AnalyticsEvent } from './events';

/**
 * Capture a product-analytics event. No-ops on the server, and on the client
 * unless the user has explicitly granted analytics consent.
 */
export function capture(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;
  posthog.capture(event, properties);
}
