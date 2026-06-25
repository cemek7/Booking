"use client";

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from "react";
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { storeSignInData } from "@/lib/auth/auth-manager";

type CallbackPayload = {
  accessToken: string | null;
  userId: string | null;
  email: string | null;
  redirectPath: string;
  found:
    | {
        admin: true;
        email: string | null;
        user_id: string | null;
      }
    | {
        tenant_id: string;
        role: 'owner' | 'manager' | 'staff';
        email: string | null;
        user_id: string | null;
      }
    | {
        multiple: true;
        user_id: string | null;
        email: string | null;
        tenants: Array<{
          tenant_id: string;
          role: 'owner' | 'manager' | 'staff';
          name: string | null;
          slug: string | null;
        }>;
      }
    | null;
};

type CallbackErrorPayload = {
  reason?: string;
  message?: string;
};

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<string>("Processing sign-in...");

  useEffect(() => {
    let mounted = true;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    let finished = false;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleRedirect(path: string, delayMs: number) {
      if (redirectTimer) {
        clearTimeout(redirectTimer);
      }
      redirectTimer = setTimeout(() => {
        if (!mounted) return;
        window.location.replace(path);
      }, delayMs);
    }

    async function finishAuth(payload: CallbackPayload) {
      if (!mounted || finished) return;
      finished = true;

      const accessToken = payload.accessToken;
      const userId = payload.userId;
      const email = payload.email ?? undefined;

      if (!accessToken || !userId) {
        setStatus('Signed in — redirecting…');
        scheduleRedirect('/booka/auth/signin', 700);
        return;
      }

      if (!email) {
        setStatus('Signed in — redirecting…');
        scheduleRedirect('/booka/auth/signin', 700);
        return;
      }

      const found = payload.found;
      if (found && 'multiple' in found) {
        sessionStorage.setItem('tenant_picker', JSON.stringify({
          accessToken,
          userId: found.user_id || userId,
          email: found.email || email,
          tenants: found.tenants,
        }));
        setStatus('Signed in — choosing workspace…');
        scheduleRedirect(payload.redirectPath, 400);
        return;
      }

      storeSignInData({
        accessToken,
        admin: !!found && 'admin' in found ? found.admin : false,
        tenant_id: found && 'tenant_id' in found ? found.tenant_id : undefined,
        role: found && 'role' in found ? found.role : undefined,
        email: found && 'email' in found ? (found.email || email) : email,
        user_id: found && 'user_id' in found ? (found.user_id || userId) : userId,
      });

      if (found && 'admin' in found && found.admin) {
        setStatus('Signed in — redirecting to admin…');
      } else if (found && 'tenant_id' in found) {
        setStatus('Signed in — redirecting to dashboard…');
      } else {
        setStatus('Signed in — setting up your account…');
      }

      scheduleRedirect(payload.redirectPath, 500);
    }

    const completeAuth = async () => {
      if (code) {
        setStatus('Completing sign-in…');
        try {
          const callbackUrl = new URL('/api/auth/callback', window.location.origin);
          callbackUrl.search = url.search;
          callbackUrl.searchParams.set('format', 'json');

          const resp = await fetch(callbackUrl.toString(), {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
            },
          });

          const payload = (await resp.json().catch(() => null)) as CallbackPayload | CallbackErrorPayload | null;

          if (
            !resp.ok ||
            !payload ||
            !('accessToken' in payload) ||
            !payload.accessToken ||
            !payload.userId
          ) {
            throw new Error(
              payload && 'reason' in payload
                ? (payload.reason || payload.message || 'auth_callback_failed')
                : 'auth_callback_failed'
            );
          }

          await finishAuth(payload);
          return;
        } catch (error) {
          console.error('[AuthCallback] server callback fetch failed', error);
          setStatus('Completing sign-in failed. Retrying…');

          const redirectUrl = new URL('/api/auth/callback', window.location.origin);
          redirectUrl.search = url.search;
          redirectUrl.searchParams.set('next', '/booka/auth/callback?finalize=1');
          window.location.replace(redirectUrl.toString());
          return;
        }
      }

      const supabase = getSupabaseBrowserClient();
      const subscription = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
        if (!mounted || !session) return;
        void completeExistingSession();
      });

      const completeExistingSession = async () => {
        try {
          const callbackUrl = new URL('/api/auth/callback', window.location.origin);
          callbackUrl.searchParams.set('format', 'json');

          const resp = await fetch(callbackUrl.toString(), {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
            },
          });

          const payload = (await resp.json().catch(() => null)) as CallbackPayload | CallbackErrorPayload | null;

          if (
            !resp.ok ||
            !payload ||
            !('accessToken' in payload) ||
            !payload.accessToken ||
            !payload.userId
          ) {
            throw new Error(
              payload && 'reason' in payload
                ? (payload.reason || payload.message || 'auth_callback_failed')
                : 'auth_callback_failed'
            );
          }

          await finishAuth(payload);
        } catch (error) {
          console.error('[AuthCallback] existing session classification failed', error);
          if (mounted) {
            setStatus('Sign-in timed out. Please try the link again or request a new one.');
          }
        }
      };

      try {
        // Hash-based invite flows may land here without a code. Let the browser
        // client hydrate, then classify the established session server-side.
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;

        if (data.session) {
          await completeExistingSession();
          return;
        }

        if (mounted) {
          setStatus('Sign-in timed out. Please try the link again or request a new one.');
        }
      } finally {
        subscription.data.subscription.unsubscribe();
      }
    };

    void completeAuth();

    return () => {
      mounted = false;
      if (redirectTimer) {
        clearTimeout(redirectTimer);
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-gray-50 to-white px-4">
      <div className="max-w-md mx-auto bg-white/80 backdrop-blur-md border border-gray-200 rounded-2xl p-6 shadow-lg text-center">
        <h3 className="text-lg font-medium">Completing sign-in</h3>
        <p className="mt-3 text-sm text-gray-700">{status}</p>
      </div>
    </div>
  );
}
