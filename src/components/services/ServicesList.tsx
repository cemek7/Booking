'use client';

import React, { memo, useCallback } from 'react';
import { useRouter } from "next/navigation";
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import { toast } from '../ui/toast';
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch, authDelete } from "@/lib/auth/auth-api-client";

interface Service {
  id: number;
  name: string;
  description?: string;
  price?: number;
  duration?: number;
  category?: string;
  created_at?: string;
}

interface ServiceRowProps {
  service: Service;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}

const ServiceRow = memo<ServiceRowProps>(function ServiceRow({ service, onEdit, onDelete }) {
  const handleEdit = useCallback(() => {
    onEdit(service.id);
  }, [onEdit, service.id]);

  const handleDelete = useCallback(() => {
    onDelete(service.id);
  }, [onDelete, service.id]);

  return (
    <TR>
      <TD>{service.id}</TD>
      <TD>{service.name}</TD>
      <TD>{service.description}</TD>
      <TD>{service.price}</TD>
      <TD>{service.duration}</TD>
      <TD>{service.category}</TD>
      <TD>{service.created_at ? new Date(service.created_at).toLocaleString() : ""}</TD>
      <TD>
        <Button className="mr-2 px-2 py-1 text-xs" onClick={handleEdit}>Edit</Button>
        <Button className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600" onClick={handleDelete}>Delete</Button>
      </TD>
    </TR>
  );
});

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

  const handleEdit = useCallback((id: number) => {
    router.push(`/dashboard/services/${id}`);
  }, [router]);

  const handleDelete = useCallback((id: number) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    deleteMutation.mutate(id, {
      onError: () => toast.error('Failed to delete service')
    });
  }, [deleteMutation]);

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
            data.map((service: Service) => (
              <ServiceRow
                key={service.id}
                service={service}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
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
