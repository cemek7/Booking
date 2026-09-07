import React from 'react';
import { requireAuth } from '@/lib/auth/server-auth';
import DashboardLayoutClient from '@/components/DashboardLayoutClient';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantCapabilities, DEFAULT_CAPABILITIES } from '@/lib/capabilities';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard | Booka',
  description: 'Manage your business dashboard',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Resolve auth server-side so the client layout is seeded immediately —
  // no localStorage race condition, no spinner on page revisit.
  const user = await requireAuth(['owner', 'manager', 'staff', 'superadmin']);

  // Resolve the tenant's enabled workflows so the nav renders scoped from the
  // first paint. Superadmin (no tenant) gets the all-on default.
  const capabilities = user.tenantId
    ? await getTenantCapabilities(createSupabaseAdminClient(), user.tenantId)
    : DEFAULT_CAPABILITIES;

  return (
    <DashboardLayoutClient
      initialTenantId={user.tenantId}
      initialRole={user.role}
      initialCapabilities={capabilities}
      userEmail={user.email}
    >
      {children}
    </DashboardLayoutClient>
  );
}
