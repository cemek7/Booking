// src/components/analytics/AnalyticsProvider.tsx
'use client';

import React, { Suspense, useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { hasAnalyticsConsent, onConsentChange } from '@/lib/consent/consentStore';
import PostHogPageview from './PostHogPageview';

export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // analytics disabled when unconfigured (dev/test)

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      opt_out_capturing_by_default: true,
      capture_pageview: false,
      persistence: 'localStorage+cookie',
      // Session replay must never leak PII: mask all text + inputs in the
      // browser before anything is sent. Replay still only runs after consent
      // (opt_out_capturing_by_default), so this is defence-in-depth.
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
      },
    });

    const sync = () => {
      if (hasAnalyticsConsent()) posthog.opt_in_capturing();
      else posthog.opt_out_capturing();
    };
    sync();
    return onConsentChange(sync);
  }, []);

  return (
    <PostHogProvider client={posthog}>
      {/* useSearchParams requires a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </PostHogProvider>
  );
}
