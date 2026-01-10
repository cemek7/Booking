import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery } from '@tanstack/react-query';
import { authFetch } from "@/lib/auth/auth-api-client";

export default function ServicesMultiSelect({ value, onChange }: { value: { id: string, quantity: number }[]; onChange: (v: { id: string, quantity: number }[]) => void }) {
  const { tenant } = useTenant();
  const { data, isLoading, error } = useQuery({
    queryKey: ['services', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const response = await authFetch('/api/services', { tenantId: tenant.id });
      if (response.error) throw new Error('Failed services fetch');
      return response.data || [];
    },
    enabled: !!tenant?.id
  });
  const handleToggle = (id: string) => {
    if (value.some(s => s.id === id)) {
      onChange(value.filter(s => s.id !== id));
    } else {
      onChange([...value, { id, quantity: 1 }]);
    }
  };
  const handleQuantity = (id: string, qty: number) => {
    onChange(value.map(s => s.id === id ? { ...s, quantity: qty } : s));
  };
  if (isLoading) return <div>Loading services...</div>;
  if (error) return <div>Error loading services</div>;
  return (
    <div className="space-y-2">
      {data && data.map((service: any) => {
        const selected = value.find(s => s.id === service.id);
        return (
          <div key={service.id} className="flex items-center gap-2">
            <input type="checkbox" checked={!!selected} onChange={() => handleToggle(service.id)} />
            <span>{service.name}</span>
            {selected && (
              <input type="number" min={1} value={selected.quantity} onChange={e => handleQuantity(service.id, Number(e.target.value))} className="w-16 border rounded px-1 py-0.5 ml-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}
