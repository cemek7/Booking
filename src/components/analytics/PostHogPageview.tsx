'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { hasAnalyticsConsent } from '@/lib/consent/consentStore';

/**
 * Manual SPA pageview capture for the App Router (init uses capture_pageview:
 * false). Fires `$pageview` on every route change — but only when the user has
 * granted analytics consent. Renders nothing.
 *
 * Must be mounted inside a <Suspense> boundary because useSearchParams()
 * opts the subtree into client-side rendering in the App Router.
 */
export default function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    if (!hasAnalyticsConsent()) return;

    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;

    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
