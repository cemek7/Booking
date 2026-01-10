"use client";
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';

export type ServiceItem = { id: string|number; name: string; duration?: number };

async function fetchServices(tenantId?: string): Promise<ServiceItem[]> {
  const url = tenantId ? `/api/tenants/${tenantId}/services` : '/api/services';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed services fetch');
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.services) ? data.services : []);
  return arr.map((s: any) => ({ id: s.id, name: s.name, duration: s.duration ?? s.duration_minutes }));
}

export function useServices(explicitTenantId?: string) {
  const { tenant } = useTenant();
  const tid = explicitTenantId || tenant?.id;
  return useQuery({ queryKey: ['services', tid ?? 'public'], queryFn: () => fetchServices(tid) });
}
