import { requireAuth } from '@/lib/auth/server-auth';
import OwnerReports from './OwnerReports';
import ManagerReports from './ManagerReports';

export default async function RoleBasedReports() {
  const user = await requireAuth(['owner', 'manager']);

  return (
    <div>
      {user.role === 'owner' && <OwnerReports tenantId={user.tenantId} />}
      {user.role === 'manager' && <ManagerReports tenantId={user.tenantId} />}
    </div>
  );
}
