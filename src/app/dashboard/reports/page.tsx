import RoleBasedReports from '@/components/reports/RoleBasedReports';
import { requireAuth } from '@/lib/auth/server-auth';

export default async function ReportsPage() {
  await requireAuth(['owner', 'manager']);

  return (
    <div className="p-6">
      <RoleBasedReports />
    </div>
  );
}

