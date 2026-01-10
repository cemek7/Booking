import { requireAuth } from '@/lib/auth/server-auth';
import React from 'react';

export default async function StaffSchedulingPage() {
  await requireAuth(['staff']);

  return (
    <div>
      <h1>Staff Scheduling</h1>
      <p>This is the staff scheduling page.</p>
    </div>
  );
}
