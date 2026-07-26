'use client';

export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useEffect } from 'react';

/**
 * Schedule page router - redirects to role-specific schedule page
 * 
 * Owner/Manager → /dashboard/owner|manager/schedule
 * Staff → /schedule
 */
export default function ScheduleRouter() {
  const router = useRouter();
  const { role } = useTenant();

  useEffect(() => {
    if (!role) {
      router.push('/dashboard');
      return;
    }

    // Route based on role
    if (role === 'owner' || role === 'manager') {
      router.push(`/dashboard/${role}/schedule`);
    } else if (role === 'staff') {
      router.push('/schedule');
    } else {
      router.push('/dashboard');
    }
  }, [role, router]);

  // Show loading state while redirecting
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="mb-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        </div>
        <p className="text-gray-500">Redirecting to your schedule...</p>
      </div>
    </div>
  );
}
