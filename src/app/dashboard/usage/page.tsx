export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import UsagePanel from '@/components/UsagePanel.client';

// Usage dashboard - managers and owners can view tenant usage analytics
export default async function UsageDashboardPage() {
  // Only managers and owners can access usage analytics
  const user = await requireAuth(['manager', 'owner']);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Usage</h1>
        <p className="mt-1 text-sm text-slate-500">
          How much your account is being used — bookings, deposits collected, and AI activity — so you always know where you stand.
        </p>
      </div>
      {user.tenantId ? (
        <UsagePanel tenantId={user.tenantId} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500 shadow-sm">
          No tenant assigned to your account.
        </div>
      )}
    </div>
  );
}
