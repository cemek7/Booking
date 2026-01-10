'use client';

import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import TenantProvider from '@/lib/supabase/tenant-context';
import UnifiedDashboardNav from '@/components/UnifiedDashboardNav';

// Create a singleton QueryClient for client-side queries
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
    },
  },
});

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { role, tenant } = useTenant();
  const [authReady, setAuthReady] = useState(false);

  // Wait for auth token to be available in localStorage before rendering children
  // This prevents 401 errors from components trying to make API calls before token is stored
  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    const maxAttempts = 20; // 20 * 100ms = 2 seconds max

    const checkAuthToken = () => {
      try {
        const token = localStorage.getItem('boka_auth_access_token');
        if (token) {
          console.log('[DashboardLayoutContent] ✓ Auth token found, children ready to render');
          if (mounted) setAuthReady(true);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          console.debug(`[DashboardLayoutContent] Auth token not yet available (attempt ${attempts}/${maxAttempts}), retrying...`);
          setTimeout(checkAuthToken, 100);
        } else {
          console.warn('[DashboardLayoutContent] ✗ Auth token not found after 2 seconds, proceeding anyway');
          if (mounted) setAuthReady(true);
        }
      } catch (err) {
        console.error('[DashboardLayoutContent] Error checking auth token:', err);
        if (mounted) setAuthReady(true);
      }
    };

    checkAuthToken();
    return () => { mounted = false; };
  }, []);

  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6 min-h-screen">
      <aside className="hidden lg:block sticky top-6 self-start h-fit max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="pr-2">
          <UnifiedDashboardNav 
            userRole={role || 'staff'}
          />
        </div>
      </aside>
      <div>
        {children}
      </div>
    </div>
  );
}

export default function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <DashboardLayoutContent>{children}</DashboardLayoutContent>
      </TenantProvider>
    </QueryClientProvider>
  );
}