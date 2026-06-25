'use client';

import { useEffect, useState } from 'react';
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
      const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
      const supabase = getSupabaseBrowserClient();

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
    })();
    return () => { cancelled = true; };
  }, []);

  if (!token) return null;

  const hasTenant = Boolean(tenant?.id);
  const isSuperadmin = role === 'superadmin' || (getStoredIsAdmin() && !hasTenant);
  if (!isSuperadmin && !hasTenant) return null;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (tenant?.id) {
    headers['x-tenant-id'] = tenant.id;
  }

  return headers;
}
