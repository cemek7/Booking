import { requireAuth } from '@/lib/auth/server-auth';
import TenantSettingsHost from '@/components/TenantSettingsHost';

export default async function SettingsPage() {
  // Only owners can access tenant settings
  await requireAuth(['owner']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-gray-600">Tenant configuration and LLM settings.</p>
      <div className="mt-6">
        <TenantSettingsHost />
      </div>
    </div>
  );
}
