export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import { Suspense } from 'react';
import SuperadminPageClient from './SuperadminPageClient';

export const metadata: Metadata = {
  title: 'Superadmin Dashboard | Booka',
  description: 'Platform-wide management and monitoring',
};

function SuperadminLoading() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
    </div>
  );
}

export default async function SuperadminDashboardPage() {
  const user = await requireAuth(['superadmin']);
  return (
    <Suspense fallback={<SuperadminLoading />}>
      <SuperadminPageClient user={user} />
    </Suspense>
  );
}
