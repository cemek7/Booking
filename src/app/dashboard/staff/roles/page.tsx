import { requireAuth } from '@/lib/auth/server-auth';

export default async function StaffRolesPage() {
  // Only managers and owners can manage staff roles
  const user = await requireAuth(['manager', 'owner']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Staff Roles</h1>
      <p className="text-sm text-gray-600">
        Define and manage staff roles and permissions for your tenant.
      </p>
      <p className="text-sm text-muted-foreground mt-2">
        Managing roles for: {user.tenantId || 'No tenant'}
      </p>

      <div className="mt-6 p-4 border rounded bg-white max-w-2xl">
        <p className="text-sm">Role management UI will be implemented here.</p>
        <p className="text-xs text-muted-foreground mt-2">
          Available to: {user.role === 'owner' ? 'Owners (full access)' : 'Managers (limited access)'}
        </p>
      </div>
    </div>
  );
}
