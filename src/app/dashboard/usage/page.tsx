import { requireAuth } from '@/lib/auth/server-auth';
import UsagePanel from '@/components/UsagePanel.client';

// Usage dashboard - managers and owners can view tenant usage analytics
export default async function UsageDashboardPage() {
  // Only managers and owners can access usage analytics
  const user = await requireAuth(['manager', 'owner']);

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">Tenant Usage</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Analytics and usage metrics for {user.tenantId ? 'your tenant' : 'the system'}
      </p>
      {user.tenantId ? (
        <UsagePanel tenantId={user.tenantId} />
      ) : (
        <div className="text-sm text-gray-500">No tenant assigned to your account.</div>
      )}
    </div>
  );
}
