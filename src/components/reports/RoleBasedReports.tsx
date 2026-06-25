import { requireAuth } from '@/lib/auth/server-auth';
import OwnerReports from './OwnerReports';
import ManagerReports from './ManagerReports';

export default async function RoleBasedReports() {
  const user = await requireAuth(['owner', 'manager']);

  return (
    <div>
      {user.role === 'owner' && <OwnerReports />}
      {user.role === 'manager' && <ManagerReports />}
    </div>
  );
}
