// src/components/analytics/AnalyticsProvider.tsx
'use client';

import React, { Suspense, useEffect, useState } from 'react';
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
  const [resolvedConfig, setResolvedConfig] = useState<{
    posthogKey?: string;
    posthogHost?: string;
  }>({
    posthogKey,
    posthogHost,
  });

  useEffect(() => {
    setResolvedConfig({ posthogKey, posthogHost });
  }, [posthogHost, posthogKey]);

  useEffect(() => {
    if (resolvedConfig.posthogKey) return;

    let cancelled = false;

    void fetch('/api/client-config', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{
          posthogKey?: string | null;
          posthogHost?: string | null;
        }>;
      })
      .then((config) => {
        if (cancelled || !config?.posthogKey) return;
        setResolvedConfig({
          posthogKey: config.posthogKey,
          posthogHost: config.posthogHost || 'https://us.i.posthog.com',
        });
      })
      .catch(() => {
        // Keep analytics inert when runtime config fetch fails.
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedConfig.posthogKey]);

  useEffect(() => {
    if (!resolvedConfig.posthogKey) return; // analytics disabled when unconfigured (dev/test)

    posthog.init(resolvedConfig.posthogKey, {
      api_host: resolvedConfig.posthogHost || 'https://us.i.posthog.com',
      defaults: '2026-05-30',
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
  }, [resolvedConfig.posthogHost, resolvedConfig.posthogKey]);

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
