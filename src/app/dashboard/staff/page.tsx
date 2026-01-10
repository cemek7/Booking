"use client";
import { useEffect, useMemo, useState } from 'react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useStaff, StaffDto } from '@/hooks/useStaff';
import StaffInviteModal from '@/components/staff/StaffInviteModal';
import StaffRolesModal from '@/components/staff/StaffRolesModal';
import { toast } from '@/components/ui/toast';
import { Role } from '@/types/roles';

export default function StaffPage() {
  const { tenant, role } = useTenant();
  const [canInvite, setCanInvite] = useState(false);
  const { data: staff = [], isLoading, mutateAttributes } = useStaff(tenant?.id);
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, { rating: number|null; completed: number; revenue: number }>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, 'active'|'on_leave'>>({});
  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!tenant?.id) { if (mounted) setCanInvite(false); return; }
      try {
        const res = await fetch(`/api/tenants/${tenant.id}/settings`);
        if (!res.ok) { if (mounted) setCanInvite(false); return; }
        const s = await res.json();
        const allowed = (s?.allowedInviterRoles as Role[] | undefined) || ['owner','manager'] as Role[];
        const allowFromStaff = s?.allowInvitesFromStaffPage !== false;
        const r = (role || '').toLowerCase() as Role;
        if (mounted) setCanInvite(!!role && allowFromStaff && allowed.includes(r));
      } catch { if (mounted) setCanInvite(false); }
    }
    load();
    return () => { mounted = false; };
  }, [tenant?.id, role]);

  useEffect(() => {
    let cancel = false;
    async function loadMetrics() {
      if (!tenant?.id) return;
      try {
        const res = await fetch(`/api/staff/metrics?tenant_id=${tenant.id}`);
        if (!res.ok) return;
        const json = await res.json();
        const map: Record<string, { rating: number|null; completed: number; revenue: number }> = {};
        for (const m of (json?.metrics||[])) map[m.user_id] = { rating: m.rating, completed: m.completed, revenue: m.revenue };
        if (!cancel) setMetrics(map);
      } catch {}
    }
    loadMetrics();
    return () => { cancel = true; };
  }, [tenant?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s: StaffDto) =>
      (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q)
    );
  }, [staff, search]);

  const showInviteCTA = useMemo(() => {
    const r = (role || '').toLowerCase();
    if (canInvite) return true;
    return r === 'owner' || r === 'manager' || r === 'superadmin';
  }, [canInvite, role]);

  return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="text-sm text-gray-600">Manage staff, roles, status, schedules, and assignments.</p>

        <div className="mt-4 flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-64"
            placeholder="Search staff by name or email"
            aria-label="search-staff"
          />
          {showInviteCTA && (
            <button type="button" onClick={()=> setInviteOpen(true)} className="px-3 py-1 rounded bg-indigo-600 text-white text-sm">Add Staff</button>
          )}
          <button type="button" onClick={()=> setRolesOpen(true)} className="text-blue-600 hover:underline text-sm">Manage roles</button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {isLoading && (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white border rounded p-4 animate-pulse">
                  <div className="h-4 w-40 bg-gray-200 rounded" />
                  <div className="mt-2 h-3 w-56 bg-gray-200 rounded" />
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="h-10 bg-gray-200 rounded" />
                    <div className="h-10 bg-gray-200 rounded" />
                    <div className="h-10 bg-gray-200 rounded" />
                  </div>
                  <div className="mt-4 h-6 w-24 bg-gray-200 rounded" />
                </div>
              ))}
            </>
          )}
          {!isLoading && filtered.length === 0 && <div className="text-sm text-gray-500">No staff found.</div>}
          {!isLoading && filtered.map((s: StaffDto) => {
            const id: string = (s.id || s.user_id || '').toString();
            const m = metrics[id] || { rating: null, completed: 0, revenue: 0 };
            const localStatus = (id && statusOverrides[id]) || (s.status as 'active'|'on_leave' | undefined) || 'active';
            const name = s.name || s.email || id;
            const staffType = s.staff_type || '—';
            async function onChangeStatus(next: string) {
              if (!tenant?.id) return;
              const prev = localStatus as 'active'|'on_leave';
              if (id) setStatusOverrides(map => ({ ...map, [id]: next as 'active'|'on_leave' }));
              try {
                const res = await fetch(`/api/staff/${encodeURIComponent(id as string)}/status?tenant_id=${tenant.id}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next })
                });
                if (!res.ok) throw new Error('Failed to update status');
                toast.success('Status updated');
              } catch (e) {
                if (id) setStatusOverrides(map => ({ ...map, [id]: prev }));
                const msg = e instanceof Error ? e.message : 'Status update failed';
                toast.error(msg);
              }
            }
            return (
              <div key={id} className="bg-white border rounded p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-gray-500">{s.email || '—'}</div>
                    <div className="text-xs text-gray-500">Role: <span className="capitalize">{s.role || 'staff'}</span> · Type: {staffType}</div>
                  </div>
                  <select
                    value={localStatus}
                    onChange={(e)=> onChangeStatus(e.target.value)}
                    className="border rounded px-2 py-1 text-xs"
                    aria-label={`status-${id}`}
                  >
                    <option value="active">Active</option>
                    <option value="on_leave">On leave</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="p-2 bg-gray-50 rounded">
                    <div className="text-xs text-gray-500">Rating</div>
                    <div className="font-medium">{m.rating ? m.rating.toFixed(1) : '—'}</div>
                  </div>
                  <div className="p-2 bg-gray-50 rounded">
                    <div className="text-xs text-gray-500">Completed</div>
                    <div className="font-medium">{m.completed}</div>
                  </div>
                  <div className="p-2 bg-gray-50 rounded">
                    <div className="text-xs text-gray-500">Revenue</div>
                    <div className="font-medium">{m.revenue.toLocaleString(undefined, { style: 'currency', currency: 'NGN' })}</div>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <a className="text-sm text-indigo-700 hover:underline" href={`/dashboard/staff/${encodeURIComponent(id)}`}>Open details</a>
                  <div className="flex gap-2">
                    <a className="px-2 py-1 rounded border text-xs" href={`/schedule?staff_id=${encodeURIComponent(id)}`}>View Schedule</a>
                    <a className="px-2 py-1 rounded border text-xs" href={`/schedule?staff_id=${encodeURIComponent(id)}&assign=1`}>Assign</a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <StaffInviteModal open={inviteOpen} onClose={()=> setInviteOpen(false)} />
        <StaffRolesModal
          open={rolesOpen}
          onClose={()=> setRolesOpen(false)}
          staff={staff as StaffDto[]}
          onLocalUpdate={(id, patch)=> mutateAttributes.mutate({ tenantId: tenant?.id as string, id, patch })}
        />
      </div>
  );
}
