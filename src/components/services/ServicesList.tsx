'use client';

import { useRouter } from "next/navigation";
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import { toast } from '../ui/toast';
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch, authDelete } from "@/lib/auth/auth-api-client";

export default function ServicesList() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const router = useRouter();
  const { data, error, isLoading } = useQuery({
    queryKey: ['services', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const response = await authFetch('/api/services');
      if (response.error) throw new Error('Failed services fetch');
      return response.data || [];
    },
    enabled: !!tenant?.id
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await authDelete(`/api/services?id=eq.${id}`);
      if (response.error) throw new Error('Delete failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', tenant?.id] })
  });

  const handleEdit = (id: number) => {
    router.push(`/dashboard/services/${id}`);
  };

  const handleDelete = (id: number) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    deleteMutation.mutate(id, {
      onError: () => toast.error('Failed to delete service')
    });
  };

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error loading services.</p>;

  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>ID</TH>
            <TH>Name</TH>
            <TH>Description</TH>
            <TH>Price</TH>
            <TH>Duration</TH>
            <TH>Category</TH>
            <TH>Created At</TH>
            <TH>&nbsp;</TH>
          </TR>
        </THead>
        <TBody>
          {data && data.length > 0 ? (
            data.map((s: any) => (
              <TR key={s.id}>
                <TD>{s.id}</TD>
                <TD>{s.name}</TD>
                <TD>{s.description}</TD>
                <TD>{s.price}</TD>
                <TD>{s.duration}</TD>
                <TD>{s.category}</TD>
                <TD>{s.created_at ? new Date(s.created_at).toLocaleString() : ""}</TD>
                <TD>
                  <Button className="mr-2 px-2 py-1 text-xs" onClick={() => handleEdit(s.id)}>Edit</Button>
                  <Button className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600" onClick={() => handleDelete(s.id)}>Delete</Button>
                </TD>
              </TR>
            ))
          ) : (
            <TR>
              <TD colSpan={8} className="text-center">No services found.</TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
