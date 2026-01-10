"use client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface StaffDto { id?: string; user_id?: string; name?: string; email?: string; role?: string; status?: string; staff_type?: string; }

async function fetchStaff(tenantId: string): Promise<StaffDto[]> {
  const res = await fetch(`/api/staff?tenant_id=${encodeURIComponent(tenantId)}`);
  if (!res.ok) throw new Error('Failed staff fetch');
  const json = await res.json();
  return json.staff || [];
}

export function useStaff(tenantId?: string) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['staff', tenantId], queryFn: () => fetchStaff(tenantId as string), enabled: !!tenantId });
  const mutateAttributes = useMutation({
    mutationFn: async (vars: { tenantId: string; id: string; patch: Partial<StaffDto> }) => {
      const res = await fetch(`/api/staff/${encodeURIComponent(vars.id)}/attributes?tenant_id=${encodeURIComponent(vars.tenantId)}`, {
        method: 'PATCH', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(vars.patch)
      });
      if (!res.ok) throw new Error('Attribute update failed');
      return vars;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['staff', tenantId] });
      const prev = qc.getQueryData<StaffDto[]>(['staff', tenantId]);
      if (prev) {
        qc.setQueryData<StaffDto[]>(['staff', tenantId], prev.map(s => {
          const id = (s.id || s.user_id || '');
          if (id === vars.id) return { ...s, ...vars.patch };
          return s;
        }));
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['staff', tenantId], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['staff', tenantId] });
    }
  });
  return { ...query, mutateAttributes };
}
