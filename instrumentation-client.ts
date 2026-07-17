import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    environment,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
