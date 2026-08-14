import Link from 'next/link';
import { requireAuth } from '@/lib/auth/server-auth';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import SuperadminTenantStaffClient from './SuperadminTenantStaffClient';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ tenant_id?: string }>;

export default async function SuperadminStaffPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAuth(['superadmin']);
  const { tenant_id: selectedTenantId } = await searchParams;
  const admin = createSupabaseAdminClient();
  const { data: tenants } = await admin
    .from('tenants')
    .select('id, name')
    .order('name', { ascending: true })
    .limit(200);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-700">Platform control</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Tenant staff</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Select a tenant to review its team. Staff records remain tenant-scoped; this platform view does not grant implicit access to a tenant workspace.
          </p>
        </div>
        <Link href="/booka/dashboard/superadmin/tenants" className="text-sm font-medium text-indigo-700 hover:text-indigo-900">
          Back to tenants
        </Link>
      </div>
      <SuperadminTenantStaffClient tenants={tenants ?? []} selectedTenantId={selectedTenantId ?? null} />
    </div>
  );
}
