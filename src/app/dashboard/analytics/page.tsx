import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth/server-auth';

// This route is deprecated - analytics are now integrated into role-specific dashboards
export default async function DeprecatedAnalyticsPage() {
  const user = await requireAuth();
  
  // Redirect to appropriate role-based dashboard
  switch (user.role) {
    case 'owner':
      redirect('/dashboard/owner');
    case 'manager':
      redirect('/dashboard/manager'); 
    case 'staff':
      redirect('/dashboard/staff-dashboard');
    case 'superadmin':
      redirect('/superadmin');
    default:
      redirect('/dashboard');
  }
}
