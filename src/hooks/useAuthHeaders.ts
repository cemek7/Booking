'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { getStoredAccessToken, getStoredIsAdmin, setStoredAccessToken } from '@/lib/auth/token-storage';

/**
 * Returns fetch-compatible headers with the Bearer token and X-Tenant-ID
 * so client components can call authenticated API routes.
 * Returns null while the session is still loading.
 */
export function useAuthHeaders(): Record<string, string> | null {
  const { tenant, role } = useTenant();
  const [token, setToken] = useState<string | null>(() => getStoredAccessToken());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getSupabaseBrowserClientAsync } = await import('@/lib/supabase/client');
        const supabase = await getSupabaseBrowserClientAsync();

        const storedToken = getStoredAccessToken();
        if (!cancelled && storedToken) {
          setToken(storedToken);
        }

        // Fast path: read Supabase's own session storage — no network call when token is fresh.
        // This gives an immediate non-null token on page revisit so data fetches start right away.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!cancelled && sessionData.session?.access_token) {
          setToken(sessionData.session.access_token);
          setStoredAccessToken(sessionData.session.access_token);
        }

        // Slow path: server-revalidate (network call). Updates token after a silent refresh.
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          if (!cancelled) setToken(null);
          return;
        }
        const { data: freshSession } = await supabase.auth.getSession();
        if (!cancelled && freshSession.session?.access_token) {
          setToken(freshSession.session.access_token);
          setStoredAccessToken(freshSession.session.access_token);
        }
      } catch {
        if (!cancelled) setToken(getStoredAccessToken());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const tenantId = tenant?.id;

  // Memoize on the primitive inputs so the returned object keeps a STABLE
  // identity across renders. Consumers put this in useEffect/useCallback
  // dependency arrays; returning a fresh object every render caused those
  // effects to refire on every render — an infinite fetch/reload loop
  // (e.g. the showcase builder repeatedly reloading its packs).
  return useMemo<Record<string, string> | null>(() => {
    if (!token) return null;

    const hasTenant = Boolean(tenantId);
    const isSuperadmin = role === 'superadmin' || (getStoredIsAdmin() && !hasTenant);
    if (!isSuperadmin && !hasTenant) return null;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (tenantId) headers['x-tenant-id'] = tenantId;
    return headers;
  }, [token, tenantId, role]);
}
