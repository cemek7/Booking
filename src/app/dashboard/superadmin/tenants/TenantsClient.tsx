'use client';
import { useState, useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import ReservationsCalendar from '@/components/ReservationsCalendar';
import ReservationsList from '@/components/reservations/ReservationsList';
import { authFetch } from '@/lib/auth/auth-api-client';

interface TenantsClientProps {
  user: { id: string; email: string; role: string };
}

export default function TenantsClient({ user }: TenantsClientProps) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Array<{ id: string; name?: string }>>([]);
  const [usage, setUsage] = useState<{ requests?: number; cost?: number; total_tokens?: number } | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.from('tenants').select('id,name').limit(50).then(({ data }: { data: Array<{ id: string; name?: string }> | null }) => {
      const list = (data as Array<{ id: string; name?: string }>) || [];
      setTenants(list);
      if (list.length > 0) setTenantId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!tenantId) return setUsage(null);
    authFetch(`/api/admin/llm-usage?tenant_id=${tenantId}`).then((res) => {
      const json = res.data as any;
      if (!json) return;
      setUsage({
        requests: typeof json.requests === 'number' ? json.requests : 0,
        cost: typeof json.cost === 'number' ? json.cost : (typeof json.estimated_cost === 'number' ? json.estimated_cost : 0),
        total_tokens: typeof json.total_tokens === 'number' ? json.total_tokens : 0,
      });
    }).catch(() => {});
  }, [tenantId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Management</h1>
          <p className="text-sm text-gray-600">Select a tenant to view their calendar, reservations, and usage metrics.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Tenant:</label>
          <select
            value={tenantId || ''}
            onChange={(e) => setTenantId(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">-- select --</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name || t.id}</option>
            ))}
          </select>
        </div>
      </div>

      {tenantId ? (
        <>
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">
              <ReservationsCalendar tenantId={tenantId} />
            </div>
            <div className="col-span-1">
              <ReservationsList tenantId={tenantId} />
            </div>
          </div>

          <div className="p-4 border rounded bg-white">
            <h2 className="font-semibold mb-2">LLM Usage Summary</h2>
            {usage ? (
              <div className="space-y-1 text-sm">
                <div>Requests: {usage.requests ?? 0}</div>
                <div>Estimated cost: ${(usage.cost ?? 0).toFixed(2)}</div>
                <div>Total tokens: {(usage.total_tokens ?? 0).toLocaleString()}</div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Loading usage...</p>
            )}
          </div>
        </>
      ) : (
        <div className="p-8 text-center text-gray-500 border rounded-lg">
          Select a tenant to view their data
        </div>
      )}
    </div>
  );
}
