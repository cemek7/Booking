"use client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantsListQuerySchema } from '@/lib/validation';
import { authFetch } from '@/lib/auth/auth-api-client';

interface Tenant { id: string; name: string; status: string; createdAt: string; plan?: string; }
interface ListResponse { tenants: Tenant[]; total: number; }

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

async function fetchTenants(params: { status?: string; page?: number; limit?: number }): Promise<ListResponse> {
  const parsed = tenantsListQuerySchema.safeParse({ ...params });
  if (!parsed.success) throw new Error('Invalid query');
  const { status, page, limit } = parsed.data;
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (page) qs.set('page', String(page));
  if (limit) qs.set('limit', String(limit));
  const url = `${API_BASE}/api/superadmin/tenants${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await authFetch<ListResponse>(url, { method: 'GET' });
  if (res.error) throw new Error(res.error.message);
  return (res.data as ListResponse) || { tenants: [], total: 0 };
}

export function useSuperadminTenants(params: { status?: string; page?: number; limit?: number }) {
  return useQuery({ queryKey: ['superadmin-tenants', params], queryFn: () => fetchTenants(params) });
}

export function useTenantAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const url = `${API_BASE}/api/superadmin/tenants/${input.id}`;
      const res = await authFetch(url, { method: 'PATCH', body: input.patch });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['superadmin-tenants'] })
  });
}
