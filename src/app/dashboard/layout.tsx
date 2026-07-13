import React from 'react';
import { requireAuth } from '@/lib/auth/server-auth';
import DashboardLayoutClient from '@/components/DashboardLayoutClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard | Booka',
  description: 'Manage your business dashboard',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Resolve auth server-side so the client layout is seeded immediately —
  // no localStorage race condition, no spinner on page revisit.
  const user = await requireAuth(['owner', 'manager', 'staff', 'superadmin']);

  return (
    <DashboardLayoutClient
      initialTenantId={user.tenantId}
      initialRole={user.role}
      userEmail={user.email}
    >
      {children}
    </DashboardLayoutClient>
  );
}
