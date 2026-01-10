import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery } from '@tanstack/react-query';
import { authFetch } from "@/lib/auth/auth-api-client";

export default function StaffSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { tenant } = useTenant();
  const { data, isLoading, error } = useQuery({
    queryKey: ['tenant-staff', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const response = await authFetch(`/api/tenants/${tenant.id}/staff`, { tenantId: tenant.id });
      if (response.error) throw new Error('Failed to load staff');
      return response.data || [];
    },
    enabled: !!tenant?.id
  });
  if (isLoading) return <select disabled className="w-full border rounded px-3 py-2"><option>Loading staff...</option></select>;
  if (error) return <select disabled className="w-full border rounded px-3 py-2"><option>Error loading staff</option></select>;
  const staffList = Array.isArray(data) ? data : [];
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full border rounded px-3 py-2">
      <option value="">Unassigned</option>
      {staffList.map((s: any) => (
        <option key={s.user_id || s.id} value={s.user_id || s.id}>{s.name || s.email || s.user_id || s.id}</option>
      ))}
    </select>
  );
}
