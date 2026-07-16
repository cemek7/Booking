'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useAnalyticsReady } from './AnalyticsReadyContext';

type AuthUser = {
  id?: string;
  email?: string | null;
} | null;

export default function PostHogIdentity() {
  const analyticsReady = useAnalyticsReady();

  useEffect(() => {
    if (!analyticsReady) return;

    const supabase = getSupabaseBrowserClient();

    const syncUser = (user: AuthUser) => {
      if (user?.id) {
        posthog.identify(user.id, user.email ? { email: user.email } : undefined);
        return;
      }
      posthog.reset();
    };

    let active = true;

    void supabase.auth.getUser().then((result: { data?: { user?: AuthUser } }) => {
      if (!active) return;
      syncUser(result.data?.user ?? null);
    }).catch(() => {
      if (!active) return;
      posthog.reset();
    });

    const { data } = supabase.auth.onAuthStateChange((_event: unknown, session: { user?: AuthUser } | null) => {
      syncUser(session?.user ?? null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [analyticsReady]);

  return null;
}
