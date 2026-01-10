"use client";
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useStaff, StaffDto } from '@/hooks/useStaff';

export default function StaffDetailPage() {
  const params = useParams();
  const staffId = Array.isArray(params?.id) ? params?.id[0] : (params?.id as string | undefined);
  const { tenant } = useTenant();
  const { data: staff = [] } = useStaff(tenant?.id);
  const person = useMemo<StaffDto | undefined>(() => staff.find(s => (s.id || s.user_id) === staffId), [staff, staffId]);
  const [metrics, setMetrics] = useState<{ rating: number|null; completed: number; revenue: number }>({ rating: null, completed: 0, revenue: 0 });

  useEffect(() => {
    let cancel = false;
    async function load() {
      if (!tenant?.id || !staffId) return;
      const res = await fetch(`/api/staff/metrics?tenant_id=${tenant.id}`);
      if (!res.ok) return;
      const json = await res.json().catch(()=>({ metrics: [] }));
      const m = (json.metrics || []).find((x: any) => x.user_id === staffId);
      if (!cancel && m) setMetrics({ rating: m.rating, completed: m.completed, revenue: m.revenue });
    }
    load();
    return () => { cancel = true; };
  }, [tenant?.id, staffId]);

  const id = staffId || '';
  const name = person?.name || person?.email || id;
  const role = person?.role || 'staff';
  const type = (person as any)?.type || (person as any)?.staff_type || '—';

  return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <p className="text-sm text-gray-600">Role: <span className="capitalize">{role}</span> · Type: {type}</p>
          </div>
          <div className="flex gap-2">
            <a className="px-2 py-1 rounded border text-sm" href={`/schedule?staff_id=${encodeURIComponent(id)}`}>Open Schedule</a>
            <a className="px-2 py-1 rounded border text-sm" href={`/schedule?staff_id=${encodeURIComponent(id)}&assign=1`}>Assign to task</a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-4 bg-white border rounded">
            <div className="text-xs text-gray-500">Rating</div>
            <div className="text-2xl font-semibold">{metrics.rating ? metrics.rating.toFixed(1) : '—'}</div>
          </div>
          <div className="p-4 bg-white border rounded">
            <div className="text-xs text-gray-500">Completed</div>
            <div className="text-2xl font-semibold">{metrics.completed}</div>
          </div>
          <div className="p-4 bg-white border rounded">
            <div className="text-xs text-gray-500">Revenue</div>
            <div className="text-2xl font-semibold">{metrics.revenue.toLocaleString(undefined, { style: 'currency', currency: 'NGN' })}</div>
          </div>
        </div>

        <div className="bg-white border rounded p-4">
          <h2 className="text-lg font-medium mb-2">Assignments</h2>
          <p className="text-sm text-gray-600">Use the Assign button to attach this staff to pending tasks. The full calendar view supports drag & drop rescheduling.</p>
          <div className="mt-3">
            <a className="px-3 py-1 rounded bg-indigo-600 text-white text-sm" href={`/schedule?staff_id=${encodeURIComponent(id)}&assign=1`}>Assign now</a>
          </div>
        </div>
      </div>
  );
}
