import { requireAuth } from '@/lib/auth/server-auth';
import React from 'react';

export default async function TasksPage() {
  await requireAuth(['owner', 'manager', 'staff']);

  return (
    <div>
      <h1>Tasks</h1>
      <p>This is the tasks page.</p>
    </div>
  );
}
