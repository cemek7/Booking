"use client";
import { useQuery } from '@tanstack/react-query';
type ClientProfile = Record<string, any>;

async function fetchClient(id: string): Promise<ClientProfile | null> {
  const res = await fetch(`/api/clients/${id}`);
  if (!res.ok) throw new Error('Failed client fetch');
  const json = await res.json();
  return json.client || null;
}

export function useClient(id: string) {
  return useQuery({ queryKey: ['client', id], queryFn: () => fetchClient(id), enabled: !!id });
}
