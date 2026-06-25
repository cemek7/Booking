export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import ChatsList from '@/components/chat/ChatsList';
import CustomersList from '@/components/customers/CustomersList';
import ServicesList from '@/components/services/ServicesList';
import DashboardKpis from '@/components/dashboard/DashboardKpis';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
  superadmin: 'Super Admin',
};

export default async function TenantDashboardPage() {
  const user = await requireAuth(['owner', 'manager', 'staff']);
  const tenantId = user.tenantId;
  const role = user.role;
  const roleLabel = ROLE_LABEL[role?.toLowerCase() ?? ''] ?? role ?? 'User';
  const isOwner = role?.toLowerCase() === 'owner';

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-[radial-gradient(circle_at_top_left,_#f0fdf4,_#ffffff_55%,_#f8fbf9_100%)] shadow-sm">
        <div className="flex flex-col gap-6 p-6 lg:p-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="w-fit rounded-full border-emerald-100 bg-white px-3 py-1 text-emerald-700">
              {roleLabel} view
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#10211a]">Dashboard</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Keep bookings, customers, services, and conversations in one place with a layout that is easier to scan at a glance.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/ops" className="rounded-full border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm hover:bg-emerald-100">
              SIAS ops
            </Link>
            <Link href="/dashboard/billing" className="rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-emerald-50">
              Billing
            </Link>
          </div>
        </div>
      </div>

      <DashboardKpis tenantId={tenantId} userId={user.id} userRole={role} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <aside className="order-last space-y-4 xl:order-first xl:col-span-4">
          <Card className="p-0">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#10211a]">Conversations</h3>
                  <p className="text-sm text-slate-500">Live customer and team messages.</p>
                </div>
                <Badge variant="outline" className="rounded-full border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700">
                  Inbox
                </Badge>
              </div>
              <ChatsList />
            </CardContent>
          </Card>
        </aside>

        <div className="space-y-6 xl:col-span-8">
          {isOwner ? (
            <>
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#10211a]">Customers</h3>
                  <p className="text-sm text-slate-500">Search, edit, and message customers with the full table visible.</p>
                </div>
                <CustomersList tenantId={tenantId ?? undefined} />
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#10211a]">Services</h3>
                  <p className="text-sm text-slate-500">Manage your service catalog without the table feeling cramped.</p>
                </div>
                <ServicesList />
              </div>
            </>
          ) : (
            <Card className="p-0">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-1">Activity</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Your upcoming bookings and schedule will appear here. Head to{' '}
                  <a href="/dashboard/schedule" className="text-indigo-600 hover:underline">Schedule</a>{' '}
                  for a full calendar view.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
