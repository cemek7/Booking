import React from 'react';
import { requireAuth } from '@/lib/auth/server-auth';
import SuperadminPageClient from './SuperadminPageClient';

export default async function SuperadminPage() {
  // Server-side authentication and role validation
  const user = await requireAuth(['superadmin']);

  return (
    <SuperadminPageClient user={user} />
  );
}
