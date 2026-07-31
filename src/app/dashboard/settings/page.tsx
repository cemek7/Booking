export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import TenantSettingsHost from '@/components/TenantSettingsHost';
import CalendarSettings from '@/components/calendar/CalendarSettings';
import CapabilitiesCard from '@/components/settings/CapabilitiesCard';

export default async function SettingsPage() {
  // Only owners can access tenant settings
  const user = await requireAuth(['owner']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-gray-600">Manage your business profile, team, and how your AI assistant replies to customers.</p>
      {user.tenantId && (
        <div className="mt-6">
          <CapabilitiesCard tenantId={user.tenantId} />
        </div>
      )}
      <div className="mt-6">
        <TenantSettingsHost />
      </div>
      {user.tenantId && (
        <div className="mt-8">
          <CalendarSettings
            tenantId={user.tenantId}
            userRole={(user.role as 'owner' | 'admin' | 'manager' | 'staff') ?? 'owner'}
            currentUserId={user.id}
          />
        </div>
      )}
    </div>
  );
}
