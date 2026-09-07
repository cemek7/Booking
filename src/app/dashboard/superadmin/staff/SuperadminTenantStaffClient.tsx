'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/auth-api-client';

type Tenant = { id: string; name: string | null };
type StaffMember = { user_id: string | null; name: string | null; email: string | null; role: string | null };

export default function SuperadminTenantStaffClient({
  tenants,
  selectedTenantId,
}: {
  tenants: Tenant[];
  selectedTenantId: string | null;
}) {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTenantId) {
      setStaff([]);
      return;
    }

    let current = true;
    setLoading(true);
    setError(null);
    authFetch<StaffMember[]>(`/api/tenants/${encodeURIComponent(selectedTenantId)}/staff`)
      .then((result) => {
        if (!current) return;
        if (result.error) {
          setError('Unable to load staff for this tenant.');
          setStaff([]);
          return;
        }
        setStaff(Array.isArray(result.data) ? result.data : []);
      })
      .catch(() => {
        if (current) {
          setError('Unable to load staff for this tenant.');
          setStaff([]);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [selectedTenantId]);

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <label htmlFor="tenant-staff-selector" className="text-sm font-medium text-slate-800">Tenant</label>
        <select
          id="tenant-staff-selector"
          value={selectedTenantId ?? ''}
          onChange={(event) => {
            const tenantId = event.target.value;
            router.replace(tenantId ? `/booka/dashboard/superadmin/staff?tenant_id=${encodeURIComponent(tenantId)}` : '/booka/dashboard/superadmin/staff');
          }}
          className="mt-2 block w-full max-w-xl rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">Select a tenant</option>
          {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name || tenant.id}</option>)}
        </select>
      </div>

      {!selectedTenantId && <p className="p-8 text-sm text-slate-500">Select a tenant to review its staff.</p>}
      {selectedTenantId && loading && <p className="p-8 text-sm text-slate-500">Loading staff…</p>}
      {selectedTenantId && error && <p className="p-8 text-sm text-rose-700">{error}</p>}
      {selectedTenantId && !loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <caption className="sr-only">Staff for {selectedTenant?.name || 'selected tenant'}</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3 font-medium">Team member</th><th className="px-5 py-3 font-medium">Email</th><th className="px-5 py-3 font-medium">Role</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((member) => (
                <tr key={member.user_id || member.email || member.name || 'staff'}>
                  <td className="px-5 py-4 font-medium text-slate-900">{member.name || 'Unnamed team member'}</td>
                  <td className="px-5 py-4 text-slate-600">{member.email || '—'}</td>
                  <td className="px-5 py-4 capitalize text-slate-600">{member.role || 'staff'}</td>
                </tr>
              ))}
              {!staff.length && <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-500">No staff members found for this tenant.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
