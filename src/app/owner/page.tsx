import React from 'react';
import { requireAuth } from '@/lib/auth/server-auth';
import OwnerDashboardClient from './OwnerDashboardClient';
import { normalizeRole } from '@/types/roles';

export default async function OwnerDashboardPage() {
  // Server-side authentication - allow owners and above
  const user = await requireAuth(['owner', 'superadmin']);
  
  // Normalize role for consistent handling
  const normalizedRole = normalizeRole(user.role);

  return (
    <OwnerDashboardClient user={{
      ...user,
      role: normalizedRole
    }} />
  );
}