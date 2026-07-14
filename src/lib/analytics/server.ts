import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import { ANALYTICS_EVENTS, type AnalyticsEvent, type AnalyticsEventProperties } from './events';

const POSTHOG_CAPTURE_PATH = '/capture/';
const SENSITIVE_KEY_PATTERN = /(phone|message|token|secret|authorization|password|cookie|email|notes?|body)/i;

type AnalyticsInsertRow = {
  tenant_id: string;
  event_type: string;
  customer_id?: string | null;
  reservation_id?: string | null;
  metadata: Record<string, unknown>;
};

export function sanitizeAnalyticsPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAnalyticsPayload(entry));
  }

  if (value && typeof value === 'object') {
    const sanitizedEntries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '[redacted]'] as const;
      }
      return [key, sanitizeAnalyticsPayload(entryValue)] as const;
    });
    return Object.fromEntries(sanitizedEntries);
  }

  return value;
}

function buildAnalyticsInsertRow(
  event: AnalyticsEvent,
  properties: AnalyticsEventProperties,
): AnalyticsInsertRow {
  const { tenant_id, customer_id, reservation_id, metadata, ...rest } = properties;

  return {
    tenant_id,
    event_type: event,
    customer_id: customer_id ?? null,
    reservation_id: reservation_id ?? null,
    metadata: sanitizeAnalyticsPayload({
      ...rest,
      ...(metadata ?? {}),
    }) as Record<string, unknown>,
  };
}

async function mirrorToPostHog(
  event: AnalyticsEvent,
  properties: AnalyticsEventProperties,
  distinctId: string,
): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;

  const apiHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
  const payload = {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: sanitizeAnalyticsPayload({
      ...properties,
      $lib: 'booka-server',
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    }),
  };

  try {
    const response = await fetch(`${apiHost}${POSTHOG_CAPTURE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      defaultLogger.warn('[analytics] PostHog mirror failed', {
        event,
        status: response.status,
      });
    }
  } catch (error) {
    defaultLogger.warn('[analytics] PostHog mirror request failed', {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function captureServerAnalyticsEvent(input: {
  event: AnalyticsEvent;
  properties: AnalyticsEventProperties;
  distinctId?: string | null;
}): Promise<void> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const row = buildAnalyticsInsertRow(input.event, input.properties);

    await supabaseAdmin.from('analytics_events').insert(row);

    await mirrorToPostHog(
      input.event,
      input.properties,
      input.distinctId ?? input.properties.customer_id ?? input.properties.tenant_id,
    );
  } catch (error) {
    defaultLogger.warn('[analytics] server event capture failed', {
      event: input.event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return Object.values(ANALYTICS_EVENTS).includes(value as AnalyticsEvent);
}
