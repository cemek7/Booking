"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { storeSignInData, getRedirectUrl } from "@/lib/auth/auth-manager";
import type SupabaseLite from '@/types/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<string>("Processing sign-in...");

  useEffect(() => {
    let mounted = true;

    type AuthSessionResult = { data?: { session?: unknown; error?: unknown } | null; session?: unknown | null; error?: unknown | null };

    async function finishAuth() {
      try {
        // Get session from Supabase auth URL or current session
        const auth = (getSupabaseBrowserClient() as unknown as SupabaseLite).auth as unknown as {
          getSessionFromUrl?: (opts?: { storeSession?: boolean }) => Promise<AuthSessionResult>;
          getSession?: () => Promise<AuthSessionResult>;
        };

        const result = (await auth.getSessionFromUrl?.({ storeSession: true })) as AuthSessionResult ?? { data: { session: null }, error: null } as AuthSessionResult;
        if (!mounted) return;

        let session = result?.data?.session ?? result?.session ?? null;
        if (!session) {
          try {
            const sres = (await auth.getSession?.()) as AuthSessionResult | undefined;
            session = sres?.data?.session ?? sres?.session ?? null;
          } catch (e) {
            console.warn('[auth/callback] Failed to get current session:', e);
          }
        }

        const error = result?.error ?? result?.data?.error ?? null;
        if (error) {
          console.error("[auth/callback] Session error:", error);
          setStatus("Sign-in failed. Please try signing in again.");
          return;
        }

        if (!session) {
          setStatus("No active session found. Please return to the app and sign in.");
          return;
        }

        // Extract session data
        const sessionData = session as any;
        const accessToken = sessionData?.access_token;
        const email = sessionData?.user?.email as string | undefined;

        if (!accessToken) {
          console.error('[auth/callback] No access token in session');
          setStatus("Sign-in failed: No access token.");
          return;
        }

        if (!email) {
          setStatus('Signed in — redirecting…');
          setTimeout(() => router.push('/'), 700);
          return;
        }

        setStatus("Signed in — checking role…");

        // Call server API to check admin/tenant status
        try {
          const resp = await fetch('/api/admin/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });

          if (resp.ok) {
            const json = await resp.json().catch(() => null);
            const found = json?.found;

            if (found) {
              // Store all auth data in localStorage
              console.log('[auth/callback] Storing auth data:', {
                hasAccessToken: !!accessToken,
                accessTokenLength: accessToken?.length,
                hasAdmin: found.admin,
                hasTenantId: !!found.tenant_id,
                hasRole: !!found.role,
                email: found.email
              });
              
              storeSignInData({
                accessToken,
                admin: found.admin || false,
                tenant_id: found.tenant_id,
                role: found.role,
                email: found.email || email,
                user_id: found.user_id || sessionData?.user?.id,
              });
              
              // Verify immediately after storage
              const verifyToken = localStorage.getItem('boka_auth_access_token');
              const verifyUserData = localStorage.getItem('boka_auth_user_data');
              const verifyTenantId = localStorage.getItem('boka_auth_tenant_id');
              console.log('[auth/callback] IMMEDIATE VERIFICATION after storeSignInData:', {
                tokenStored: !!verifyToken,
                userDataStored: !!verifyUserData,
                tenantIdStored: !!verifyTenantId,
                tokenLength: verifyToken?.length,
              });

              // Determine redirect based on admin status
              let redirectPath = '/';
              if (found.admin) {
                setStatus('Signed in — redirecting to admin…');
                redirectPath = '/admin/dashboard';
              } else if (found.tenant_id) {
                setStatus('Signed in — redirecting to dashboard…');
                redirectPath = getRedirectUrl(
                  found.admin ? 'admin' : `tenant-${found.role || 'staff'}`,
                  found.role
                );
              } else {
                setStatus('Signed in — redirecting to onboarding…');
                redirectPath = '/onboarding';
              }

              // Verify tokens were stored before redirecting
              const verify = () => {
                const token = localStorage.getItem('boka_auth_access_token');
                const userData = localStorage.getItem('boka_auth_user_data');
                
                if (!token || !userData) {
                  console.error('[auth/callback] ✗ Token storage verification FAILED');
                  console.error('[auth/callback] Token present:', !!token);
                  console.error('[auth/callback] UserData present:', !!userData);
                  setStatus('Sign-in failed: Could not persist session. Please try again.');
                  return false;
                }
                
                console.log('[auth/callback] ✓ Token storage verification SUCCESS');
                console.log('[auth/callback] Token length:', token.length);
                console.log('[auth/callback] UserData:', userData.substring(0, 50) + '...');
                return true;
              };

              // Immediate verification first
              if (!verify()) {
                setTimeout(() => {
                  // Try again after a short delay
                  if (!verify()) {
                    // Still failed - might be localStorage issue
                    return;
                  }
                  console.log('[auth/callback] Redirecting to:', redirectPath);
                  router.push(redirectPath);
                }, 500);
              } else {
                // Storage successful on first check
                setTimeout(() => {
                  console.log('[auth/callback] Redirecting to:', redirectPath);
                  router.push(redirectPath);
                }, 500);
              }
              return;
            }
          } else {
            const text = await resp.text().catch(() => '');
            console.error('[auth/callback] Admin check failed:', resp.status, text);
          }
        } catch (e) {
          console.error('[auth/callback] Role check error:', e);
        }

        // If we couldn't identify the user, redirect to onboarding
        setStatus('Signed in — setting up your account…');
        setTimeout(() => router.push('/onboarding'), 700);

      } catch (err) {
        console.error('[auth/callback] Unexpected error:', err);
        if (mounted) setStatus("Unable to complete sign-in. Please try again.");
      }
    }

    finishAuth();

    return () => { mounted = false; };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-gray-50 to-white px-4">
      <div className="max-w-md mx-auto bg-white/80 backdrop-blur-md border border-gray-200 rounded-2xl p-6 shadow-lg text-center">
        <h3 className="text-lg font-medium">Completing sign-in</h3>
        <p className="mt-3 text-sm text-gray-700">{status}</p>
      </div>
    </div>
  );
}
