// src/components/analytics/AnalyticsProvider.tsx
'use client';

import React, { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { hasAnalyticsConsent, onConsentChange } from '@/lib/consent/consentStore';

export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // analytics disabled when unconfigured (dev/test)

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      opt_out_capturing_by_default: true,
      capture_pageview: false,
      persistence: 'localStorage+cookie',
    });

    const sync = () => {
      if (hasAnalyticsConsent()) posthog.opt_in_capturing();
      else posthog.opt_out_capturing();
    };
    sync();
    return onConsentChange(sync);
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
