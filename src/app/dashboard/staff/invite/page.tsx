import { requireAuth } from '@/lib/auth/server-auth';

export default async function StaffInvitePage() {
  // Only managers and owners can invite staff
  const user = await requireAuth(['manager', 'owner']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Invite Staff Member</h1>
      <p className="text-sm text-gray-600 mb-6">
        Invite new staff members to join your tenant.
      </p>
      <p className="text-sm text-muted-foreground mb-4">
        Managing invites for: {user.tenantId || 'No tenant'}
      </p>
      
      <div className="max-w-md p-4 border rounded bg-white">
        <p className="text-sm">Staff invitation form will be implemented here.</p>
        <p className="text-xs text-muted-foreground mt-2">
          Available to: {user.role === 'owner' ? 'Owners' : 'Managers'} only
        </p>
      </div>
    </div>
  );
}
