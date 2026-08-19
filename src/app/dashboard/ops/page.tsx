export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import OpsClient from './OpsClient';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

export default async function OpsPage() {
  await requireAuth(['owner', 'manager', 'staff', 'superadmin']);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-[radial-gradient(circle_at_top_left,_#f0fdf4,_#ffffff_55%,_#f8fbf9_100%)] shadow-sm">
        <div className="flex flex-col gap-6 p-6 lg:p-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="w-fit rounded-full border-emerald-100 bg-white px-3 py-1 text-emerald-700">
              SIAS operations center
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#10211a]">Escalations, campaigns, and memory</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                This is the living control room for managed operations. It shows what Booka is handling, what needs a human, and what the tenant is teaching the system.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-emerald-50">
              Back to dashboard
            </Link>
            <Link href="/dashboard/billing" className="rounded-full border border-emerald-100 bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
              Billing view
            </Link>
          </div>
        </div>
      </div>

      <OpsClient />
    </div>
  );
}
