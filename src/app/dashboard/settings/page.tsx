export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import SettingsWorkspace from '@/components/settings/SettingsWorkspace';
import TenantSettingsHost from '@/components/TenantSettingsHost';
import CalendarSettings from '@/components/calendar/CalendarSettings';
import CapabilitiesCard from '@/components/settings/CapabilitiesCard';
import PublicLinksCard from '@/components/settings/PublicLinksCard';

// Canonical settings surface. /settings and its subpages redirect here so there
// is a single place for everything: workflows, public pages, the detailed tabbed
// config (incl. Paystack payouts), calendar sync, and account/data tools.
export default async function SettingsPage() {
  const user = await requireAuth(['owner']);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-600">Manage your business profile, workflows, payments, and how your AI assistant replies.</p>
      </div>

      {user.tenantId && (
        <div className="space-y-6">
          <CapabilitiesCard tenantId={user.tenantId} />
          <PublicLinksCard tenantId={user.tenantId} />
        </div>
      )}

      {/* Detailed tabbed configuration (Tenant / Business / Agent / Notifications
          / Security / Channels / Payments-Paystack). */}
      <SettingsWorkspace />

      {user.tenantId && (
        <div className="mt-2">
          <CalendarSettings
            tenantId={user.tenantId}
            userRole={(user.role as 'owner' | 'admin' | 'manager' | 'staff') ?? 'owner'}
            currentUserId={user.id}
          />
        </div>
      )}

      {/* Streamlined quick settings (currency, booking window, public booking
          toggle) + account tools (data export / close account). */}
      <TenantSettingsHost />
    </div>
  );
}
