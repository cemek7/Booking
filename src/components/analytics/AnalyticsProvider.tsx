// src/components/analytics/AnalyticsProvider.tsx
'use client';

import React, { Suspense, useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { hasAnalyticsConsent, onConsentChange } from '@/lib/consent/consentStore';
import PostHogPageview from './PostHogPageview';

type AnalyticsProviderProps = {
  children: React.ReactNode;
  posthogKey?: string;
  posthogHost?: string;
};

export default function AnalyticsProvider({
  children,
  posthogKey,
  posthogHost,
}: AnalyticsProviderProps) {
  useEffect(() => {
    if (!posthogKey) return; // analytics disabled when unconfigured (dev/test)

    posthog.init(posthogKey, {
      api_host: posthogHost || 'https://us.i.posthog.com',
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
  }, [posthogHost, posthogKey]);

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
