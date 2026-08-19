'use client';

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PostHogIdentity from '@/components/analytics/PostHogIdentity';
import TenantProvider from '@/lib/supabase/tenant-context';
import { LocationProvider } from '@/lib/location-context';

// Singleton QueryClient for standalone (non-dashboard) routes.
// Lives outside the component so it isn't recreated on every render.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, gcTime: 1000 * 60 * 10 },
  },
});

export default function StandaloneProviders({ children }: { children: React.ReactNode }) {
  return (
    <TenantProvider>
      <PostHogIdentity />
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          {children}
        </LocationProvider>
      </QueryClientProvider>
    </TenantProvider>
  );
}
