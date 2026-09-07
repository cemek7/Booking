import * as Sentry from '@sentry/nextjs';

export type BookaSentryContext = {
  tenantId?: string | null;
  channel?: 'whatsapp' | 'instagram' | 'web' | 'system' | null;
  flow?: 'activation' | 'booking' | 'cancellation' | 'reschedule' | 'owner_command' | 'payment' | 'support' | 'retention' | null;
  provider?: 'meta' | 'waha' | 'evolution' | 'cloudflare' | 'openrouter' | 'gemini' | 'paystack' | 'stripe' | 'supabase' | 'system' | null;
  release?: string | null;
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERN = /(phone|message|token|secret|authorization|password|cookie|email|notes?|body)/i;

function sanitizeExtra(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeExtra(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeExtra(entryValue),
      ]),
    );
  }

  return value;
}

export function withBookaSentryScope<T>(context: BookaSentryContext, callback: () => T): T {
  return Sentry.withScope((scope) => {
    scope.setTag('environment', process.env.NODE_ENV ?? 'development');
    if (context.tenantId) scope.setTag('tenant_id', context.tenantId);
    if (context.channel) scope.setTag('channel', context.channel);
    if (context.flow) scope.setTag('flow', context.flow);
    if (context.provider) scope.setTag('provider', context.provider);
    scope.setTag('release', context.release ?? process.env.APP_VERSION ?? 'unknown');

    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== undefined && value !== null) scope.setTag(key, String(value));
    }

    if (context.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, sanitizeExtra(value));
      }
    }

    return callback();
  });
}

export function captureBookaException(error: unknown, context: BookaSentryContext = {}): string {
  return withBookaSentryScope(context, () => Sentry.captureException(error));
}
